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
  CalendarConnection,
  CalendarConnectionStatus,
} from './calendar-connection.entity';
import { CalendarOAuthState } from './calendar-oauth-state.entity';
import {
  MICROSOFT_CALENDAR_SCOPES,
  MicrosoftCalendarClient,
  MicrosoftEvent,
} from './microsoft-calendar.client';

const OAUTH_STATE_TTL_MS = 10 * 60_000;
const MICROSOFT_SUBSCRIPTION_TTL_MS = 6 * 24 * 60 * 60_000;
const MICROSOFT_RENEWAL_LEAD_MS = 12 * 60 * 60_000;

export type MicrosoftChangeNotification = {
  id?: string;
  subscriptionId?: string;
  clientState?: string;
  changeType?: string;
  resource?: string;
  resourceData?: { id?: string; '@odata.id'?: string };
  lifecycleEvent?:
    | 'reauthorizationRequired'
    | 'subscriptionRemoved'
    | 'missed';
};

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

function validEmail(value?: string | null) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

@Injectable()
export class MicrosoftCalendarService
  implements BookingProviderAdapter, OnModuleInit
{
  readonly name = 'microsoft_calendar' as const;
  readonly storedProvider = 'microsoft' as const;
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
    private readonly graph: MicrosoftCalendarClient,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly operations?: OperationsService,
    @Optional() private readonly durableJobs?: DurableJobsService,
  ) {}

  onModuleInit() {
    this.durableJobs?.register(
      'calendar.microsoft.renew_subscription',
      async (job) => {
        const connection = await this.connections.findOne({
          where: {
            id: String(job.payload.connectionId || ''),
            provider: 'microsoft',
          },
        });
        if (!connection || connection.status === 'disconnected') return;
        if (
          connection.webhookExpiresAt &&
          connection.webhookExpiresAt.getTime() >
            Date.now() + MICROSOFT_RENEWAL_LEAD_MS
        ) {
          return {
            nextRunAt: new Date(
              connection.webhookExpiresAt.getTime() -
                MICROSOFT_RENEWAL_LEAD_MS,
            ),
          };
        }
        const expiration = await this.ensureSubscription(connection, true);
        if (!expiration) return;
        return {
          nextRunAt: new Date(
            Math.max(
              Date.now() + 60_000,
              expiration.getTime() - MICROSOFT_RENEWAL_LEAD_MS,
            ),
          ),
        };
      },
    );
  }

  async status(tenantId: string): Promise<ProviderStatus> {
    const connection = await this.connections.findOne({
      where: { tenantId, provider: 'microsoft' },
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
        connection.lastTestedAt,
    );
    return {
      provider: this.name,
      status,
      connected,
      selectedResource: connection.selectedCalendarId
        ? {
            id: connection.selectedCalendarId,
            name: connection.selectedCalendarName || 'Outlook calendar',
            timeZone: connection.selectedCalendarTimeZone || null,
            type: 'calendar',
          }
        : null,
      lastTestedAt: connection.lastTestedAt,
      lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
      changeNotifications: {
        status:
          connection.webhookChannelId &&
          connection.webhookTokenHash &&
          connection.webhookExpiresAt &&
          connection.webhookExpiresAt > new Date()
            ? 'active'
            : 'reconciliation_only',
        expiresAt: connection.webhookExpiresAt || null,
      },
      capabilities: {
        directBooking: true,
        automatedReschedule: true,
        cancellation: true,
        onlineMeeting: true,
        changeNotifications: true,
      },
      issue:
        status === 'choose_resource'
          ? {
              what: 'Microsoft authorization succeeded, but no calendar is selected.',
              why: 'RealtyTechAI must know exactly where appointments belong.',
              how: 'Choose a writable Outlook calendar and run Test connection.',
            }
          : status === 'configured'
            ? {
                what: 'The Microsoft calendar connection has not been tested.',
                why: 'Write access and authoritative availability must be proven before booking.',
                how: 'Run Test connection to finish setup.',
              }
            : status === 'needs_attention'
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
        provider: 'microsoft',
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
      path: '/calendar/microsoft/oauth/start',
      statusCode: 201,
      metadata: { provider: 'microsoft', expiresInMinutes: 10 },
    });
    return {
      url: this.graph.authorizationUrl({
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
          { stateHash, provider: 'microsoft' },
        )
        .getOne();
      if (!row || row.consumedAt || row.expiresAt <= new Date()) {
        throw new BadRequestException(
          'The Microsoft connection request expired. Start again.',
        );
      }
      row.consumedAt = new Date();
      await repository.save(row);
      return row;
    });
    const config = this.config();
    const tokens = await this.graph.exchangeCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      code,
      codeVerifier: decryptString(oauthState.codeVerifierEncrypted),
    });
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new BadRequestException(
        'Microsoft did not provide offline calendar access. Reconnect and approve the requested permissions.',
      );
    }
    const grantedScopes = String(tokens.scope || '')
      .split(/\s+/)
      .filter(Boolean);
    const missing = MICROSOFT_CALENDAR_SCOPES.filter(
      (scope) => !grantedScopes.includes(scope),
    );
    if (missing.length) {
      throw new BadRequestException(
        'Microsoft calendar permissions were not fully granted. Reconnect and approve calendar access.',
      );
    }
    const profile = await this.graph.getProfile(tokens.access_token);
    if (!profile?.id) {
      throw new BadRequestException(
        'Microsoft did not return an account identifier.',
      );
    }
    let connection = await this.connections.findOne({
      where: { tenantId: oauthState.tenantId, provider: 'microsoft' },
    });
    if (connection) {
      await this.stopSubscription(connection);
    } else {
      connection = this.connections.create({
        tenantId: oauthState.tenantId,
        provider: 'microsoft',
      });
    }
    Object.assign(connection, {
      accessTokenEncrypted: encryptString(tokens.access_token),
      refreshTokenEncrypted: encryptString(tokens.refresh_token),
      accessTokenExpiresAt: new Date(
        Date.now() + Math.max(tokens.expires_in || 3_600, 60) * 1_000,
      ),
      refreshTokenExpiresAt: null,
      grantedScopes,
      providerAccountId: profile.id,
      providerTenantId: this.tenantIdFromIdToken(tokens.id_token),
      status: 'configured' as CalendarConnectionStatus,
      selectedCalendarId: null,
      selectedCalendarName: null,
      selectedCalendarTimeZone: null,
      selectedResourceType: null,
      selectedResourceUri: null,
      selectedResourceMetadata: {
        accountName: String(profile.displayName || '').slice(0, 255),
        accountAddress: String(
          profile.mail || profile.userPrincipalName || '',
        ).slice(0, 320),
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
      path: '/calendar/microsoft/oauth/callback',
      statusCode: 302,
      metadata: { provider: 'microsoft', scopeCount: grantedScopes.length },
    });
    return connection;
  }

  async listResources(tenantId: string) {
    const connection = await this.requireAuthorized(tenantId);
    try {
      const accessToken = await this.accessToken(connection);
      const [calendars, timeZone] = await Promise.all([
        this.graph.listCalendars(accessToken),
        this.graph.getMailboxTimeZone(accessToken),
      ]);
      return calendars.map((calendar) => ({
        id: calendar.id,
        name: calendar.name || 'Outlook calendar',
        primary: calendar.isDefaultCalendar === true,
        timeZone,
        accessRole: calendar.canEdit ? 'writer' : 'reader',
        teamsSupported: (calendar.allowedOnlineMeetingProviders || []).includes(
          'teamsForBusiness',
        ),
      }));
    } catch (error) {
      await this.handleError(connection, error);
      throw this.publicException(error);
    }
  }

  async selectResource(tenantId: string, resourceId: string, actorId: string) {
    const clean = String(resourceId || '').trim();
    if (!clean) throw new BadRequestException('Choose an Outlook calendar.');
    const resources = await this.listResources(tenantId);
    const selected = resources.find((item) => item.id === clean);
    if (!selected || selected.accessRole !== 'writer') {
      throw new BadRequestException(
        'Choose an Outlook calendar that allows event changes.',
      );
    }
    const connection = await this.requireAuthorized(tenantId);
    if (
      connection.selectedCalendarId &&
      connection.selectedCalendarId !== selected.id
    ) {
      await this.stopSubscription(connection);
    }
    Object.assign(connection, {
      selectedCalendarId: selected.id,
      selectedCalendarName: selected.name,
      selectedCalendarTimeZone: selected.timeZone || 'UTC',
      selectedResourceType: 'calendar',
      selectedResourceUri: selected.id,
      selectedResourceMetadata: {
        ...(connection.selectedResourceMetadata || {}),
        isDefaultCalendar: selected.primary,
        teamsSupported: selected.teamsSupported,
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
      path: '/calendar/microsoft/selection',
      statusCode: 200,
      metadata: { provider: 'microsoft', calendarName: selected.name },
    });
    return this.status(tenantId);
  }

  async testConnection(tenantId: string, actorId: string) {
    const connection = await this.requireSelected(tenantId);
    try {
      const accessToken = await this.accessToken(connection);
      const calendar = await this.graph.getCalendar(
        accessToken,
        connection.selectedCalendarId!,
      );
      if (!calendar?.id || calendar.canEdit !== true) {
        throw new BookingProviderApiError(
          this.name,
          'MICROSOFT_CALENDAR_NOT_WRITABLE',
          'The selected Outlook calendar is not writable.',
          null,
          false,
        );
      }
      const address = this.accountAddress(connection, calendar.owner?.address);
      if (!address) {
        throw new BookingProviderApiError(
          this.name,
          'MICROSOFT_ACCOUNT_ADDRESS_MISSING',
          'Microsoft did not return a mailbox address for free/busy.',
          null,
          false,
        );
      }
      const now = new Date();
      await this.graph.getSchedule(accessToken, {
        address,
        start: now,
        end: new Date(now.getTime() + 60_000),
        timeZone: 'UTC',
      });
      Object.assign(connection, {
        status: 'connected' as CalendarConnectionStatus,
        selectedCalendarName:
          calendar.name || connection.selectedCalendarName,
        selectedResourceMetadata: {
          ...(connection.selectedResourceMetadata || {}),
          accountAddress: address,
          isDefaultCalendar: calendar.isDefaultCalendar === true,
          teamsSupported: (
            calendar.allowedOnlineMeetingProviders || []
          ).includes('teamsForBusiness'),
        },
        lastTestedAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
        lastErrorCode: null,
        lastErrorAt: null,
      });
      await this.connections.save(connection);
      await this.configureSubscription(connection);
      await this.audit?.record({
        tenantId,
        actorId,
        action: 'calendar.connection_test_passed',
        resourceType: 'calendar_connection',
        resourceId: connection.id,
        method: 'POST',
        path: '/calendar/microsoft/test',
        statusCode: 200,
        metadata: { provider: 'microsoft' },
      });
      return this.status(tenantId);
    } catch (error) {
      await this.handleError(connection, error);
      throw this.publicException(error);
    }
  }

  async disconnect(tenantId: string, actorId: string) {
    const connection = await this.connections.findOne({
      where: { tenantId, provider: 'microsoft' },
    });
    if (!connection) return this.disconnectedStatus();
    await this.stopSubscription(connection);
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
      path: '/calendar/microsoft',
      statusCode: 200,
      metadata: { provider: 'microsoft' },
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
      resourceName: connection.selectedCalendarName || 'Outlook calendar',
      timeZone: connection.selectedCalendarTimeZone || 'UTC',
    };
  }

  async checkAvailability(
    tenantId: string,
    start: Date,
    end: Date,
    excludeEventId?: string | null,
    resourceId?: string | null,
  ) {
    this.validateWindow(start, end);
    const connection = await this.requireReady(tenantId);
    const calendarId = resourceId || connection.selectedCalendarId!;
    try {
      const accessToken = await this.accessToken(connection);
      const address = this.accountAddress(connection);
      if (!address) {
        throw new BookingProviderApiError(
          this.name,
          'MICROSOFT_FREE_BUSY_UNCERTAIN',
          'Microsoft mailbox identity is unavailable.',
          null,
          true,
        );
      }
      const [events, schedule, existingEvent] = await Promise.all([
        this.graph.listCalendarView(accessToken, { calendarId, start, end }),
        this.graph.getSchedule(accessToken, {
          address,
          start,
          end,
          timeZone: 'UTC',
        }),
        excludeEventId
          ? this.graph.getEvent(accessToken, calendarId, excludeEventId)
          : Promise.resolve(null),
      ]);
      const blocking = events.filter((event) => {
        if (
          event.id === excludeEventId ||
          event.isCancelled ||
          String(event.showAs || '').toLowerCase() === 'free'
        ) {
          return false;
        }
        const times = this.graph.eventTimes(event);
        if (!times.startsAt || !times.endsAt) return true;
        return times.startsAt < end && times.endsAt > start;
      });
      if (blocking.length) {
        await this.noteSuccess(connection);
        return {
          available: false,
          checkedAt: new Date(),
          timeZone: connection.selectedCalendarTimeZone,
        };
      }
      const existingTimes = existingEvent
        ? this.graph.eventTimes(existingEvent)
        : { startsAt: null, endsAt: null };
      let ignoredExistingEvent = false;
      const mailboxBusy = schedule.some((item: any) => {
        if (!item.start || !item.end) {
          throw new BookingProviderApiError(
            this.name,
            'MICROSOFT_FREE_BUSY_UNCERTAIN',
            'Microsoft returned invalid free/busy data.',
            null,
            true,
          );
        }
        if (
          !ignoredExistingEvent &&
          existingTimes.startsAt &&
          existingTimes.endsAt &&
          item.start.getTime() === existingTimes.startsAt.getTime() &&
          item.end.getTime() === existingTimes.endsAt.getTime()
        ) {
          ignoredExistingEvent = true;
          return false;
        }
        return (
          !['free', 'workingelsewhere'].includes(item.status) &&
          item.start < end &&
          item.end > start
        );
      });
      if (mailboxBusy) {
        await this.noteSuccess(connection);
        return {
          available: false,
          checkedAt: new Date(),
          timeZone: connection.selectedCalendarTimeZone,
        };
      }
      await this.noteSuccess(connection);
      return {
        available: true,
        checkedAt: new Date(),
        timeZone: connection.selectedCalendarTimeZone,
      };
    } catch (error) {
      await this.handleError(connection, error);
      throw this.publicException(error);
    }
  }

  async createAppointment(input: CreateProviderAppointmentInput) {
    const connection = await this.requireReady(input.tenantId);
    const calendarId = input.resourceId || connection.selectedCalendarId!;
    const availability = await this.checkAvailability(
      input.tenantId,
      input.start,
      input.end,
      null,
      calendarId,
    );
    if (!availability.available) {
      throw new ConflictException({
        code: 'CALENDAR_TIME_UNAVAILABLE',
        message: 'That time is busy in Outlook. Choose another time.',
      });
    }
    const transactionId = this.graph.transactionId(
      input.tenantId,
      input.idempotencyKey,
    );
    const virtual = input.mode === 'virtual';
    if (
      virtual &&
      connection.selectedResourceMetadata?.teamsSupported !== true
    ) {
      throw new ConflictException({
        code: 'MICROSOFT_TEAMS_NOT_AVAILABLE',
        message:
          'The selected Outlook calendar cannot create Teams meetings. Choose a Teams-capable calendar or use another meeting mode.',
      });
    }
    try {
      const accessToken = await this.accessToken(connection);
      let event = await this.graph.createEvent(accessToken, {
        calendarId,
        subject: input.summary,
        description: input.description,
        start: input.start,
        end: input.end,
        attendeeEmail: validEmail(input.attendeeEmail)
          ? input.attendeeEmail!.trim()
          : null,
        attendeeName: input.attendeeName,
        transactionId,
        virtual,
      });
      event = await this.validateCreatedEvent(
        accessToken,
        calendarId,
        event,
        input.start,
        input.end,
        virtual,
      );
      await this.noteSuccess(connection);
      await this.audit?.recordSystemEvent({
        tenantId: input.tenantId,
        eventType: 'calendar.event_created',
        resourceType: 'lead',
        resourceId: input.leadId,
        metadata: {
          provider: 'microsoft',
          mode: input.mode,
          startsAt: input.start.toISOString(),
          endsAt: input.end.toISOString(),
          idempotencyFingerprint: transactionId.slice(0, 12),
        },
      });
      return this.external(connection, calendarId, event);
    } catch (error) {
      if (
        error instanceof BookingProviderApiError &&
        error.outcomeUncertain
      ) {
        const recovered = await this.recoverByTransaction(
          connection,
          calendarId,
          input.start,
          input.end,
          transactionId,
          virtual,
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
  ) {
    const connection = await this.requireReady(tenantId);
    const calendarId = resourceId || connection.selectedCalendarId!;
    try {
      const accessToken = await this.accessToken(connection);
      const event = await this.graph.getEvent(
        accessToken,
        calendarId,
        eventId,
      );
      await this.noteSuccess(connection);
      return event ? this.external(connection, calendarId, event) : null;
    } catch (error) {
      await this.handleError(connection, error);
      throw this.publicException(error);
    }
  }

  async updateAppointment(input: UpdateProviderAppointmentInput) {
    const connection = await this.requireReady(input.tenantId);
    const calendarId = input.resourceId || connection.selectedCalendarId!;
    const availability = await this.checkAvailability(
      input.tenantId,
      input.start,
      input.end,
      input.eventId,
      calendarId,
    );
    if (!availability.available) {
      throw new ConflictException({
        code: 'CALENDAR_TIME_UNAVAILABLE',
        message: 'That time is busy in Outlook. Choose another time.',
      });
    }
    try {
      const accessToken = await this.accessToken(connection);
      let event = await this.graph.patchEvent(accessToken, {
        calendarId,
        eventId: input.eventId,
        version: input.version,
        start: input.start,
        end: input.end,
      });
      event = await this.validateCreatedEvent(
        accessToken,
        calendarId,
        event,
        input.start,
        input.end,
        input.mode === 'virtual',
        input.eventId,
      );
      await this.noteSuccess(connection);
      return this.external(connection, calendarId, event);
    } catch (error) {
      await this.handleError(connection, error);
      throw this.publicException(error);
    }
  }

  async cancelAppointment(input: CancelProviderAppointmentInput) {
    const connection = await this.requireReady(input.tenantId);
    try {
      const accessToken = await this.accessToken(connection);
      await this.graph.deleteEvent(accessToken, {
        calendarId: input.resourceId || connection.selectedCalendarId!,
        eventId: input.eventId,
        version: input.version,
      });
      await this.noteSuccess(connection);
      return { cancelled: true as const };
    } catch (error) {
      await this.handleError(connection, error);
      throw this.publicException(error);
    }
  }

  async handleNotifications(notifications: MicrosoftChangeNotification[]) {
    let scheduled = 0;
    let duplicates = 0;
    for (const notification of notifications.slice(0, 100)) {
      const subscriptionId = String(notification.subscriptionId || '').trim();
      const clientState = String(notification.clientState || '').trim();
      if (!subscriptionId || !clientState) continue;
      const connection = await this.connections.findOne({
        where: { provider: 'microsoft', webhookChannelId: subscriptionId },
      });
      if (!connection || !connection.webhookTokenHash) {
        throw new NotFoundException(
          'Microsoft calendar notification subscription not found.',
        );
      }
      if (!sameHash(connection.webhookTokenHash, sha256(clientState))) {
        throw new ForbiddenException(
          'Invalid Microsoft calendar notification client state.',
        );
      }
      const payloadHash = sha256(JSON.stringify(notification));
      const eventKey = String(
        notification.id
          ? `${subscriptionId}:${notification.id}`
          :
          `${subscriptionId}:${notification.lifecycleEvent || notification.changeType || 'change'}:${payloadHash}`,
      ).slice(0, 255);
      if (
        !(await this.recordWebhook(
          connection.tenantId,
          eventKey,
          payloadHash,
        ))
      ) {
        duplicates += 1;
        continue;
      }
      if (notification.lifecycleEvent) {
        scheduled += await this.handleLifecycle(connection, notification);
        continue;
      }
      const eventId = this.notificationEventId(notification);
      if (!eventId) {
        scheduled += await this.scheduleAll(connection);
        continue;
      }
      const appointment = await this.appointments.findOne({
        where: {
          tenantId: connection.tenantId,
          externalProvider: 'microsoft',
          externalEventId: eventId,
        },
        select: { id: true, tenantId: true },
      });
      if (appointment && this.durableJobs) {
        await this.durableJobs.schedule({
          taskType: 'appointment.reconcile_calendar',
          tenantId: appointment.tenantId,
          dedupeKey: `appointment-calendar-reconcile:${appointment.id}`,
          payload: { appointmentId: appointment.id },
          maxAttempts: 12,
        });
        scheduled += 1;
      }
    }
    return { accepted: true, scheduled, duplicates };
  }

  private disconnectedStatus(): ProviderStatus {
    return {
      provider: this.name,
      status: 'disconnected',
      connected: false,
      selectedResource: null,
      lastTestedAt: null,
      lastSuccessfulSyncAt: null,
      changeNotifications: {
        status: 'reconciliation_only',
        expiresAt: null,
      },
      capabilities: {
        directBooking: true,
        automatedReschedule: true,
        cancellation: true,
        onlineMeeting: true,
        changeNotifications: true,
      },
      issue: {
        what: 'Microsoft Outlook is not connected.',
        why: 'Real availability, Outlook events, and Teams links cannot be confirmed.',
        how: 'Connect Microsoft, choose a writable calendar, and run Test connection.',
      },
    };
  }

  private publicIssue(code?: string | null) {
    if (code === 'MICROSOFT_AUTH_REQUIRED') {
      return {
        what: 'Microsoft authorization expired or was revoked.',
        why: 'RealtyTechAI cannot safely read or change Outlook events.',
        how: 'Reconnect Microsoft, choose the calendar again, and run Test connection.',
      };
    }
    return {
      what: 'The Microsoft calendar connection needs attention.',
      why: 'A recent provider operation could not be verified.',
      how: 'Run Test connection. Reconnect Microsoft if the test reports an authorization problem.',
    };
  }

  private async validateCreatedEvent(
    accessToken: string,
    calendarId: string,
    event: MicrosoftEvent,
    start: Date,
    end: Date,
    virtual: boolean,
    expectedId?: string,
  ) {
    let candidate = event;
    if (
      candidate?.id &&
      (virtual && !candidate.onlineMeeting?.joinUrl) 
    ) {
      candidate =
        (await this.graph.getEvent(accessToken, calendarId, candidate.id)) ||
        candidate;
    }
    const times = this.graph.eventTimes(candidate);
    if (
      !candidate?.id ||
      (expectedId && candidate.id !== expectedId) ||
      !times.startsAt ||
      !times.endsAt ||
      times.startsAt.getTime() !== start.getTime() ||
      times.endsAt.getTime() !== end.getTime() ||
      (virtual && !candidate.onlineMeeting?.joinUrl)
    ) {
      throw new BookingProviderApiError(
        this.name,
        'MICROSOFT_EVENT_RESULT_UNCERTAIN',
        'Microsoft did not confirm the complete event result.',
        null,
        true,
        true,
      );
    }
    return candidate;
  }

  private async recoverByTransaction(
    connection: CalendarConnection,
    calendarId: string,
    start: Date,
    end: Date,
    transactionId: string,
    virtual: boolean,
  ) {
    const accessToken = await this.accessToken(connection);
    const events = await this.graph.listCalendarView(accessToken, {
      calendarId,
      start: new Date(start.getTime() - 60_000),
      end: new Date(end.getTime() + 60_000),
    });
    const matching = events.filter(
      (event) =>
        event.transactionId === transactionId && !event.isCancelled,
    );
    if (matching.length !== 1) return null;
    const event = await this.validateCreatedEvent(
      accessToken,
      calendarId,
      matching[0],
      start,
      end,
      virtual,
    );
    await this.noteSuccess(connection);
    return this.external(connection, calendarId, event);
  }

  private external(
    connection: CalendarConnection,
    calendarId: string,
    event: MicrosoftEvent,
  ): ProviderAppointment {
    const times = this.graph.eventTimes(event);
    const updated = event.lastModifiedDateTime
      ? new Date(event.lastModifiedDateTime)
      : null;
    return {
      provider: this.name,
      storedProvider: this.storedProvider,
      connectionId: connection.id,
      resourceId: calendarId,
      id: event.id,
      inviteeId: null,
      version: event['@odata.etag'] || event.changeKey || null,
      status: event.isCancelled ? 'cancelled' : 'confirmed',
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      joinUrl: this.safeJoinUrl(
        event.onlineMeeting?.joinUrl || event.onlineMeetingUrl,
      ),
      cancelUrl: null,
      rescheduleUrl: null,
      providerUpdatedAt:
        updated && !Number.isNaN(updated.getTime()) ? updated : null,
    };
  }

  private safeJoinUrl(value?: string | null) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && !url.username && !url.password
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  }

  private async configureSubscription(connection: CalendarConnection) {
    try {
      const expiration = await this.ensureSubscription(connection);
      if (!expiration || !this.durableJobs) return;
      await this.durableJobs.schedule({
        taskType: 'calendar.microsoft.renew_subscription',
        tenantId: connection.tenantId,
        dedupeKey: `calendar-microsoft-renew:${connection.id}`,
        payload: { connectionId: connection.id },
        nextRunAt: new Date(
          Math.max(
            Date.now() + 60_000,
            expiration.getTime() - MICROSOFT_RENEWAL_LEAD_MS,
          ),
        ),
        maxAttempts: 20,
      });
    } catch (error) {
      await this.operations?.createTask({
        tenantId: connection.tenantId,
        category: 'calendar_provider_failure',
        title: 'Microsoft calendar change notifications need attention',
        description:
          'Direct booking remains protected by live availability and scheduled reconciliation, but the Outlook webhook could not be activated. Verify the public HTTPS URL and test the connection again.',
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
        metadata: { provider: 'microsoft', errorCode: this.errorCode(error) },
      });
    }
  }

  private async ensureSubscription(
    connection: CalendarConnection,
    force = false,
  ) {
    const callbackUrl = this.webhookUrl();
    if (!callbackUrl || !connection.providerAccountId) return null;
    const accessToken = await this.accessToken(connection);
    const expiration = new Date(Date.now() + MICROSOFT_SUBSCRIPTION_TTL_MS);
    if (
      !force &&
      connection.webhookChannelId &&
      connection.webhookExpiresAt &&
      connection.webhookExpiresAt.getTime() >
        Date.now() + MICROSOFT_RENEWAL_LEAD_MS
    ) {
      return connection.webhookExpiresAt;
    }
    if (connection.webhookChannelId && connection.webhookTokenHash) {
      try {
        const renewed = await this.graph.renewSubscription(
          accessToken,
          connection.webhookChannelId,
          expiration,
        );
        const renewedExpiration = new Date(renewed.expirationDateTime);
        if (!Number.isNaN(renewedExpiration.getTime())) {
          connection.webhookExpiresAt = renewedExpiration;
          await this.connections.save(connection);
          return renewedExpiration;
        }
      } catch (error) {
        if (this.errorCode(error) === 'MICROSOFT_AUTH_REQUIRED') throw error;
      }
    }
    const clientState = randomBytes(32).toString('base64url');
    const created = await this.graph.createSubscription(accessToken, {
      accountId: connection.providerAccountId,
      notificationUrl: callbackUrl,
      lifecycleNotificationUrl: callbackUrl,
      clientState,
      expiration,
    });
    const confirmedExpiration = new Date(created.expirationDateTime);
    if (
      !created.id ||
      Number.isNaN(confirmedExpiration.getTime()) ||
      confirmedExpiration <= new Date()
    ) {
      throw new BookingProviderApiError(
        this.name,
        'MICROSOFT_SUBSCRIPTION_RESULT_UNCERTAIN',
        'Microsoft did not confirm the event subscription.',
        null,
        true,
        true,
      );
    }
    const oldId = connection.webhookChannelId;
    Object.assign(connection, {
      webhookChannelId: created.id,
      webhookResourceId: created.resource || null,
      webhookTokenHash: sha256(clientState),
      webhookExpiresAt: confirmedExpiration,
      webhookLastMessageNumber: null,
    });
    await this.connections.save(connection);
    if (oldId && oldId !== created.id) {
      await this.graph
        .deleteSubscription(accessToken, oldId)
        .catch(() => undefined);
    }
    return confirmedExpiration;
  }

  private async stopSubscription(connection: CalendarConnection) {
    if (connection.webhookChannelId && connection.accessTokenEncrypted) {
      try {
        const token = await this.accessToken(connection);
        await this.graph.deleteSubscription(token, connection.webhookChannelId);
      } catch {
        // Microsoft subscriptions expire in under seven days. Local credentials
        // are cleared immediately even when remote deletion cannot be confirmed.
      }
    }
    Object.assign(connection, {
      webhookChannelId: null,
      webhookResourceId: null,
      webhookTokenHash: null,
      webhookExpiresAt: null,
      webhookLastMessageNumber: null,
    });
    await this.connections.save(connection);
  }

  private async handleLifecycle(
    connection: CalendarConnection,
    notification: MicrosoftChangeNotification,
  ) {
    if (notification.lifecycleEvent === 'subscriptionRemoved') {
      Object.assign(connection, {
        webhookChannelId: null,
        webhookResourceId: null,
        webhookTokenHash: null,
        webhookExpiresAt: null,
      });
      await this.connections.save(connection);
      await this.durableJobs?.schedule({
        taskType: 'calendar.microsoft.renew_subscription',
        tenantId: connection.tenantId,
        dedupeKey: `calendar-microsoft-renew:${connection.id}`,
        payload: { connectionId: connection.id },
        maxAttempts: 20,
      });
    } else if (notification.lifecycleEvent === 'reauthorizationRequired') {
      await this.durableJobs?.schedule({
        taskType: 'calendar.microsoft.renew_subscription',
        tenantId: connection.tenantId,
        dedupeKey: `calendar-microsoft-renew:${connection.id}`,
        payload: { connectionId: connection.id },
        maxAttempts: 20,
      });
    }
    return this.scheduleAll(connection);
  }

  private async scheduleAll(connection: CalendarConnection) {
    const appointments = await this.appointments.find({
      where: {
        tenantId: connection.tenantId,
        externalProvider: 'microsoft',
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
          provider: 'microsoft',
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

  private notificationEventId(notification: MicrosoftChangeNotification) {
    const direct = String(notification.resourceData?.id || '').trim();
    if (direct) return direct;
    const resource = String(
      notification.resourceData?.['@odata.id'] || notification.resource || '',
    );
    const match = resource.match(/events(?:\('|\/)([^')/?]+)(?:'\)|$|[/?])/i);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }

  private async requireAuthorized(tenantId: string) {
    const connection = await this.connections.findOne({
      where: { tenantId, provider: 'microsoft' },
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
          'Connect Microsoft Outlook before scheduling. Use the verified booking link or hand off to a person.',
      });
    }
    return connection;
  }

  private async requireSelected(tenantId: string) {
    const connection = await this.requireAuthorized(tenantId);
    if (!connection.selectedCalendarId) {
      throw new ConflictException({
        code: 'CALENDAR_NOT_SELECTED',
        message: 'Choose which Outlook calendar RealtyTechAI should use.',
      });
    }
    return connection;
  }

  private async requireReady(tenantId: string) {
    const connection = await this.requireSelected(tenantId);
    const retryable =
      connection.status === 'needs_attention' &&
      [
        'MICROSOFT_TEMPORARY_FAILURE',
        'MICROSOFT_TIMEOUT',
        'MICROSOFT_FREE_BUSY_UNCERTAIN',
        'MICROSOFT_EVENT_RESULT_UNCERTAIN',
      ].includes(connection.lastErrorCode || '');
    if ((!retryable && connection.status !== 'connected') || !connection.lastTestedAt) {
      throw new ConflictException({
        code: 'CALENDAR_NEEDS_ATTENTION',
        message:
          'Test the Microsoft calendar connection before scheduling. Use the verified booking link or hand off to a person.',
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
        'MICROSOFT_AUTH_REQUIRED',
        'Microsoft authorization expired.',
        401,
        false,
      );
    }
    const config = this.config();
    const tokens = await this.graph.refreshAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: decryptString(connection.refreshTokenEncrypted),
    });
    if (!tokens.access_token) {
      throw new BookingProviderApiError(
        this.name,
        'MICROSOFT_AUTH_REQUIRED',
        'Microsoft did not return an access token.',
        401,
        false,
      );
    }
    const update = {
      accessTokenEncrypted: encryptString(tokens.access_token),
      accessTokenExpiresAt: new Date(
        Date.now() + Math.max(tokens.expires_in || 3_600, 60) * 1_000,
      ),
      refreshTokenEncrypted: tokens.refresh_token
        ? encryptString(tokens.refresh_token)
        : connection.refreshTokenEncrypted,
    };
    const result = await this.connections.update(
      { id: connection.id, status: Not('disconnected') },
      update,
    );
    if (!result.affected) {
      throw new BookingProviderApiError(
        this.name,
        'MICROSOFT_AUTH_REQUIRED',
        'Microsoft calendar was disconnected.',
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
    if (code === 'MICROSOFT_EVENT_CHANGED') return;
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
      : String((error as any)?.response?.code || (error as any)?.code || 'MICROSOFT_CALENDAR_FAILED');
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
      end.getTime() - start.getTime() > 8 * 60 * 60_000
    ) {
      throw new BadRequestException(
        'Appointment end time must be after start and within eight hours.',
      );
    }
  }

  private accountAddress(
    connection: CalendarConnection,
    fallback?: string | null,
  ) {
    const metadata = connection.selectedResourceMetadata || {};
    const value = String(metadata.accountAddress || fallback || '').trim();
    return validEmail(value) ? value : '';
  }

  private config() {
    const clientId = String(process.env.MICROSOFT_CALENDAR_CLIENT_ID || '').trim();
    const clientSecret = String(
      process.env.MICROSOFT_CALENDAR_CLIENT_SECRET || '',
    ).trim();
    const publicApiUrl = String(process.env.PUBLIC_API_URL || '').replace(
      /\/+$/,
      '',
    );
    if (!clientId || !clientSecret || !publicApiUrl) {
      throw new ServiceUnavailableException({
        code: 'MICROSOFT_CALENDAR_NOT_CONFIGURED',
        message:
          'Microsoft calendar setup is not available yet. RealtyTechAI operations must configure the Entra OAuth application.',
      });
    }
    return {
      clientId,
      clientSecret,
      redirectUri: `${publicApiUrl}/calendar/microsoft/oauth/callback`,
    };
  }

  private webhookUrl() {
    const explicit = String(
      process.env.MICROSOFT_CALENDAR_WEBHOOK_URL || '',
    ).trim();
    const api = String(process.env.PUBLIC_API_URL || '').replace(/\/+$/, '');
    const value = explicit || (api ? `${api}/calendar/microsoft/notifications` : '');
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
      throw new Error(
        'MICROSOFT_CALENDAR_WEBHOOK_URL must be a public HTTPS URL',
      );
    }
    return url.toString();
  }

  private tenantIdFromIdToken(idToken?: string) {
    try {
      const payload = JSON.parse(
        Buffer.from(String(idToken || '').split('.')[1], 'base64url').toString(
          'utf8',
        ),
      );
      return typeof payload?.tid === 'string'
        ? payload.tid.slice(0, 255)
        : null;
    } catch {
      return null;
    }
  }
}
