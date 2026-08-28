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
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { DataSource, In, Not, Repository } from 'typeorm';
import { decryptString, encryptString } from '../../common/crypto-secrets';
import { AuditService } from '../audit/audit.service';
import { Appointment } from '../client-operations/appointment.entity';
import { DurableJobsService } from '../durable-jobs/durable-jobs.service';
import { OperationsService } from '../operations/operations.service';
import { BookingProviderApiError } from './booking-provider.error';
import {
  BookingProviderAdapter,
  CancelProviderAppointmentInput,
  CreateProviderAppointmentInput,
  ProviderAppointment,
  ProviderStatus,
  UpdateProviderAppointmentInput,
} from './booking-provider.types';
import { BookingWebhookReceipt } from './booking-webhook-receipt.entity';
import {
  CALENDLY_SCOPES,
  CalendlyClient,
  CalendlyInvitee,
  CalendlyScheduledEvent,
  calendlyId,
} from './calendly.client';
import {
  CalendarConnection,
  CalendarConnectionStatus,
} from './calendar-connection.entity';
import { CalendarOAuthState } from './calendar-oauth-state.entity';

const CALENDLY_RECONCILIATION_INTERVAL_MS = 15 * 60_000;
const OAUTH_STATE_TTL_MS = 10 * 60_000;
const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 180;

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function sameHash(left: string, right: string) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

function base64UrlSha256(value: string) {
  return createHash('sha256').update(value).digest('base64url');
}

function safeDate(value?: string | null) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function validEmail(value?: string | null) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

