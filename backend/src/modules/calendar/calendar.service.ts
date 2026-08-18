import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { DataSource, Not, Repository } from 'typeorm';
import { decryptString, encryptString } from '../../common/crypto-secrets';
import { AuditService } from '../audit/audit.service';
import { OperationsService } from '../operations/operations.service';
import {
  CalendarConnection,
  CalendarConnectionStatus,
} from './calendar-connection.entity';
import { CalendarOAuthState } from './calendar-oauth-state.entity';
import {
  GOOGLE_CALENDAR_SCOPES,
  GoogleCalendarApiError,
  GoogleCalendarClient,
  GoogleCalendarEvent,
} from './google-calendar.client';

const OAUTH_STATE_TTL_MS = 10 * 60_000;

type BookingEventInput = {
  tenantId: string;
  calendarId?: string;
  leadId: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  attendeeEmail?: string | null;
  idempotencyKey: string;
};

type UpdateEventInput = {
  tenantId: string;
  eventId: string;
  calendarId?: string | null;
  etag?: string | null;
  start: Date;
  end: Date;
  summary: string;
  attendeeEmail?: string | null;
};

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function base64UrlSha256(value: string) {
  return createHash('sha256').update(value).digest('base64url');
}

function validEmail(value?: string | null) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function publicError(code?: string | null) {
  const entries: Record<string, { what: string; why: string; how: string }> = {
    GOOGLE_AUTH_REQUIRED: {
      what: 'Google Calendar authorization expired or was revoked.',
      why: 'RealtyTechAI cannot safely check availability or change calendar events.',
      how: 'Reconnect Google Calendar, choose the calendar again, and run the connection test.',
    },
    GOOGLE_CALENDAR_CHANGED: {
      what: 'A calendar event changed outside RealtyTechAI.',
      why: 'Overwriting an externally changed event could create the wrong appointment.',
      how: 'Review the event in Google Calendar, then run the connection test and retry.',
    },
    GOOGLE_CALENDAR_TEMPORARY_FAILURE: {
      what: 'Google Calendar is temporarily unavailable.',
      why: 'Availability and event creation cannot be confirmed.',
      how: 'Wait briefly and run Test connection. RealtyTechAI will not claim the appointment is booked.',
    },
    GOOGLE_CALENDAR_TIMEOUT: {
      what: 'Google Calendar did not respond in time.',
      why: 'The booking result is uncertain, so RealtyTechAI stopped before confirming it.',
      how: 'Run Test connection and retry after the calendar responds.',
    },
    GOOGLE_FREE_BUSY_UNCERTAIN: {
      what: 'Google could not confirm free/busy information.',
      why: 'RealtyTechAI never invents availability.',
      how: 'Run Test connection or use the verified booking link/human handoff.',
    },
    GOOGLE_CALENDAR_RESULT_TRUNCATED: {
      what: 'Google returned too many overlapping calendar records to verify safely.',
      why: 'A partial result could hide a conflict, so RealtyTechAI stopped.',
      how: 'Review the selected calendar for duplicate or unusually dense events, then retry or hand off.',
    },
  };
  return code ? entries[code] || null : null;
}

