import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { decryptString, encryptString } from '../../common/crypto-secrets';
import { AuditService } from '../audit/audit.service';
import { Appointment } from '../client-operations/appointment.entity';
import { DurableJobsService } from '../durable-jobs/durable-jobs.service';
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
const GOOGLE_WATCH_TTL_SECONDS = 7 * 24 * 60 * 60;
const GOOGLE_WATCH_RENEWAL_LEAD_MS = 12 * 60 * 60_000;

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
};

export type GoogleChangeNotification = {
  channelId?: string;
  channelToken?: string;
  resourceId?: string;
  resourceState?: string;
  messageNumber?: string;
  channelExpiration?: string;
};

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function base64UrlSha256(value: string) {
  return createHash('sha256').update(value).digest('base64url');
}

function sameHash(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return (
    leftBuffer.length === 32 &&
    rightBuffer.length === 32 &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function compareUnsignedIntegerStrings(left: string, right: string) {
  const normalizedLeft = left.replace(/^0+(?=\d)/, '');
  const normalizedRight = right.replace(/^0+(?=\d)/, '');
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length < normalizedRight.length ? -1 : 1;
  }
  return normalizedLeft === normalizedRight
    ? 0
    : normalizedLeft < normalizedRight
      ? -1
      : 1;
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
export class CalendarService implements OnModuleInit {
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
    @Optional() private readonly durableJobs?: DurableJobsService,
    @Optional()
    @InjectRepository(Appointment)
    private readonly appointments?: Repository<Appointment>,
  ) {}

  onModuleInit() {
    this.durableJobs?.register('calendar.google.renew_watch', async (job) => {
      const connectionId = String(job.payload.connectionId || '');
      if (!connectionId) {
        throw new Error('Google watch renewal is missing connectionId');
      }
      const connection = await this.connections.findOne({
        where: { id: connectionId, provider: 'google' },
      });
      if (
        !connection ||
        connection.status === 'disconnected' ||
        !connection.selectedCalendarId
      ) {
        return;
      }
      return this.withTenantBookingLock(connection.tenantId, async () => {
        const current = await this.connections.findOne({
          where: { id: connection.id, provider: 'google' },
        });
        if (
          !current ||
          current.status === 'disconnected' ||
          !current.selectedCalendarId
        ) {
          return;
        }
        if (
          current.webhookExpiresAt &&
          current.webhookExpiresAt.getTime() >
            Date.now() + GOOGLE_WATCH_RENEWAL_LEAD_MS
        ) {
          return {
            nextRunAt: new Date(
              current.webhookExpiresAt.getTime() -
                GOOGLE_WATCH_RENEWAL_LEAD_MS,
            ),
          };
        }
        const expiration = await this.ensureGoogleWatch(current, true);
        if (!expiration) return;
        return {
          nextRunAt: new Date(
            Math.max(
              Date.now() + 60_000,
              expiration.getTime() - GOOGLE_WATCH_RENEWAL_LEAD_MS,
            ),
          ),
        };
      });
    });
  }

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
        changeNotifications: {
          status: 'reconciliation_only',
          expiresAt: null,
        },
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
      changeNotifications: {
        status:
          connection.webhookChannelId &&
          connection.webhookResourceId &&
          connection.webhookExpiresAt &&
          connection.webhookExpiresAt > new Date()
            ? 'active'
            : 'reconciliation_only',
        expiresAt: connection.webhookExpiresAt || null,
      },
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
        provider: 'google',
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
        .where(
          'state.stateHash = :stateHash AND state.provider = :provider',
          { stateHash, provider: 'google' },
        )
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
      selectedResourceType: null,
      selectedResourceUri: null,
      selectedResourceMetadata: null,
      webhookChannelId: null,
      webhookResourceId: null,
      webhookTokenHash: null,
      webhookSecretEncrypted: null,
      webhookExpiresAt: null,
      webhookLastMessageNumber: null,
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
      if (
        connection.selectedCalendarId &&
        connection.selectedCalendarId !== selected.id &&
        connection.webhookChannelId
      ) {
        await this.stopGoogleWatch(connection);
      }
      connection.selectedCalendarId = selected.id;
      connection.selectedCalendarName = selected.name;
      connection.selectedCalendarTimeZone = selected.timeZone;
      connection.selectedResourceType = 'calendar';
      connection.selectedResourceUri = selected.id;
      connection.selectedResourceMetadata = null;
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
      await this.configureGoogleWatch(connection);
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
    await this.stopGoogleWatch(connection);
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
      selectedResourceType: null,
      selectedResourceUri: null,
      selectedResourceMetadata: null,
      webhookChannelId: null,
      webhookResourceId: null,
      webhookTokenHash: null,
      webhookSecretEncrypted: null,
      webhookExpiresAt: null,
      webhookLastMessageNumber: null,
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
        start: input.start,
        end: input.end,
        timeZone: connection.selectedCalendarTimeZone || 'UTC',
      });
      const external = this.externalEvent(
        updated,
        input.calendarId || connection.selectedCalendarId!,
      );
      if (
        external.id !== input.eventId ||
        !external.startsAt ||
        !external.endsAt ||
        external.startsAt.getTime() !== input.start.getTime() ||
        external.endsAt.getTime() !== input.end.getTime()
      ) {
        throw new GoogleCalendarApiError(
          'GOOGLE_EVENT_RESULT_UNCERTAIN',
          'Google Calendar did not confirm the updated event time.',
          null,
          true,
          true,
        );
      }
      await this.noteSyncSuccess(connection);
      return external;
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

  async handleGoogleChangeNotification(input: GoogleChangeNotification) {
    const channelId = String(input.channelId || '').trim();
    const channelToken = String(input.channelToken || '').trim();
    const resourceId = String(input.resourceId || '').trim();
    const resourceState = String(input.resourceState || '').trim();
    const messageNumber = String(input.messageNumber || '').trim();
    if (
      !channelId ||
      channelId.length > 120 ||
      !channelToken ||
      channelToken.length > 256 ||
      !resourceId ||
      resourceId.length > 2_000 ||
      !['sync', 'exists', 'not_exists'].includes(resourceState) ||
      !/^\d{1,40}$/.test(messageNumber)
    ) {
      throw new BadRequestException('Invalid Google Calendar notification headers.');
    }

    const accepted = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CalendarConnection);
      const connection = await repository
        .createQueryBuilder('connection')
        .setLock('pessimistic_write')
        .where(
          'connection.provider = :provider AND connection.webhookChannelId = :channelId',
          { provider: 'google', channelId },
        )
        .getOne();
      if (!connection || !connection.webhookTokenHash) {
        throw new NotFoundException('Google Calendar notification channel not found.');
      }
      if (!sameHash(connection.webhookTokenHash, sha256(channelToken))) {
        throw new ForbiddenException('Invalid Google Calendar notification token.');
      }
      if (
        connection.webhookResourceId &&
        connection.webhookResourceId !== resourceId
      ) {
        throw new ForbiddenException('Invalid Google Calendar notification resource.');
      }
      const currentNumber = connection.webhookLastMessageNumber || '0';
      if (compareUnsignedIntegerStrings(messageNumber, currentNumber) <= 0) {
        return { connection, duplicate: true };
      }
      connection.webhookResourceId = resourceId;
      connection.webhookLastMessageNumber = messageNumber;
      const headerExpiration = input.channelExpiration
        ? new Date(input.channelExpiration)
        : null;
      if (headerExpiration && !Number.isNaN(headerExpiration.getTime())) {
        connection.webhookExpiresAt = headerExpiration;
      }
      await repository.save(connection);
      return { connection, duplicate: false };
    });

    if (accepted.duplicate || resourceState === 'sync') {
      return { accepted: true, duplicate: accepted.duplicate, scheduled: 0 };
    }

    const connection = accepted.connection;
    const appointments =
      connection.selectedCalendarId && this.appointments
        ? await this.appointments.find({
            where: {
              tenantId: connection.tenantId,
              externalProvider: 'google',
              externalCalendarId: connection.selectedCalendarId,
              externalEventId: Not(IsNull()),
              status: Not(In(['completed', 'no_show'])),
            },
            select: { id: true, tenantId: true },
          })
        : [];
    await Promise.all(
      appointments.map((appointment) =>
        this.durableJobs?.schedule({
          taskType: 'appointment.reconcile_calendar',
          tenantId: appointment.tenantId,
          dedupeKey: `appointment-calendar-reconcile:${appointment.id}`,
          payload: { appointmentId: appointment.id },
          maxAttempts: 12,
        }),
      ),
    );
    await this.audit?.recordSystemEvent({
      tenantId: connection.tenantId,
      eventType: 'calendar.change_notification_received',
      resourceType: 'calendar_connection',
      resourceId: connection.id,
      metadata: {
        provider: 'google',
        resourceState,
        scheduledAppointments: appointments.length,
      },
    });
    return { accepted: true, duplicate: false, scheduled: appointments.length };
  }

  private async configureGoogleWatch(connection: CalendarConnection) {
    let expiration: Date | null = null;
    try {
      expiration = await this.ensureGoogleWatch(connection);
    } catch (error) {
      await this.operations?.createTask({
        tenantId: connection.tenantId,
        category: 'calendar_provider_failure',
        title: 'Google Calendar change notifications need attention',
        description:
          'Direct booking remains protected by live free/busy and scheduled reconciliation, but Google push notifications could not be activated. Verify the public HTTPS webhook URL and test the connection again.',
        priority: 'high',
        relatedEntityType: 'calendar_connection',
        relatedEntityId: connection.id,
        dedupeOpen: true,
      });
      await this.audit?.recordSystemEvent({
        tenantId: connection.tenantId,
        eventType: 'calendar.change_subscription_failed',
        resourceType: 'calendar_connection',
        resourceId: connection.id,
        metadata: { provider: 'google', errorCode: this.errorCode(error) },
      });
      return;
    }
    if (!expiration || !this.durableJobs) return;
    await this.durableJobs.schedule({
      taskType: 'calendar.google.renew_watch',
      tenantId: connection.tenantId,
      dedupeKey: `calendar-google-renew-watch:${connection.id}`,
      payload: { connectionId: connection.id },
      nextRunAt: new Date(
        Math.max(
          Date.now() + 60_000,
          expiration.getTime() - GOOGLE_WATCH_RENEWAL_LEAD_MS,
        ),
      ),
      maxAttempts: 20,
    });
  }

  private async ensureGoogleWatch(
    connection: CalendarConnection,
    force = false,
  ): Promise<Date | null> {
    const address = this.googleWebhookUrl();
    if (!address || !connection.selectedCalendarId) return null;
    if (
      !force &&
      connection.webhookChannelId &&
      connection.webhookResourceId &&
      connection.webhookExpiresAt &&
      connection.webhookExpiresAt.getTime() >
        Date.now() + GOOGLE_WATCH_RENEWAL_LEAD_MS
    ) {
      return connection.webhookExpiresAt;
    }

    const accessToken = await this.accessToken(connection);
    const previous = {
      channelId: connection.webhookChannelId,
      resourceId: connection.webhookResourceId,
      tokenHash: connection.webhookTokenHash,
      expiresAt: connection.webhookExpiresAt,
      lastMessageNumber: connection.webhookLastMessageNumber,
    };
    const channelId = randomUUID();
    const channelToken = randomBytes(32).toString('base64url');
    const provisionalExpiration = new Date(
      Date.now() + GOOGLE_WATCH_TTL_SECONDS * 1_000,
    );
    Object.assign(connection, {
      webhookChannelId: channelId,
      webhookResourceId: null,
      webhookTokenHash: sha256(channelToken),
      webhookExpiresAt: provisionalExpiration,
      webhookLastMessageNumber: null,
    });
    await this.connections.save(connection);

    try {
      const channel = await this.google.watchEvents(accessToken, {
        calendarId: connection.selectedCalendarId,
        channelId,
        address,
        token: channelToken,
        ttlSeconds: GOOGLE_WATCH_TTL_SECONDS,
      });
      const expiration = new Date(Number(channel?.expiration));
      if (
        channel?.id !== channelId ||
        !channel?.resourceId ||
        Number.isNaN(expiration.getTime()) ||
        expiration.getTime() <= Date.now()
      ) {
        throw new GoogleCalendarApiError(
          'GOOGLE_WATCH_RESULT_UNCERTAIN',
          'Google did not confirm the notification channel.',
          null,
          true,
          true,
        );
      }
      const result = await this.connections.update(
        { id: connection.id, webhookChannelId: channelId },
        {
          webhookResourceId: channel.resourceId,
          webhookExpiresAt: expiration,
        },
      );
      if (!result.affected) {
        throw new GoogleCalendarApiError(
          'GOOGLE_WATCH_REPLACED',
          'The Google notification channel was replaced concurrently.',
          null,
          false,
        );
      }
      connection.webhookResourceId = channel.resourceId;
      connection.webhookExpiresAt = expiration;
      if (previous.channelId && previous.resourceId) {
        await this.google
          .stopChannel(accessToken, {
            channelId: previous.channelId,
            resourceId: previous.resourceId,
          })
          .catch(() => undefined);
      }
      await this.audit?.recordSystemEvent({
        tenantId: connection.tenantId,
        eventType: 'calendar.change_subscription_active',
        resourceType: 'calendar_connection',
        resourceId: connection.id,
        metadata: { provider: 'google', expiresAt: expiration.toISOString() },
      });
      return expiration;
    } catch (error) {
      await this.connections.update(
        { id: connection.id, webhookChannelId: channelId },
        {
          webhookChannelId: previous.channelId,
          webhookResourceId: previous.resourceId,
          webhookTokenHash: previous.tokenHash,
          webhookExpiresAt: previous.expiresAt,
          webhookLastMessageNumber: previous.lastMessageNumber,
        },
      );
      Object.assign(connection, {
        webhookChannelId: previous.channelId,
        webhookResourceId: previous.resourceId,
        webhookTokenHash: previous.tokenHash,
        webhookExpiresAt: previous.expiresAt,
        webhookLastMessageNumber: previous.lastMessageNumber,
      });
      throw error;
    }
  }

  private async stopGoogleWatch(connection: CalendarConnection) {
    const channelId = connection.webhookChannelId;
    const resourceId = connection.webhookResourceId;
    if (channelId && resourceId) {
      try {
        const accessToken = await this.accessToken(connection);
        await this.google.stopChannel(accessToken, { channelId, resourceId });
      } catch {
        await this.operations
          ?.createTask({
            tenantId: connection.tenantId,
            category: 'calendar_provider_failure',
            title: 'An old Google notification channel could not be stopped',
            description:
              'RealtyTechAI removed the local channel credentials. Google will expire the old channel automatically; review the integration if unexpected notifications continue.',
            priority: 'normal',
            relatedEntityType: 'calendar_connection',
            relatedEntityId: connection.id,
            dedupeOpen: true,
          })
          .catch(() => undefined);
      }
    }
    const cleared = {
      webhookChannelId: null,
      webhookResourceId: null,
      webhookTokenHash: null,
      webhookExpiresAt: null,
      webhookLastMessageNumber: null,
    };
    await this.connections.update({ id: connection.id }, cleared);
    Object.assign(connection, cleared);
  }

  private googleWebhookUrl() {
    const explicit = String(
      process.env.GOOGLE_CALENDAR_WEBHOOK_URL || '',
    ).trim();
    const publicApiUrl = String(process.env.PUBLIC_API_URL || '').replace(
      /\/+$/,
      '',
    );
    const value = explicit || (publicApiUrl ? `${publicApiUrl}/calendar/google/notifications` : '');
    if (!value) return null;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('GOOGLE_CALENDAR_WEBHOOK_URL must be a valid HTTPS URL');
    }
    const hostname = url.hostname.toLowerCase();
    const blockedHost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      blockedHost
    ) {
      throw new Error('GOOGLE_CALENDAR_WEBHOOK_URL must be a public HTTPS URL');
    }
    return url.toString();
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
    const update: {
      lastSuccessfulSyncAt: Date;
      lastErrorCode: null;
      lastErrorAt: null;
      status?: CalendarConnection['status'];
    } = {
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
    // A stale event ETag is scoped to one appointment. The OAuth grant,
    // selected calendar, and unrelated bookings can still be healthy.
    if (code === 'GOOGLE_CALENDAR_CHANGED') return;
    const update: {
      lastErrorCode: string;
      lastErrorAt: Date;
      status: CalendarConnection['status'];
    } = {
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