@Injectable()
export class CalendlyService implements BookingProviderAdapter, OnModuleInit {
  readonly name = 'calendly' as const;
  readonly storedProvider = 'calendly' as const;
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CalendarConnection)
    private readonly connections: Repository<CalendarConnection>,
    @InjectRepository(CalendarOAuthState)
    private readonly oauthStates: Repository<CalendarOAuthState>,
    @InjectRepository(BookingWebhookReceipt)
    private readonly webhookReceipts: Repository<BookingWebhookReceipt>,
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    private readonly calendly: CalendlyClient,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly operations?: OperationsService,
    @Optional() private readonly durableJobs?: DurableJobsService,
  ) {}

  onModuleInit() {
    this.durableJobs?.register('calendar.calendly.reconcile_all', async (job) => {
      const connection = await this.connections.findOne({
        where: {
          id: String(job.payload.connectionId || ''),
          provider: 'calendly',
        },
      });
      if (!connection || connection.status === 'disconnected') return;
      await this.scheduleAll(connection);
      return {
        nextRunAt: new Date(
          Date.now() + CALENDLY_RECONCILIATION_INTERVAL_MS,
        ),
      };
    });
  }

  async status(tenantId: string): Promise<ProviderStatus> {
    const connection = await this.connections.findOne({
      where: { tenantId, provider: 'calendly' },
    });
    if (!connection || connection.status === 'disconnected') {
      return this.disconnectedStatus();
    }
    const status = !connection.selectedCalendarId
      ? 'choose_resource'
      : connection.status === 'connected' && !connection.lastTestedAt
        ? 'configured'
        : connection.status;
    const connected = Boolean(
      status === 'connected' &&
        connection.selectedCalendarId &&
        connection.lastTestedAt &&
        connection.webhookChannelId &&
        connection.webhookSecretEncrypted &&
        connection.webhookTokenHash,
    );
    return {
      provider: this.name,
      status: connected ? 'connected' : status,
      connected,
      selectedResource: connection.selectedCalendarId
        ? {
            id: connection.selectedCalendarId,
            name: connection.selectedCalendarName || 'Calendly meeting type',
            timeZone: connection.selectedCalendarTimeZone || null,
            type: 'event_type',
          }
        : null,
      lastTestedAt: connection.lastTestedAt,
      lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
      changeNotifications: {
        status:
          connection.webhookChannelId &&
          connection.webhookSecretEncrypted &&
          connection.webhookTokenHash
            ? 'active'
            : 'reconciliation_only',
        expiresAt: null,
      },
      capabilities: {
        directBooking: true,
        automatedReschedule: false,
        cancellation: true,
        onlineMeeting: false,
        changeNotifications: true,
      },
      issue:
        status === 'choose_resource'
          ? {
              what: 'Calendly authorization succeeded, but no meeting type is selected.',
              why: 'RealtyTechAI must use Calendly rules for one specific meeting type.',
              how: 'Choose a meeting type and run Test connection.',
            }
          : status === 'configured'
            ? {
                what: 'The Calendly connection has not been tested.',
                why: 'Availability, direct scheduling, and webhooks must be proven before booking.',
                how: 'Run Test connection to finish setup.',
              }
            : !connected || status === 'needs_attention'
              ? this.publicIssue(connection.lastErrorCode)
              : null,
    };
  }

  async startOAuth(tenantId: string, userId: string) {
    if (!tenantId || !userId) {
      throw new BadRequestException('Missing workspace context');
    }
    const config = this.config();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(64).toString('base64url');
    await this.oauthStates.save(
      this.oauthStates.create({
        stateHash: sha256(state),
        tenantId,
        userId,
        provider: 'calendly',
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
      path: '/calendar/calendly/oauth/start',
      statusCode: 201,
      metadata: { provider: 'calendly', expiresInMinutes: 10 },
    });
    return {
      url: this.calendly.authorizationUrl({
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        state,
        codeChallenge: base64UrlSha256(verifier),
      }),
    };
  }

  async completeOAuth(code: string, rawState: string) {
    const stateHash = sha256(String(rawState || ''));
    const oauthState = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CalendarOAuthState);
      const row = await repository
        .createQueryBuilder('state')
        .setLock('pessimistic_write')
        .where(
          'state.stateHash = :stateHash AND state.provider = :provider',
          { stateHash, provider: 'calendly' },
        )
        .getOne();
      if (!row || row.consumedAt || row.expiresAt <= new Date()) {
        throw new BadRequestException(
          'The Calendly connection request expired. Start again.',
        );
      }
      row.consumedAt = new Date();
      await repository.save(row);
      return row;
    });
    const config = this.config();
    const tokens = await this.calendly.exchangeCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      code,
      codeVerifier: decryptString(oauthState.codeVerifierEncrypted),
    });
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new BadRequestException(
        'Calendly did not provide offline access. Reconnect and approve the requested permissions.',
      );
    }
    const user = await this.calendly.getCurrentUser(tokens.access_token);
    if (!user?.uri || !user.current_organization) {
      throw new BadRequestException(
        'Calendly did not return the connected user and organization.',
      );
    }
    const rawGrantedScopes = String(tokens.scope || '').trim();
    const grantedScopes = rawGrantedScopes
      .split(/\s+/)
      .filter(Boolean);
    const missingScopes = CALENDLY_SCOPES.filter(
      (scope) => !grantedScopes.includes(scope),
    );
    if (rawGrantedScopes && missingScopes.length) {
      throw new BadRequestException(
        'Calendly permissions were not fully granted. Reconnect and approve scheduling and webhook access.',
      );
    }
    let connection = await this.connections.findOne({
      where: { tenantId: oauthState.tenantId, provider: 'calendly' },
    });
    if (connection) {
      await this.stopWebhook(connection);
    } else {
      connection = this.connections.create({
        tenantId: oauthState.tenantId,
        provider: 'calendly',
      });
    }
    Object.assign(connection, {
      accessTokenEncrypted: encryptString(tokens.access_token),
      refreshTokenEncrypted: encryptString(tokens.refresh_token),
      accessTokenExpiresAt: new Date(
        Date.now() + Math.max(tokens.expires_in || 7_200, 60) * 1_000,
      ),
      refreshTokenExpiresAt: null,
      grantedScopes,
      providerAccountId: calendlyId(user.uri),
      providerTenantId: calendlyId(user.current_organization),
      status: 'configured' as CalendarConnectionStatus,
      selectedCalendarId: null,
      selectedCalendarName: null,
      selectedCalendarTimeZone: user.timezone || 'UTC',
      selectedResourceType: null,
      selectedResourceUri: null,
      selectedResourceMetadata: {
        userUri: user.uri,
        organizationUri: user.current_organization,
        schedulingUrl: user.scheduling_url || null,
      },
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
      path: '/calendar/calendly/oauth/callback',
      statusCode: 302,
      metadata: { provider: 'calendly', scopeCount: grantedScopes.length },
    });
    return connection;
  }

  async listResources(tenantId: string) {
    const connection = await this.requireAuthorized(tenantId);
    try {
      const userUri = String(
        connection.selectedResourceMetadata?.userUri || '',
      );
      if (!userUri) {
        throw new BookingProviderApiError(
          this.name,
          'CALENDLY_ACCOUNT_METADATA_MISSING',
          'Calendly account metadata is missing.',
          null,
          false,
        );
      }
      const token = await this.accessToken(connection);
      const eventTypes = await this.calendly.listEventTypes(token, userUri);
      return eventTypes.map((eventType) => ({
        id: calendlyId(eventType.uri),
        uri: eventType.uri,
        name: eventType.name || 'Calendly meeting',
        durationMinutes: eventType.duration || null,
        schedulingUrl: eventType.scheduling_url || null,
        timeZone: connection.selectedCalendarTimeZone || 'UTC',
        locations: eventType.locations || [],
        directBookingSupported: this.directBookingLocationSupported(
          eventType.locations,
        ),
      }));
    } catch (error) {
      await this.handleError(connection, error);
      throw this.publicException(error);
    }
  }

  async selectResource(tenantId: string, resourceId: string, actorId: string) {
    const clean = String(resourceId || '').trim();
    if (!clean) throw new BadRequestException('Choose a Calendly meeting type.');
    const resources = await this.listResources(tenantId);
    const selected = resources.find((item) => item.id === clean);
    if (!selected || !selected.durationMinutes) {
      throw new BadRequestException('Choose an active Calendly meeting type.');
    }
    if (!selected.directBookingSupported) {
      throw new BadRequestException(
        'Choose a Calendly meeting type with one host-defined location. Meeting types that ask the invitee for a location cannot be used for direct booking.',
      );
    }
    const connection = await this.requireAuthorized(tenantId);
    if (
      connection.selectedCalendarId &&
      connection.selectedCalendarId !== selected.id
    ) {
      await this.stopWebhook(connection);
    }
    Object.assign(connection, {
      selectedCalendarId: selected.id,
      selectedCalendarName: selected.name,
      selectedResourceType: 'event_type',
      selectedResourceUri: selected.uri,
      selectedResourceMetadata: {
        ...(connection.selectedResourceMetadata || {}),
        durationMinutes: selected.durationMinutes,
        schedulingUrl: selected.schedulingUrl,
        locations: selected.locations,
      },
      status: 'configured' as CalendarConnectionStatus,
      lastTestedAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
    });
    await this.connections.save(connection);
    await this.audit?.record({
      tenantId,
      actorId,
      action: 'calendar.selected',
      resourceType: 'calendar_connection',
      resourceId: connection.id,
      method: 'PUT',
      path: '/calendar/calendly/selection',
      statusCode: 200,
      metadata: { provider: 'calendly', resourceName: selected.name },
    });
    return this.status(tenantId);
  }

  async testConnection(tenantId: string, actorId: string) {
    const connection = await this.requireSelected(tenantId);
    try {
      const token = await this.accessToken(connection);
      const eventType = await this.calendly.getEventType(
        token,
        connection.selectedCalendarId!,
      );
      if (!eventType?.uri || eventType.active === false || !eventType.duration) {
        throw new BookingProviderApiError(
          this.name,
          'CALENDLY_EVENT_TYPE_UNAVAILABLE',
          'The selected Calendly meeting type is unavailable.',
          null,
          false,
        );
      }
      if (!this.directBookingLocationSupported(eventType.locations)) {
        throw new BookingProviderApiError(
          this.name,
          'CALENDLY_LOCATION_INPUT_REQUIRED',
          'The selected Calendly meeting type requires invitee-supplied location details.',
          null,
          false,
        );
      }
      const start = new Date(Date.now() + 60_000);
      await this.calendly.listAvailableTimes(token, {
        eventTypeUri: eventType.uri,
        start,
        end: new Date(start.getTime() + 24 * 60 * 60_000),
      });
      Object.assign(connection, {
        selectedCalendarName:
          eventType.name || connection.selectedCalendarName,
        selectedResourceUri: eventType.uri,
        selectedResourceMetadata: {
          ...(connection.selectedResourceMetadata || {}),
          durationMinutes: eventType.duration,
          schedulingUrl: eventType.scheduling_url || null,
          locations: eventType.locations || [],
        },
        status: 'connected' as CalendarConnectionStatus,
        lastTestedAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
        lastErrorCode: null,
        lastErrorAt: null,
      });
      await this.connections.save(connection);
      await this.ensureWebhook(connection);
      await this.durableJobs?.schedule({
        taskType: 'calendar.calendly.reconcile_all',
        tenantId,
        dedupeKey: `calendar-calendly-reconcile-all:${connection.id}`,
        payload: { connectionId: connection.id },
        nextRunAt: new Date(
          Date.now() + CALENDLY_RECONCILIATION_INTERVAL_MS,
        ),
        maxAttempts: 12,
      });
      await this.audit?.record({
        tenantId,
        actorId,
        action: 'calendar.connection_test_passed',
        resourceType: 'calendar_connection',
        resourceId: connection.id,
        method: 'POST',
        path: '/calendar/calendly/test',
        statusCode: 200,
        metadata: { provider: 'calendly' },
      });
      return this.status(tenantId);
    } catch (error) {
      await this.handleError(connection, error);
      throw this.publicException(error);
    }
  }

  async disconnect(tenantId: string, actorId: string) {
    const connection = await this.connections.findOne({
      where: { tenantId, provider: 'calendly' },
    });
    if (!connection) return this.disconnectedStatus();
    await this.stopWebhook(connection);
    Object.assign(connection, {
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      grantedScopes: null,
      providerAccountId: null,
      providerTenantId: null,
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
      status: 'disconnected' as CalendarConnectionStatus,
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
      path: '/calendar/calendly',
      statusCode: 200,
      metadata: { provider: 'calendly' },
    });
    return this.disconnectedStatus();
  }

  async readyBinding(tenantId: string) {
    const connection = await this.requireReady(tenantId);
    return {
      provider: this.name,
      storedProvider: this.storedProvider,
      connectionId: connection.id,
      resourceId: connection.selectedCalendarId!,
      resourceName:
        connection.selectedCalendarName || 'Calendly meeting type',
      timeZone: connection.selectedCalendarTimeZone || 'UTC',
    };
  }

  async checkAvailability(
    tenantId: string,
    start: Date,
    end: Date,
    _excludeEventId?: string | null,
    resourceId?: string | null,
  ) {
    this.validateWindow(start, end);
    const connection = await this.requireReady(tenantId);
    const eventTypeId = resourceId || connection.selectedCalendarId!;
    try {
      const token = await this.accessToken(connection);
      const eventType =
        eventTypeId === connection.selectedCalendarId &&
        connection.selectedResourceUri
          ? {
              uri: connection.selectedResourceUri,
              duration: Number(
                connection.selectedResourceMetadata?.durationMinutes || 0,
              ),
            }
          : await this.calendly.getEventType(token, eventTypeId);
      if (!eventType?.uri || !eventType.duration) {
        throw new BookingProviderApiError(
          this.name,
          'CALENDLY_AVAILABILITY_UNCERTAIN',
          'Calendly meeting rules could not be loaded.',
          null,
          true,
        );
      }
      if (end.getTime() - start.getTime() !== eventType.duration * 60_000) {
        await this.noteSuccess(connection);
        return {
          available: false,
          checkedAt: new Date(),
          timeZone: connection.selectedCalendarTimeZone,
        };
      }
      const windowStart = new Date(Math.max(Date.now() + 1_000, start.getTime() - 60_000));
      const slots = await this.calendly.listAvailableTimes(token, {
        eventTypeUri: eventType.uri,
        start: windowStart,
        end: new Date(start.getTime() + 24 * 60 * 60_000),
      });
      const available = slots.some(
        (slot) =>
          safeDate(slot.start_time)?.getTime() === start.getTime() &&
          slot.status !== 'unavailable' &&
          (slot.invitees_remaining === undefined || slot.invitees_remaining > 0),
      );
      await this.noteSuccess(connection);
      return {
        available,
        checkedAt: new Date(),
        timeZone: connection.selectedCalendarTimeZone,
      };
    } catch (error) {
      await this.handleError(connection, error);
      throw this.publicException(error);
    }
  }

  async createAppointment(input: CreateProviderAppointmentInput) {
    if (!validEmail(input.attendeeEmail)) {
      throw new ConflictException({
        code: 'CALENDLY_INVITEE_EMAIL_REQUIRED',
        message:
          'Calendly direct booking requires the lead’s valid email. Use the verified scheduling link or hand off to a person.',
      });
    }
    const connection = await this.requireReady(input.tenantId);
    const resourceId = input.resourceId || connection.selectedCalendarId!;
    const fingerprint = sha256(
      `${input.tenantId}:${input.idempotencyKey}`,
    ).slice(0, 64);
    try {
      const existing = await this.recoverBooking(
        connection,
        input,
        fingerprint,
      );
      if (existing) return existing;
    } catch (error) {
      await this.handleError(connection, error);
      throw this.publicException(error);
    }
    const availability = await this.checkAvailability(
      input.tenantId,
      input.start,
      input.end,
      null,
      resourceId,
    );
    if (!availability.available) {
      throw new ConflictException({
        code: 'CALENDAR_TIME_UNAVAILABLE',
        message: 'That time is not available in Calendly. Choose another time.',
      });
    }
    try {
      const token = await this.accessToken(connection);
      const eventType =
        resourceId === connection.selectedCalendarId &&
        connection.selectedResourceUri
          ? {
              uri: connection.selectedResourceUri,
              locations: connection.selectedResourceMetadata?.locations,
            }
          : await this.calendly.getEventType(token, resourceId);
      if (!eventType?.uri) {
        throw new BookingProviderApiError(
          this.name,
          'CALENDLY_RESOURCE_UNAVAILABLE',
          'The Calendly meeting type is no longer available.',
          null,
          false,
        );
      }
      if (!this.directBookingLocationSupported(eventType.locations)) {
        throw new BookingProviderApiError(
          this.name,
          'CALENDLY_LOCATION_INPUT_REQUIRED',
          'The selected Calendly meeting type requires invitee-supplied location details.',
          null,
          false,
        );
      }
      const location = this.directLocation(eventType.locations);
      const invitee = await this.calendly.createInvitee(token, {
        eventTypeUri: eventType.uri,
        start: input.start,
        name: input.attendeeName,
        email: input.attendeeEmail!.trim(),
        timeZone: input.timeZone,
        trackingFingerprint: fingerprint,
        location,
      });
      const eventId = calendlyId(invitee?.event);
      const inviteeId = calendlyId(invitee?.uri);
      if (!eventId || !inviteeId) {
        throw new BookingProviderApiError(
          this.name,
          'CALENDLY_BOOKING_RESULT_UNCERTAIN',
          'Calendly did not confirm the scheduled event and invitee.',
          null,
          true,
          true,
        );
      }
      const event = await this.calendly.getScheduledEvent(token, eventId);
      const external = this.external(connection, resourceId, event, invitee);
      this.validateCreated(external, input.start, input.end);
      await this.noteSuccess(connection);
      await this.audit?.recordSystemEvent({
        tenantId: input.tenantId,
        eventType: 'calendar.event_created',
        resourceType: 'lead',
        resourceId: input.leadId,
        metadata: {
          provider: 'calendly',
          startsAt: input.start.toISOString(),
          endsAt: input.end.toISOString(),
          idempotencyFingerprint: fingerprint.slice(0, 12),
        },
      });
      return external;
    } catch (error) {
      if (
        error instanceof BookingProviderApiError &&
        error.outcomeUncertain
      ) {
        const recovered = await this.recoverBooking(
          connection,
          input,
          fingerprint,
        ).catch(() => null);
        if (recovered) return recovered;
      }
      await this.handleError(connection, error);
      throw this.publicException(error);
    }
  }

  async getAppointment(
    tenantId: string,
    eventId: string,
    resourceId?: string | null,
    inviteeId?: string | null,
  ) {
    const connection = await this.requireReady(tenantId);
    try {
      const token = await this.accessToken(connection);
      const event = await this.calendly.getScheduledEvent(token, eventId);
      if (!event) {
        await this.noteSuccess(connection);
        return null;
      }
      const invitee = inviteeId
        ? await this.calendly.getInvitee(token, eventId, inviteeId)
        : null;
      await this.noteSuccess(connection);
      return this.external(
        connection,
        resourceId || connection.selectedCalendarId!,
        event,
        invitee,
      );
    } catch (error) {
      await this.handleError(connection, error);
      throw this.publicException(error);
    }
  }

  async updateAppointment(
    _input: UpdateProviderAppointmentInput,
  ): Promise<ProviderAppointment> {
    throw new ConflictException({
      code: 'CALENDLY_RESCHEDULE_URL_REQUIRED',
      message:
        'Calendly does not provide an API reschedule operation. Open this appointment’s verified Calendly reschedule link; RealtyTechAI will reconcile the resulting webhooks into the same appointment.',
    });
  }

  async cancelAppointment(input: CancelProviderAppointmentInput) {
    const connection = await this.requireReady(input.tenantId);
    try {
      const token = await this.accessToken(connection);
      await this.calendly.cancelEvent(token, input.eventId);
      await this.noteSuccess(connection);
      return { cancelled: true as const };
    } catch (error) {
      await this.handleError(connection, error);
      throw this.publicException(error);
    }
  }

  async handleWebhook(
    connectionId: string,
    callbackToken: string,
    rawBody: Buffer | undefined,
    signatureHeader: string,
    parsedBody: any,
  ) {
    const connection = await this.connections.findOne({
      where: { id: connectionId, provider: 'calendly' },
    });
    if (
      !connection ||
      connection.status === 'disconnected' ||
      !connection.webhookSecretEncrypted ||
      !connection.webhookTokenHash
    ) {
      throw new NotFoundException('Calendly webhook connection not found.');
    }
    if (!sameHash(connection.webhookTokenHash, sha256(callbackToken))) {
      throw new ForbiddenException('Invalid Calendly webhook callback token.');
    }
    if (!rawBody) {
      throw new BadRequestException('Calendly webhook raw body is required.');
    }
    this.verifyWebhookSignature(
      rawBody,
      signatureHeader,
      decryptString(connection.webhookSecretEncrypted),
    );
    const payloadHash = sha256(rawBody);
    const timestamp = this.signatureParts(signatureHeader).timestamp;
    const eventKey = `${timestamp}:${payloadHash}`.slice(0, 255);
    if (!(await this.recordWebhook(connection.tenantId, eventKey, payloadHash))) {
      return { accepted: true, duplicate: true, scheduled: 0 };
    }
    const eventType = String(parsedBody?.event || '');
    const payload = parsedBody?.payload || {};
    if (!['invitee.created', 'invitee.canceled'].includes(eventType)) {
      return { accepted: true, duplicate: false, scheduled: 0 };
    }
    const oldInviteeUri = String(payload.old_invitee || '');
    const newInviteeUri = String(payload.new_invitee || '');
    const rescheduled = payload.rescheduled === true;
    let appointment: Appointment | null = null;
    if (eventType === 'invitee.created' && oldInviteeUri) {
      appointment = await this.rebindReschedule(
        connection,
        oldInviteeUri,
        String(payload.uri || ''),
        String(payload.event || ''),
      );
    } else if (
      eventType === 'invitee.canceled' &&
      rescheduled &&
      newInviteeUri
    ) {
      appointment = await this.rebindReschedule(
        connection,
        String(payload.uri || ''),
        newInviteeUri,
        '',
      );
    } else if (eventType === 'invitee.canceled' && rescheduled) {
      // The paired invitee.created payload carries the authoritative new URI.
      // Waiting for it avoids briefly cancelling the internal appointment.
      return { accepted: true, duplicate: false, scheduled: 0 };
    } else {
      appointment = await this.findWebhookAppointment(
        connection.tenantId,
        String(payload.event || ''),
        String(payload.uri || ''),
      );
    }
    if (appointment && this.durableJobs) {
      await this.durableJobs.schedule({
        taskType: 'appointment.reconcile_calendar',
        tenantId: appointment.tenantId,
        dedupeKey: `appointment-calendar-reconcile:${appointment.id}`,
        payload: { appointmentId: appointment.id },
        maxAttempts: 12,
      });
    }
    await this.audit?.recordSystemEvent({
      tenantId: connection.tenantId,
      eventType: 'calendar.change_notification_received',
      resourceType: 'calendar_connection',
      resourceId: connection.id,
      metadata: {
        provider: 'calendly',
        eventType,
        matchedAppointment: Boolean(appointment),
        rescheduled,
      },
    });
    return {
      accepted: true,
      duplicate: false,
      scheduled: appointment ? 1 : 0,
    };
  }

  private disconnectedStatus(): ProviderStatus {
    return {
      provider: this.name,
      status: 'disconnected',
      connected: false,
      selectedResource: null,
      lastTestedAt: null,
      lastSuccessfulSyncAt: null,
      changeNotifications: { status: 'reconciliation_only', expiresAt: null },
      capabilities: {
        directBooking: true,
        automatedReschedule: false,
        cancellation: true,
        onlineMeeting: false,
        changeNotifications: true,
      },
      issue: {
        what: 'Calendly is not connected.',
        why: 'Real Calendly availability and direct booking cannot be confirmed.',
        how: 'Connect Calendly, choose a meeting type, and run Test connection.',
      },
    };
  }

  private publicIssue(code?: string | null) {
    if (code === 'CALENDLY_AUTH_REQUIRED') {
      return {
        what: 'Calendly authorization expired or was revoked.',
        why: 'RealtyTechAI cannot verify availability or manage bookings.',
        how: 'Reconnect Calendly, choose the meeting type again, and run Test connection.',
      };
    }
    if (
      code === 'CALENDLY_REQUEST_REJECTED' ||
      code === 'CALENDLY_WEBHOOK_UNAVAILABLE'
    ) {
      return {
        what: 'Calendly direct scheduling or webhooks are unavailable for this account.',
        why: 'The account plan, OAuth scopes, or webhook permission does not support the required production workflow.',
        how: 'Use an eligible paid Calendly plan, approve the requested scopes, then reconnect and test again.',
      };
    }
    return {
      what: 'The Calendly connection needs attention.',
      why: 'Availability, direct booking, or webhook delivery could not be verified.',
      how: 'Run Test connection. Reconnect Calendly if authorization is rejected.',
    };
  }

  private validateCreated(
    event: ProviderAppointment,
    start: Date,
    end: Date,
  ) {
    if (
      !event.id ||
      !event.inviteeId ||
      !event.startsAt ||
      !event.endsAt ||
      event.startsAt.getTime() !== start.getTime() ||
      event.endsAt.getTime() !== end.getTime() ||
      event.status === 'cancelled'
    ) {
      throw new BookingProviderApiError(
        this.name,
        'CALENDLY_BOOKING_RESULT_UNCERTAIN',
        'Calendly did not confirm the exact booking.',
        null,
        true,
        true,
      );
    }
  }

  private external(
    connection: CalendarConnection,
    resourceId: string,
    event: CalendlyScheduledEvent | null,
    invitee: CalendlyInvitee | null | undefined,
  ): ProviderAppointment {
    const eventId = calendlyId(event?.uri || invitee?.event);
    const inviteeId = calendlyId(invitee?.uri);
    const updated = safeDate(invitee?.updated_at || event?.updated_at);
    const joinCandidate = String(
      event?.location?.join_url || event?.location?.location || '',
    );
    const joinUrl = this.safeExternalUrl(joinCandidate);
    return {
      provider: this.name,
      storedProvider: this.storedProvider,
      connectionId: connection.id,
      resourceId,
      id: eventId,
      inviteeId: inviteeId || null,
      version: updated?.toISOString() || null,
      status:
        event?.status === 'canceled' || invitee?.status === 'canceled'
          ? 'cancelled'
          : 'confirmed',
      startsAt: safeDate(event?.start_time),
      endsAt: safeDate(event?.end_time),
      joinUrl,
      cancelUrl: this.safeCalendlyUrl(invitee?.cancel_url),
      rescheduleUrl: this.safeCalendlyUrl(invitee?.reschedule_url),
      providerUpdatedAt: updated,
    };
  }

  private safeExternalUrl(value?: string | null) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && !url.username && !url.password
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  }

  private safeCalendlyUrl(value?: string | null) {
    const safe = this.safeExternalUrl(value);
    if (!safe) return null;
    const host = new URL(safe).hostname.toLowerCase();
    return host === 'calendly.com' || host.endsWith('.calendly.com')
      ? safe
      : null;
  }

  private async recoverBooking(
    connection: CalendarConnection,
    input: CreateProviderAppointmentInput,
    fingerprint: string,
  ) {
    const token = await this.accessToken(connection);
    const recovered = await this.calendly.findInviteeByTracking(token, {
      userUri: String(connection.selectedResourceMetadata?.userUri || ''),
      start: input.start,
      end: input.end,
      email: input.attendeeEmail!,
      trackingFingerprint: fingerprint,
    });
    if (!recovered) return null;
    const event = this.external(
      connection,
      input.resourceId || connection.selectedCalendarId!,
      recovered.event,
      recovered.invitee,
    );
    this.validateCreated(event, input.start, input.end);
    await this.noteSuccess(connection);
    return event;
  }

  private directLocation(locations: unknown) {
    if (!Array.isArray(locations) || locations.length !== 1) return null;
    const location = locations[0] as { kind?: string; location?: string };
    if (!this.directBookingLocationSupported(locations)) return null;
    return {
      kind: location.kind!,
      ...(location.location ? { location: location.location } : {}),
    };
  }

  private directBookingLocationSupported(locations: unknown) {
    if (locations === null || locations === undefined) return true;
    if (!Array.isArray(locations)) return false;
    if (locations.length === 0) return true;
    if (locations.length !== 1) return false;
    const location = locations[0] as { kind?: string };
    return Boolean(
      location.kind &&
        location.kind !== 'ask_invitee' &&
        location.kind !== 'outbound_call',
    );
  }

  private async ensureWebhook(connection: CalendarConnection) {
    if (
      connection.webhookChannelId &&
      connection.webhookSecretEncrypted &&
      connection.webhookTokenHash
    ) {
      return;
    }
    const callbackToken = randomBytes(32).toString('base64url');
    const callback = this.webhookUrl(connection.id, callbackToken);
    const signingKey = String(
      process.env.CALENDLY_WEBHOOK_SIGNING_KEY || '',
    ).trim();
    if (!callback || !signingKey) {
      throw new BookingProviderApiError(
        this.name,
        'CALENDLY_WEBHOOK_UNAVAILABLE',
        'Calendly webhook configuration is missing.',
        null,
        false,
      );
    }
    const token = await this.accessToken(connection);
    const organizationUri = String(
      connection.selectedResourceMetadata?.organizationUri || '',
    );
    const userUri = String(connection.selectedResourceMetadata?.userUri || '');
    if (!organizationUri || !userUri) {
      throw new BookingProviderApiError(
        this.name,
        'CALENDLY_ACCOUNT_METADATA_MISSING',
        'Calendly account metadata is missing.',
        null,
        false,
      );
    }
    const subscription = await this.calendly.createWebhookSubscription(token, {
      callbackUrl: callback,
      organizationUri,
      userUri,
    });
    const subscriptionId = calendlyId(subscription?.uri);
    if (!subscriptionId || subscription?.state === 'disabled') {
      throw new BookingProviderApiError(
        this.name,
        'CALENDLY_WEBHOOK_UNAVAILABLE',
        'Calendly did not confirm the webhook subscription.',
        null,
        false,
      );
    }
    Object.assign(connection, {
      webhookChannelId: subscriptionId,
      webhookResourceId: userUri,
      webhookSecretEncrypted: encryptString(signingKey),
      webhookTokenHash: sha256(callbackToken),
      webhookExpiresAt: null,
      webhookLastMessageNumber: null,
    });
    await this.connections.save(connection);
  }

  private async stopWebhook(connection: CalendarConnection) {
    if (connection.webhookChannelId && connection.accessTokenEncrypted) {
      try {
        const token = await this.accessToken(connection);
        await this.calendly.deleteWebhookSubscription(
          token,
          connection.webhookChannelId,
        );
      } catch {
        // Local credentials are removed immediately. An operations review can
        // remove a remote subscription if Calendly did not accept deletion.
      }
    }
    Object.assign(connection, {
      webhookChannelId: null,
      webhookResourceId: null,
      webhookTokenHash: null,
      webhookSecretEncrypted: null,
      webhookExpiresAt: null,
      webhookLastMessageNumber: null,
    });
    await this.connections.save(connection);
  }

  private signatureParts(header: string) {
    const fields = new Map(
      String(header || '')
        .split(',')
        .map((part) => part.trim().split('=', 2) as [string, string]),
    );
    return {
      timestamp: String(fields.get('t') || ''),
      signature: String(fields.get('v1') || ''),
    };
  }

  private verifyWebhookSignature(
    rawBody: Buffer,
    header: string,
    signingKey: string,
  ) {
    const { timestamp, signature } = this.signatureParts(header);
    if (!/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) {
      throw new ForbiddenException('Invalid Calendly webhook signature.');
    }
    const timestampSeconds = Number(timestamp);
    if (
      !Number.isFinite(timestampSeconds) ||
      Math.abs(Math.floor(Date.now() / 1_000) - timestampSeconds) >
        WEBHOOK_SIGNATURE_TOLERANCE_SECONDS
    ) {
      throw new ForbiddenException('Expired Calendly webhook signature.');
    }
    const expected = createHmac('sha256', signingKey)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest('hex');
    const supplied = Buffer.from(signature, 'hex');
    const actual = Buffer.from(expected, 'hex');
    if (
      supplied.length !== actual.length ||
      !timingSafeEqual(supplied, actual)
    ) {
      throw new ForbiddenException('Invalid Calendly webhook signature.');
    }
  }

  private async rebindReschedule(
    connection: CalendarConnection,
    oldInviteeUri: string,
    newInviteeUri: string,
    newEventUri: string,
  ) {
    const oldInviteeId = calendlyId(oldInviteeUri);
    const newInviteeId = calendlyId(newInviteeUri);
    if (!oldInviteeId || !newInviteeId) return null;
    const existing = await this.appointments.findOne({
      where: {
        tenantId: connection.tenantId,
        externalProvider: 'calendly',
        externalInviteeId: oldInviteeId,
      },
    });
    if (!existing) return null;
    const parsedEventId = this.eventIdFromInviteeUri(newInviteeUri);
    const newEventId = calendlyId(newEventUri) || parsedEventId;
    if (!newEventId) return null;
    const token = await this.accessToken(connection);
    const [event, invitee] = await Promise.all([
      this.calendly.getScheduledEvent(token, newEventId),
      this.calendly.getInvitee(token, newEventId, newInviteeId),
    ]);
    if (!event || !invitee || invitee.status === 'canceled') return null;
    const result = this.external(
      connection,
      existing.externalCalendarId || connection.selectedCalendarId!,
      event,
      invitee,
    );
    if (!result.startsAt || !result.endsAt) return null;
    await this.appointments.update(
      {
        id: existing.id,
        tenantId: existing.tenantId,
        externalProvider: 'calendly',
        externalInviteeId: oldInviteeId,
      },
      {
        externalEventId: result.id,
        externalInviteeId: result.inviteeId,
        externalEventEtag: result.version,
        externalJoinUrl: result.joinUrl,
        externalCancelUrl: result.cancelUrl,
        externalRescheduleUrl: result.rescheduleUrl,
        externalProviderUpdatedAt: result.providerUpdatedAt,
      },
    );
    return this.appointments.findOne({ where: { id: existing.id } });
  }

  private eventIdFromInviteeUri(uri: string) {
    const match = uri.match(/scheduled_events\/([^/]+)\/invitees\//i);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }

  private findWebhookAppointment(
    tenantId: string,
    eventUri: string,
    inviteeUri: string,
  ) {
    const eventId = calendlyId(eventUri);
    const inviteeId = calendlyId(inviteeUri);
    if (inviteeId) {
      return this.appointments.findOne({
        where: {
          tenantId,
          externalProvider: 'calendly',
          externalInviteeId: inviteeId,
        },
      });
    }
    return eventId
      ? this.appointments.findOne({
          where: {
            tenantId,
            externalProvider: 'calendly',
            externalEventId: eventId,
          },
        })
      : Promise.resolve(null);
  }

  private async scheduleAll(connection: CalendarConnection) {
    const appointments = await this.appointments.find({
      where: {
        tenantId: connection.tenantId,
        externalProvider: 'calendly',
        status: Not(In(['completed', 'no_show'])),
      },
      select: { id: true, tenantId: true },
    });
    if (this.durableJobs) {
      await Promise.all(
        appointments.map((appointment) =>
          this.durableJobs!.schedule({
            taskType: 'appointment.reconcile_calendar',
            tenantId: appointment.tenantId,
            dedupeKey: `appointment-calendar-reconcile:${appointment.id}`,
            payload: { appointmentId: appointment.id },
            maxAttempts: 12,
          }),
        ),
      );
    }
    return appointments.length;
  }

  private async recordWebhook(
    tenantId: string,
    eventKey: string,
    payloadHash: string,
  ) {
    try {
      await this.webhookReceipts.save(
        this.webhookReceipts.create({
          tenantId,
          provider: 'calendly',
          eventKey,
          payloadHash,
          receivedAt: new Date(),
        }),
      );
      return true;
    } catch (error: any) {
      if (String(error?.code || '') === '23505') return false;
      throw error;
    }
  }

  private async requireAuthorized(tenantId: string) {
    const connection = await this.connections.findOne({
      where: { tenantId, provider: 'calendly' },
    });
    if (
      !connection ||
      connection.status === 'disconnected' ||
      !connection.accessTokenEncrypted ||
      !connection.refreshTokenEncrypted
    ) {
      throw new ConflictException({
        code: 'CALENDAR_NOT_CONNECTED',
        message:
          'Connect Calendly before scheduling. Use the verified booking link or hand off to a person.',
      });
    }
    return connection;
  }

  private async requireSelected(tenantId: string) {
    const connection = await this.requireAuthorized(tenantId);
    if (!connection.selectedCalendarId || !connection.selectedResourceUri) {
      throw new ConflictException({
        code: 'CALENDAR_NOT_SELECTED',
        message: 'Choose which Calendly meeting type RealtyTechAI should use.',
      });
    }
    return connection;
  }

  private async requireReady(tenantId: string) {
    const connection = await this.requireSelected(tenantId);
    const retryable =
      connection.status === 'needs_attention' &&
      [
        'CALENDLY_TEMPORARY_FAILURE',
        'CALENDLY_TIMEOUT',
        'CALENDLY_AVAILABILITY_UNCERTAIN',
        'CALENDLY_BOOKING_RESULT_UNCERTAIN',
      ].includes(connection.lastErrorCode || '');
    if (
      (!retryable && connection.status !== 'connected') ||
      !connection.lastTestedAt ||
      !connection.webhookChannelId ||
      !connection.webhookSecretEncrypted ||
      !connection.webhookTokenHash
    ) {
      throw new ConflictException({
        code: 'CALENDAR_NEEDS_ATTENTION',
        message:
          'Test the Calendly connection before scheduling. Use the verified booking link or hand off to a person.',
      });
    }
    return connection;
  }

  private async accessToken(connection: CalendarConnection) {
    if (
      connection.accessTokenEncrypted &&
      connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000
    ) {
      return decryptString(connection.accessTokenEncrypted);
    }
    const active = this.refreshing.get(connection.id);
    if (active) return active;
    const refresh = this.refresh(connection).finally(() =>
      this.refreshing.delete(connection.id),
    );
    this.refreshing.set(connection.id, refresh);
    return refresh;
  }

  private async refresh(connection: CalendarConnection) {
    if (!connection.refreshTokenEncrypted) {
      throw new BookingProviderApiError(
        this.name,
        'CALENDLY_AUTH_REQUIRED',
        'Calendly authorization expired.',
        401,
        false,
      );
    }
    const config = this.config();
    const tokens = await this.calendly.refreshAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: decryptString(connection.refreshTokenEncrypted),
    });
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new BookingProviderApiError(
        this.name,
        'CALENDLY_AUTH_REQUIRED',
        'Calendly did not rotate the access and refresh tokens.',
        401,
        false,
      );
    }
    const update = {
      accessTokenEncrypted: encryptString(tokens.access_token),
      accessTokenExpiresAt: new Date(
        Date.now() + Math.max(tokens.expires_in || 7_200, 60) * 1_000,
      ),
      refreshTokenEncrypted: encryptString(tokens.refresh_token),
    };
    const result = await this.connections.update(
      { id: connection.id, status: Not('disconnected') },
      update,
    );
    if (!result.affected) {
      throw new BookingProviderApiError(
        this.name,
        'CALENDLY_AUTH_REQUIRED',
        'Calendly was disconnected.',
        401,
        false,
      );
    }
    Object.assign(connection, update);
    return tokens.access_token;
  }

  private async noteSuccess(connection: CalendarConnection) {
    const update: {
      lastSuccessfulSyncAt: Date;
      lastErrorCode: null;
      lastErrorAt: null;
      status?: CalendarConnectionStatus;
    } = {
      lastSuccessfulSyncAt: new Date(),
      lastErrorCode: null,
      lastErrorAt: null,
      ...(connection.selectedCalendarId && connection.lastTestedAt
        ? { status: 'connected' as CalendarConnectionStatus }
        : {}),
    };
    const result = await this.connections.update(
      { id: connection.id, status: Not('disconnected') },
      update,
    );
    if (result.affected) Object.assign(connection, update);
  }

  private async handleError(connection: CalendarConnection, error: unknown) {
    const code = this.errorCode(error);
    const update: {
      status: CalendarConnectionStatus;
      lastErrorCode: string;
      lastErrorAt: Date;
    } = {
      status: 'needs_attention',
      lastErrorCode: code,
      lastErrorAt: new Date(),
    };
    await this.connections
      .update({ id: connection.id, status: Not('disconnected') }, update)
      .catch(() => undefined);
    Object.assign(connection, update);
  }

  private errorCode(error: unknown) {
    return error instanceof BookingProviderApiError
      ? error.code
      : String((error as any)?.response?.code || (error as any)?.code || 'CALENDLY_FAILED');
  }

  private publicException(error: unknown) {
    if (
      error instanceof ConflictException ||
      error instanceof BadRequestException
    ) {
      return error;
    }
    const code = this.errorCode(error);
    const message = this.publicIssue(code).what;
    if (error instanceof BookingProviderApiError && !error.transient) {
      return new ConflictException({ code, message });
    }
    return new ServiceUnavailableException({ code, message });
  }

  private validateWindow(start: Date, end: Date) {
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start ||
      start <= new Date() ||
      end.getTime() - start.getTime() > 8 * 60 * 60_000
    ) {
      throw new BadRequestException(
        'Calendly availability requires a future interval no longer than eight hours.',
      );
    }
  }

  private config() {
    const clientId = String(process.env.CALENDLY_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.CALENDLY_CLIENT_SECRET || '').trim();
    const api = String(process.env.PUBLIC_API_URL || '').replace(/\/+$/, '');
    if (!clientId || !clientSecret || !api) {
      throw new ServiceUnavailableException({
        code: 'CALENDLY_NOT_CONFIGURED',
        message:
          'Calendly setup is not available yet. RealtyTechAI operations must configure the OAuth application.',
      });
    }
    return {
      clientId,
      clientSecret,
      redirectUri: `${api}/calendar/calendly/oauth/callback`,
    };
  }

  private webhookUrl(connectionId: string, callbackToken: string) {
    const explicit = String(process.env.CALENDLY_WEBHOOK_URL || '').trim();
    const api = String(process.env.PUBLIC_API_URL || '').replace(/\/+$/, '');
    const value = explicit || (api ? `${api}/calendar/calendly/notifications` : '');
    if (!value) return null;
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
    ) {
      throw new Error('CALENDLY_WEBHOOK_URL must be a public HTTPS URL');
    }
    url.searchParams.set('connection', connectionId);
    url.searchParams.set('token', callbackToken);
    return url.toString();
  }
}