@Injectable()
export class CalendarService {
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CalendarConnection)
    private readonly connections: Repository<CalendarConnection>,
    @InjectRepository(CalendarOAuthState)
    private readonly oauthStates: Repository<CalendarOAuthState>,
    private readonly google: GoogleCalendarClient,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly operations?: OperationsService,
  ) {}

  async status(tenantId: string) {
    const connection = await this.connections.findOne({
      where: { tenantId, provider: 'google' },
    });
    if (!connection || connection.status === 'disconnected') {
      return {
        provider: 'google',
        status: 'disconnected',
        connected: false,
        selectedCalendar: null,
        lastTestedAt: null,
        lastSuccessfulSyncAt: null,
        issue: {
          what: 'Google Calendar is not connected.',
          why: 'RealtyTechAI cannot verify availability or create a real appointment.',
          how: 'Select Connect Google Calendar, choose a calendar, and run Test connection.',
        },
      };
    }
    const status =
      connection.status === 'needs_attention'
        ? 'needs_attention'
        : !connection.selectedCalendarId
          ? 'choose_calendar'
          : connection.status === 'connected' && !connection.lastTestedAt
            ? 'configured'
            : connection.status;
    const connected = Boolean(
      status === 'connected' &&
        connection.selectedCalendarId &&
        connection.lastTestedAt,
    );
    return {
      provider: 'google',
      status,
      connected,
      selectedCalendar: connection.selectedCalendarId
        ? {
            id: connection.selectedCalendarId,
            name: connection.selectedCalendarName || 'Selected calendar',
            timeZone: connection.selectedCalendarTimeZone || null,
          }
        : null,
      lastTestedAt: connection.lastTestedAt,
      lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
      issue:
        status === 'choose_calendar'
          ? {
              what: 'Google authorization succeeded, but no calendar is selected.',
              why: 'RealtyTechAI must know exactly where appointments belong.',
              how: 'Choose a writable calendar and run Test connection.',
            }
          : status === 'configured'
            ? {
                what: 'The Google Calendar connection has not been tested.',
                why: 'RealtyTechAI must verify write access and free/busy before booking.',
                how: 'Run Test connection to finish calendar setup.',
              }
          : connection.status === 'needs_attention'
            ? publicError(connection.lastErrorCode) || {
                what: 'The Google Calendar connection needs attention.',
                why: 'A recent calendar operation could not be verified.',
                how: 'Reconnect Google Calendar and run Test connection.',
              }
            : null,
    };
  }

  async startGoogleOAuth(tenantId: string, userId: string) {
    if (!tenantId || !userId) throw new BadRequestException('Missing workspace context');
    const config = this.googleConfig();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(64).toString('base64url');
    await this.oauthStates.save(
      this.oauthStates.create({
        stateHash: sha256(state),
        tenantId,
        userId,
        codeVerifierEncrypted: encryptString(verifier),
        expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
        consumedAt: null,
      }),
    );
    await this.audit?.record({
      tenantId,
      actorId: userId,
      action: 'calendar.oauth_started',
      resourceType: 'tenant',
      resourceId: tenantId,
      method: 'POST',
      path: '/calendar/google/oauth/start',
      statusCode: 201,
      metadata: { provider: 'google', expiresInMinutes: 10 },
    });
    return {
      url: this.google.authorizationUrl({
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        state,
        codeChallenge: base64UrlSha256(verifier),
      }),
    };
  }

  async completeGoogleOAuth(code: string, rawState: string) {
    const stateHash = sha256(String(rawState || ''));
    const oauthState = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CalendarOAuthState);
      const row = await repository
        .createQueryBuilder('state')
        .setLock('pessimistic_write')
        .where('state.stateHash = :stateHash', { stateHash })
        .getOne();
      if (!row || row.consumedAt || row.expiresAt <= new Date()) {
        throw new BadRequestException('The Google Calendar connection request expired. Start again.');
      }
      row.consumedAt = new Date();
      await repository.save(row);
      return row;
    });
    const config = this.googleConfig();
    const tokens = await this.google.exchangeCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      code: String(code || ''),
      codeVerifier: decryptString(oauthState.codeVerifierEncrypted),
    });
    // OAuth 2.0 permits the token endpoint to omit `scope` when the grant is
    // identical to the request. A present value remains authoritative.
    const grantedScopes = tokens.scope
      ? String(tokens.scope).split(/\s+/).filter(Boolean)
      : [...GOOGLE_CALENDAR_SCOPES];
    const missingScopes = GOOGLE_CALENDAR_SCOPES.filter(
      (scope) => !grantedScopes.includes(scope),
    );
    if (!tokens.access_token || missingScopes.length) {
      if (tokens.access_token) {
        await this.google.revokeToken(tokens.access_token).catch(() => undefined);
      }
      throw new BadRequestException(
        'Google Calendar permissions were not fully granted. Reconnect and approve calendar list, availability, and event access.',
      );
    }
    let connection = await this.connections.findOne({
      where: { tenantId: oauthState.tenantId, provider: 'google' },
    });
    if (!tokens.refresh_token) {
      await this.google.revokeToken(tokens.access_token).catch(() => undefined);
      throw new BadRequestException(
        'Google did not provide offline calendar access. Reconnect and approve access again.',
      );
    }
    const refreshToken = encryptString(tokens.refresh_token);
    if (!connection) {
      connection = this.connections.create({
        tenantId: oauthState.tenantId,
        provider: 'google',
      });
    }
    Object.assign(connection, {
      accessTokenEncrypted: encryptString(tokens.access_token),
      refreshTokenEncrypted: refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + Math.max(tokens.expires_in || 3_600, 60) * 1_000),
      refreshTokenExpiresAt: tokens.refresh_token_expires_in
        ? new Date(Date.now() + tokens.refresh_token_expires_in * 1_000)
        : connection.refreshTokenExpiresAt || null,
      grantedScopes,
      status: 'configured' as CalendarConnectionStatus,
      selectedCalendarId: null,
      selectedCalendarName: null,
      selectedCalendarTimeZone: null,
      lastTestedAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
      disconnectedAt: null,
    });
    await this.connections.save(connection);
    await this.audit?.record({
      tenantId: oauthState.tenantId,
      actorId: oauthState.userId,
      action: 'calendar.oauth_connected',
      resourceType: 'calendar_connection',
      resourceId: connection.id,
      method: 'GET',
      path: '/calendar/google/oauth/callback',
      statusCode: 302,
      metadata: { provider: 'google', scopeCount: grantedScopes.length },
    });
    return connection;
  }

  async listCalendars(tenantId: string) {
    const connection = await this.requireAuthorizedConnection(tenantId);
    try {
      const accessToken = await this.accessToken(connection);
      const calendars = await this.google.listCalendars(accessToken);
      return calendars.map((calendar) => ({
        id: calendar.id,
        name: calendar.summary || (calendar.primary ? 'Primary calendar' : 'Calendar'),
        primary: calendar.primary === true,
        timeZone: calendar.timeZone || null,
        accessRole: calendar.accessRole || 'reader',
      }));
    } catch (error) {
      await this.handleProviderError(connection, error);
      throw this.publicProviderException(error);
    }
  }

  async selectCalendar(tenantId: string, calendarId: string, actorId: string) {
    const cleanId = String(calendarId || '').trim();
    if (!cleanId) throw new BadRequestException('Choose a Google Calendar.');
    const calendars = await this.listCalendars(tenantId);
    const selected = calendars.find((calendar) => calendar.id === cleanId);
    if (!selected || !['writer', 'owner'].includes(selected.accessRole)) {
      throw new BadRequestException('Choose a Google Calendar that allows event changes.');
    }
    return this.withTenantBookingLock(tenantId, async () => {
      const connection = await this.requireAuthorizedConnection(tenantId);
      connection.selectedCalendarId = selected.id;
      connection.selectedCalendarName = selected.name;
      connection.selectedCalendarTimeZone = selected.timeZone;
      connection.status = 'configured';
      connection.lastTestedAt = null;
      connection.lastErrorCode = null;
      connection.lastErrorAt = null;
      await this.connections.save(connection);
      await this.audit?.record({
        tenantId,
        actorId,
        action: 'calendar.selected',
        resourceType: 'calendar_connection',
        resourceId: connection.id,
        method: 'PUT',
        path: '/calendar/google/selection',
        statusCode: 200,
        metadata: { provider: 'google', calendarName: selected.name },
      });
      return this.status(tenantId);
    });
  }

  async testConnection(tenantId: string, actorId: string) {
    return this.withTenantBookingLock(tenantId, () =>
      this.testConnectionInsideLock(tenantId, actorId),
    );
  }

  private async testConnectionInsideLock(tenantId: string, actorId: string) {
    const connection = await this.requireSelectedConnection(tenantId);
    try {
      const accessToken = await this.accessToken(connection);
      const calendar = await this.google.getCalendar(
        accessToken,
        connection.selectedCalendarId!,
      );
      if (!calendar || !['writer', 'owner'].includes(calendar.accessRole || '')) {
        throw new GoogleCalendarApiError(
          'GOOGLE_CALENDAR_NOT_WRITABLE',
          'The selected calendar is not writable.',
          null,
          false,
        );
      }
      const now = new Date();
      await this.google.freeBusy(accessToken, {
        calendarId: connection.selectedCalendarId!,
        start: now,
        end: new Date(now.getTime() + 60_000),
        timeZone: connection.selectedCalendarTimeZone || 'UTC',
      });
      connection.status = 'connected';
      connection.selectedCalendarName = calendar.summary || connection.selectedCalendarName;
      connection.selectedCalendarTimeZone =
        calendar.timeZone || connection.selectedCalendarTimeZone || 'UTC';
      connection.lastTestedAt = new Date();
      connection.lastSuccessfulSyncAt = new Date();
      connection.lastErrorCode = null;
      connection.lastErrorAt = null;
      await this.connections.save(connection);
      await this.audit?.record({
        tenantId,
        actorId,
        action: 'calendar.connection_test_passed',
        resourceType: 'calendar_connection',
        resourceId: connection.id,
        method: 'POST',
        path: '/calendar/google/test',
        statusCode: 200,
        metadata: { provider: 'google' },
      });
      return this.status(tenantId);
    } catch (error) {
      await this.handleProviderError(connection, error);
      await this.audit?.record({
        tenantId,
        actorId,
        action: 'calendar.connection_test_failed',
        resourceType: 'calendar_connection',
        resourceId: connection.id,
        method: 'POST',
        path: '/calendar/google/test',
        statusCode: 503,
        metadata: { provider: 'google', errorCode: this.errorCode(error) },
      });
      throw this.publicProviderException(error);
    }
  }

  async disconnect(tenantId: string, actorId: string) {
    return this.withTenantBookingLock(tenantId, () =>
      this.disconnectInsideLock(tenantId, actorId),
    );
  }

  private async disconnectInsideLock(tenantId: string, actorId: string) {
    const connection = await this.connections.findOne({
      where: { tenantId, provider: 'google' },
    });
    if (!connection) return this.status(tenantId);
    const token = connection.refreshTokenEncrypted
      ? decryptString(connection.refreshTokenEncrypted)
      : connection.accessTokenEncrypted
        ? decryptString(connection.accessTokenEncrypted)
        : '';
    let remoteRevocationSucceeded = !token;
    if (token) {
      try {
        await this.google.revokeToken(token);
        remoteRevocationSucceeded = true;
      } catch {
        await this.operations
          ?.createTask({
            tenantId,
            category: 'calendar_provider_failure',
            title: 'Google token revocation could not be confirmed',
            description:
              'Local calendar credentials were removed, but Google did not confirm remote revocation. Review the OAuth grant in the Google account.',
            priority: 'high',
            relatedEntityType: 'calendar_connection',
            relatedEntityId: connection.id,
            dedupeOpen: true,
          })
          .catch(() => undefined);
      }
    }
    Object.assign(connection, {
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      grantedScopes: null,
      status: 'disconnected' as CalendarConnectionStatus,
      selectedCalendarId: null,
      selectedCalendarName: null,
      selectedCalendarTimeZone: null,
      lastTestedAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
      disconnectedAt: new Date(),
    });
    await this.connections.save(connection);
    await this.audit?.record({
      tenantId,
      actorId,
      action: 'calendar.disconnected',
      resourceType: 'calendar_connection',
      resourceId: connection.id,
      method: 'DELETE',
      path: '/calendar/google',
      statusCode: 200,
      metadata: {
        provider: 'google',
        remoteRevocationAttempted: Boolean(token),
        remoteRevocationSucceeded,
      },
    });
    return this.status(tenantId);
  }

  async checkAvailability(
    tenantId: string,
    start: Date,
    end: Date,
    excludeEventId?: string | null,
    calendarId?: string | null,
  ) {
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      throw new BadRequestException('Appointment end time must be after its start time.');
    }
    if (end.getTime() - start.getTime() > 8 * 60 * 60_000) {
      throw new BadRequestException(
        'Availability checks cannot exceed eight hours.',
      );
    }
    const connection = await this.requireReadyConnection(tenantId);
    try {
      const accessToken = await this.accessToken(connection);
      const effectiveCalendarId = calendarId || connection.selectedCalendarId!;
      const busy = await this.google.freeBusy(accessToken, {
        calendarId: effectiveCalendarId,
        start,
        end,
        timeZone: connection.selectedCalendarTimeZone || 'UTC',
      });
      const overlap = busy.filter((range) => range.start < end && range.end > start);
      if (!overlap.length) {
        await this.noteSyncSuccess(connection);
        return { available: true, checkedAt: new Date(), timeZone: connection.selectedCalendarTimeZone };
      }
      if (excludeEventId) {
        const events = await this.google.listEvents(accessToken, {
          calendarId: effectiveCalendarId,
          start,
          end,
        });
        const excludedEventPresent = events.some(
          (event) =>
            event.id === excludeEventId && event.status !== 'cancelled',
        );
        const blocking = events.filter((event) => {
          if (event.id === excludeEventId || event.status === 'cancelled') return false;
          if (event.transparency === 'transparent') return false;
          if (event.start?.date || event.end?.date) return true;
          const eventStart = event.start?.dateTime ? new Date(event.start.dateTime) : null;
          const eventEnd = event.end?.dateTime ? new Date(event.end.dateTime) : null;
          if (!eventStart || !eventEnd) return true;
          return eventStart < end && eventEnd > start;
        });
        if (excludedEventPresent && !blocking.length) {
          await this.noteSyncSuccess(connection);
          return { available: true, checkedAt: new Date(), timeZone: connection.selectedCalendarTimeZone };
        }
      }
      await this.noteSyncSuccess(connection);
      return { available: false, checkedAt: new Date(), timeZone: connection.selectedCalendarTimeZone };
    } catch (error) {
      await this.handleProviderError(connection, error);
      throw this.publicProviderException(error);
    }
  }

  async createBookingEvent(input: BookingEventInput) {
    const connection = await this.requireReadyConnection(input.tenantId);
    const effectiveCalendarId =
      input.calendarId || connection.selectedCalendarId!;
    const idempotencyHash = sha256(`${input.tenantId}:${input.idempotencyKey}`);
    const deterministicEventId = `rta${idempotencyHash.slice(0, 40)}`;
    try {
      const accessToken = await this.accessToken(connection);
      if (effectiveCalendarId !== connection.selectedCalendarId) {
        await this.google.getCalendar(accessToken, effectiveCalendarId);
      }
      const existing = (
        await this.google.listEvents(accessToken, {
          calendarId: effectiveCalendarId,
          privateExtendedProperty: `rtaIdempotency=${idempotencyHash}`,
          showDeleted: true,
        })
      ).filter((event) => event.status !== 'cancelled');
      if (existing.length > 1) {
        throw new GoogleCalendarApiError(
          'GOOGLE_DUPLICATE_EVENTS_FOUND',
          'Multiple Google Calendar events share the same booking key.',
          null,
          false,
        );
      }
      if (existing[0]) {
        const existingEvent = this.externalEvent(
          existing[0],
          effectiveCalendarId,
        );
        if (
          existingEvent.startsAt?.getTime() !== input.start.getTime() ||
          existingEvent.endsAt?.getTime() !== input.end.getTime()
        ) {
          throw new ConflictException({
            code: 'APPOINTMENT_IDEMPOTENCY_CONFLICT',
            message:
              'That booking request key was already used for a different time. Start a new booking request.',
          });
        }
        await this.noteSyncSuccess(connection);
        return existingEvent;
      }
      const availability = await this.checkAvailability(
        input.tenantId,
        input.start,
        input.end,
        undefined,
        effectiveCalendarId,
      );
      if (!availability.available) {
        throw new ConflictException({
          code: 'CALENDAR_TIME_UNAVAILABLE',
          message: 'That time is busy on the selected Google Calendar. Choose another time.',
        });
      }
      const created = await this.google.insertEvent(accessToken, {
        calendarId: effectiveCalendarId,
        summary: input.summary,
        description: input.description,
        start: input.start,
        end: input.end,
        timeZone: connection.selectedCalendarTimeZone || 'UTC',
        attendeeEmail: validEmail(input.attendeeEmail) ? input.attendeeEmail!.trim() : null,
        idempotencyHash,
        eventId: deterministicEventId,
      });
      if (!created?.id) {
        throw new GoogleCalendarApiError(
          'GOOGLE_EVENT_RESULT_UNCERTAIN',
          'Google Calendar did not return an event identifier.',
          null,
          true,
          true,
        );
      }
      await this.noteSyncSuccess(connection);
      await this.audit?.recordSystemEvent({
        tenantId: input.tenantId,
        eventType: 'calendar.event_created',
        resourceType: 'lead',
        resourceId: input.leadId,
        metadata: {
          provider: 'google',
          startsAt: input.start.toISOString(),
          endsAt: input.end.toISOString(),
          idempotencyFingerprint: idempotencyHash.slice(0, 12),
        },
      });
      return this.externalEvent(created, effectiveCalendarId);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof GoogleCalendarApiError && error.outcomeUncertain) {
        try {
          const accessToken = await this.accessToken(connection);
          const recovered = await this.google.getEvent(
            accessToken,
            effectiveCalendarId,
            deterministicEventId,
          );
          if (
            recovered &&
            recovered.status !== 'cancelled' &&
            recovered.extendedProperties?.private?.rtaIdempotency ===
              idempotencyHash
          ) {
            const recoveredEvent = this.externalEvent(
              recovered,
              effectiveCalendarId,
            );
            if (
              recoveredEvent.startsAt?.getTime() !== input.start.getTime() ||
              recoveredEvent.endsAt?.getTime() !== input.end.getTime()
            ) {
              throw new ConflictException({
                code: 'APPOINTMENT_IDEMPOTENCY_CONFLICT',
                message:
                  'The recovered Google event has a different time. Review it before retrying.',
              });
            }
            await this.noteSyncSuccess(connection);
            return recoveredEvent;
          }
        } catch (recoveryError) {
          if (recoveryError instanceof ConflictException) {
            throw recoveryError;
          }
          // Preserve the original uncertainty. The durable booking reconciler
          // will repeat the deterministic operation without creating a duplicate.
        }
      }
      await this.handleProviderError(connection, error);
      throw this.publicProviderException(error);
    }
  }

  async readyCalendarId(tenantId: string) {
    const connection = await this.requireReadyConnection(tenantId);
    return connection.selectedCalendarId!;
  }

  async updateBookingEvent(input: UpdateEventInput) {
    const connection = await this.requireReadyConnection(input.tenantId);
    const availability = await this.checkAvailability(
      input.tenantId,
      input.start,
      input.end,
      input.eventId,
      input.calendarId,
    );
    if (!availability.available) {
      throw new ConflictException({
        code: 'CALENDAR_TIME_UNAVAILABLE',
        message: 'That time is busy on the selected Google Calendar. Choose another time.',
      });
    }
    try {
      const accessToken = await this.accessToken(connection);
      const updated = await this.google.patchEvent(accessToken, {
        calendarId: input.calendarId || connection.selectedCalendarId!,
        eventId: input.eventId,
        etag: input.etag,
        summary: input.summary,
        start: input.start,
        end: input.end,
        timeZone: connection.selectedCalendarTimeZone || 'UTC',
        attendeeEmail: validEmail(input.attendeeEmail) ? input.attendeeEmail!.trim() : null,
      });
      await this.noteSyncSuccess(connection);
      return this.externalEvent(
        updated,
        input.calendarId || connection.selectedCalendarId!,
      );
    } catch (error) {
      await this.handleProviderError(connection, error);
      throw this.publicProviderException(error);
    }
  }

  async cancelBookingEvent(input: {
    tenantId: string;
    eventId: string;
    calendarId?: string | null;
    etag?: string | null;
  }) {
    const connection = await this.requireReadyConnection(input.tenantId);
    try {
      const accessToken = await this.accessToken(connection);
      const effectiveCalendarId =
        input.calendarId || connection.selectedCalendarId!;
      if (
        input.calendarId &&
        input.calendarId !== connection.selectedCalendarId
      ) {
        await this.google.getCalendar(accessToken, effectiveCalendarId);
      }
      await this.google.deleteEvent(accessToken, {
        calendarId: effectiveCalendarId,
        eventId: input.eventId,
        etag: input.etag,
      });
      await this.noteSyncSuccess(connection);
      return { cancelled: true };
    } catch (error) {
      await this.handleProviderError(connection, error);
      throw this.publicProviderException(error);
    }
  }

  async getBookingEvent(
    tenantId: string,
    eventId: string,
    calendarId?: string | null,
  ) {
    const connection = await this.requireReadyConnection(tenantId);
    try {
      const accessToken = await this.accessToken(connection);
      const effectiveCalendarId = calendarId || connection.selectedCalendarId!;
      // A reconnect can authorize a different Google account. Before treating
      // an old event as deleted, prove that the current grant can still see
      // the calendar where that appointment was originally created.
      if (
        calendarId &&
        calendarId !== connection.selectedCalendarId
      ) {
        await this.google.getCalendar(accessToken, effectiveCalendarId);
      }
      const event = await this.google.getEvent(
        accessToken,
        effectiveCalendarId,
        eventId,
      );
      await this.noteSyncSuccess(connection);
      return event
        ? this.externalEvent(event, effectiveCalendarId)
        : null;
    } catch (error) {
      await this.handleProviderError(connection, error);
      throw this.publicProviderException(error);
    }
  }

  withTenantBookingLock<T>(tenantId: string, callback: () => Promise<T>) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `google-calendar:${tenantId}`,
      ]);
      return callback();
    });
  }

  private externalEvent(event: GoogleCalendarEvent, calendarId: string) {
    return {
      id: event.id,
      calendarId,
      etag: event.etag || null,
      status: event.status || 'confirmed',
      startsAt: event.start?.dateTime ? new Date(event.start.dateTime) : null,
      endsAt: event.end?.dateTime ? new Date(event.end.dateTime) : null,
    };
  }

  private async requireAuthorizedConnection(tenantId: string) {
    const connection = await this.connections.findOne({
      where: { tenantId, provider: 'google' },
    });
    if (
      !connection ||
      connection.status === 'disconnected' ||
      !connection.accessTokenEncrypted ||
      !connection.refreshTokenEncrypted
    ) {
      throw new ConflictException({
        code: 'CALENDAR_NOT_CONNECTED',
        message: 'Connect Google Calendar before scheduling. Use the verified booking link or hand off to a person.',
      });
    }
    return connection;
  }

  private async requireSelectedConnection(tenantId: string) {
    const connection = await this.requireAuthorizedConnection(tenantId);
    if (!connection.selectedCalendarId) {
      throw new ConflictException({
        code: 'CALENDAR_NOT_SELECTED',
        message: 'Choose which Google Calendar RealtyTechAI should use.',
      });
    }
    return connection;
  }

  private async requireReadyConnection(tenantId: string) {
    const connection = await this.requireSelectedConnection(tenantId);
    const retryableAttention =
      connection.status === 'needs_attention' &&
      [
        'GOOGLE_CALENDAR_TEMPORARY_FAILURE',
        'GOOGLE_CALENDAR_TIMEOUT',
        'GOOGLE_FREE_BUSY_UNCERTAIN',
        'GOOGLE_EVENT_RESULT_UNCERTAIN',
      ].includes(connection.lastErrorCode || '');
    if (
      (!retryableAttention && connection.status !== 'connected') ||
      !connection.lastTestedAt
    ) {
      throw new ConflictException({
        code: 'CALENDAR_NEEDS_ATTENTION',
        message: 'Test the Google Calendar connection before scheduling. Use the verified booking link or hand off to a person.',
      });
    }
    return connection;
  }

  private googleConfig() {
    const clientId = String(process.env.GOOGLE_CALENDAR_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '').trim();
    const publicApiUrl = String(process.env.PUBLIC_API_URL || '').replace(/\/+$/, '');
    if (!clientId || !clientSecret || !publicApiUrl) {
      throw new ServiceUnavailableException({
        code: 'GOOGLE_CALENDAR_NOT_CONFIGURED',
        message: 'Google Calendar setup is not available yet. RealtyTechAI operations must configure the Google OAuth application.',
      });
    }
    return {
      clientId,
      clientSecret,
      redirectUri: `${publicApiUrl}/calendar/google/oauth/callback`,
    };
  }

  private async accessToken(connection: CalendarConnection): Promise<string> {
    if (
      connection.accessTokenEncrypted &&
      connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000
    ) {
      return decryptString(connection.accessTokenEncrypted);
    }
    const active = this.refreshing.get(connection.id);
    if (active) return active;
    const refresh = this.refreshToken(connection).finally(() => {
      this.refreshing.delete(connection.id);
    });
    this.refreshing.set(connection.id, refresh);
    return refresh;
  }

  private async refreshToken(connection: CalendarConnection) {
    if (
      !connection.refreshTokenEncrypted ||
      (connection.refreshTokenExpiresAt && connection.refreshTokenExpiresAt <= new Date())
    ) {
      throw new GoogleCalendarApiError(
        'GOOGLE_AUTH_REQUIRED',
        'Google Calendar authorization expired.',
        401,
        false,
      );
    }
    const config = this.googleConfig();
    const tokens = await this.google.refreshAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: decryptString(connection.refreshTokenEncrypted),
    });
    if (!tokens.access_token) {
      throw new GoogleCalendarApiError(
        'GOOGLE_AUTH_REQUIRED',
        'Google did not return an access token.',
        401,
        false,
      );
    }
    const tokenUpdate = {
      accessTokenEncrypted: encryptString(tokens.access_token),
      accessTokenExpiresAt: new Date(
      Date.now() + Math.max(tokens.expires_in || 3_600, 60) * 1_000,
      ),
      refreshTokenEncrypted: connection.refreshTokenEncrypted,
      refreshTokenExpiresAt: connection.refreshTokenExpiresAt,
    };
    if (tokens.refresh_token) {
      tokenUpdate.refreshTokenEncrypted = encryptString(tokens.refresh_token);
      tokenUpdate.refreshTokenExpiresAt = tokens.refresh_token_expires_in
        ? new Date(Date.now() + tokens.refresh_token_expires_in * 1_000)
        : connection.refreshTokenExpiresAt;
    }
    const updated = await this.connections.update(
      { id: connection.id, status: Not('disconnected') },
      tokenUpdate,
    );
    if (!updated.affected) {
      throw new GoogleCalendarApiError(
        'GOOGLE_AUTH_REQUIRED',
        'Google Calendar was disconnected.',
        401,
        false,
      );
    }
    Object.assign(connection, tokenUpdate);
    return tokens.access_token;
  }

  private async noteSyncSuccess(connection: CalendarConnection) {
    const update: Partial<CalendarConnection> = {
      lastSuccessfulSyncAt: new Date(),
      lastErrorCode: null,
      lastErrorAt: null,
    };
    if (connection.selectedCalendarId && connection.lastTestedAt) {
      update.status = 'connected';
    }
    const result = await this.connections.update(
      { id: connection.id, status: Not('disconnected') },
      update,
    );
    if (result.affected) Object.assign(connection, update);
  }

  private async handleProviderError(
    connection: CalendarConnection,
    error: unknown,
  ) {
    const code = this.errorCode(error);
    const update: Partial<CalendarConnection> = {
      lastErrorCode: code,
      lastErrorAt: new Date(),
      status: 'needs_attention',
    };
    const result = await this.connections
      .update(
        { id: connection.id, status: Not('disconnected') },
        update,
      )
      .catch(() => null);
    if (result?.affected) Object.assign(connection, update);
    if (error instanceof GoogleCalendarApiError && error.transient) {
      await this.operations?.createTask({
        tenantId: connection.tenantId,
        category: 'calendar_provider_failure',
        title: 'Google Calendar operation could not be verified',
        description:
          'RealtyTechAI stopped without claiming the appointment was booked. Run the calendar test and review any pending appointment.',
        priority: 'high',
        relatedEntityType: 'calendar_connection',
        relatedEntityId: connection.id,
        dedupeOpen: true,
      });
    }
  }

  private errorCode(error: unknown) {
    return error instanceof GoogleCalendarApiError
      ? error.code
      : String((error as any)?.response?.code || (error as any)?.code || 'GOOGLE_CALENDAR_FAILED');
  }

  private publicProviderException(error: unknown) {
    if (error instanceof ConflictException || error instanceof BadRequestException) return error;
    const code = this.errorCode(error);
    const message = publicError(code)?.what || 'Google Calendar could not complete the request.';
    if (error instanceof GoogleCalendarApiError && !error.transient) {
      return new ConflictException({ code, message });
    }
    return new ServiceUnavailableException({ code, message });
  }
}
