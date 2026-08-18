import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { BookingProviderApiError } from './booking-provider.error';
import {
  providerRequest,
  requireProviderNextLink,
} from './provider-http';

export const MICROSOFT_CALENDAR_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite',
] as const;

export type MicrosoftTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

export type MicrosoftProfile = {
  id: string;
  displayName?: string;
  userPrincipalName?: string;
  mail?: string;
};

export type MicrosoftCalendar = {
  id: string;
  name?: string;
  canEdit?: boolean;
  isDefaultCalendar?: boolean;
  owner?: { name?: string; address?: string };
  allowedOnlineMeetingProviders?: string[];
  defaultOnlineMeetingProvider?: string;
};

export type MicrosoftEvent = {
  id: string;
  '@odata.etag'?: string;
  changeKey?: string;
  isCancelled?: boolean;
  showAs?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  lastModifiedDateTime?: string;
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string | null;
  isOnlineMeeting?: boolean;
  transactionId?: string;
};

export type MicrosoftSubscription = {
  id: string;
  resource?: string;
  expirationDateTime: string;
  clientState?: string;
};

function graphDate(value?: string) {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const result = new Date(normalized);
  return Number.isNaN(result.getTime()) ? null : result;
}

function graphHeaders(accessToken: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    Prefer: 'outlook.timezone="UTC"',
    ...extra,
  };
}

@Injectable()
export class MicrosoftCalendarClient {
  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }) {
    const url = new URL(
      'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    );
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', MICROSOFT_CALENDAR_SCOPES.join(' '));
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
  }) {
    return this.tokenRequest({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: 'authorization_code',
      scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
    });
  }

  refreshAccessToken(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }) {
    return this.tokenRequest({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: 'refresh_token',
      scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
    });
  }

  getProfile(accessToken: string) {
    return this.graph<MicrosoftProfile>(
      accessToken,
      '/me?$select=id,displayName,userPrincipalName,mail',
    );
  }

  async getMailboxTimeZone(accessToken: string) {
    const result = await this.graph<{ timeZone?: string }>(
      accessToken,
      '/me/mailboxSettings/timeZone',
    );
    return String(result?.timeZone || 'UTC');
  }

  async listCalendars(accessToken: string) {
    const calendars: MicrosoftCalendar[] = [];
    let url: string | null =
      'https://graph.microsoft.com/v1.0/me/calendars?$top=100&$select=id,name,canEdit,isDefaultCalendar,owner,allowedOnlineMeetingProviders,defaultOnlineMeetingProvider';
    while (url && calendars.length < 1_000) {
      const page = await providerRequest<{
        value?: MicrosoftCalendar[];
        '@odata.nextLink'?: string;
      }>('microsoft_calendar', url, {
        headers: graphHeaders(accessToken),
      });
      calendars.push(...(Array.isArray(page?.value) ? page.value : []));
      url = requireProviderNextLink(
        page?.['@odata.nextLink'],
        'graph.microsoft.com',
      );
    }
    if (url) {
      throw new BookingProviderApiError(
        'microsoft_calendar',
        'MICROSOFT_RESULT_TRUNCATED',
        'Microsoft returned too many calendars to select safely.',
        null,
        false,
      );
    }
    return calendars.filter((calendar) => calendar.id && calendar.canEdit === true);
  }

  getCalendar(accessToken: string, calendarId: string) {
    return this.graph<MicrosoftCalendar>(
      accessToken,
      `/me/calendars/${encodeURIComponent(calendarId)}?$select=id,name,canEdit,isDefaultCalendar,owner,allowedOnlineMeetingProviders,defaultOnlineMeetingProvider`,
    );
  }

  async getSchedule(
    accessToken: string,
    input: { address: string; start: Date; end: Date; timeZone?: string },
  ) {
    const result = await this.graph<any>(
      accessToken,
      '/me/calendar/getSchedule',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedules: [input.address],
          startTime: {
            dateTime: input.start.toISOString(),
            timeZone: input.timeZone || 'UTC',
          },
          endTime: {
            dateTime: input.end.toISOString(),
            timeZone: input.timeZone || 'UTC',
          },
          availabilityViewInterval: 5,
        }),
      },
    );
    const schedule = Array.isArray(result?.value) ? result.value[0] : null;
    if (!schedule || schedule.error || !Array.isArray(schedule.scheduleItems)) {
      throw new BookingProviderApiError(
        'microsoft_calendar',
        'MICROSOFT_FREE_BUSY_UNCERTAIN',
        'Microsoft could not confirm mailbox availability.',
        null,
        true,
      );
    }
    return schedule.scheduleItems.map((item: any) => ({
      status: String(item?.status || 'unknown').toLowerCase(),
      start: graphDate(item?.start?.dateTime),
      end: graphDate(item?.end?.dateTime),
    }));
  }

  async listCalendarView(
    accessToken: string,
    input: { calendarId: string; start: Date; end: Date },
  ) {
    const events: MicrosoftEvent[] = [];
    const first = new URL(
      `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(input.calendarId)}/calendarView`,
    );
    first.searchParams.set('startDateTime', input.start.toISOString());
    first.searchParams.set('endDateTime', input.end.toISOString());
    first.searchParams.set('$top', '100');
    first.searchParams.set(
      '$select',
      'id,changeKey,isCancelled,showAs,start,end,lastModifiedDateTime,onlineMeeting,onlineMeetingUrl,isOnlineMeeting,transactionId',
    );
    let url: string | null = first.toString();
    while (url && events.length < 1_000) {
      const page = await providerRequest<{
        value?: MicrosoftEvent[];
        '@odata.nextLink'?: string;
      }>('microsoft_calendar', url, {
        headers: graphHeaders(accessToken),
      });
      events.push(...(Array.isArray(page?.value) ? page.value : []));
      url = requireProviderNextLink(
        page?.['@odata.nextLink'],
        'graph.microsoft.com',
      );
    }
    if (url) {
      throw new BookingProviderApiError(
        'microsoft_calendar',
        'MICROSOFT_RESULT_TRUNCATED',
        'Microsoft returned too many events to verify availability safely.',
        null,
        false,
      );
    }
    return events;
  }

  createEvent(
    accessToken: string,
    input: {
      calendarId: string;
      subject: string;
      description: string;
      start: Date;
      end: Date;
      attendeeEmail?: string | null;
      attendeeName?: string | null;
      transactionId: string;
      virtual: boolean;
    },
  ) {
    return this.graph<MicrosoftEvent>(
      accessToken,
      `/me/calendars/${encodeURIComponent(input.calendarId)}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: input.subject,
          body: { contentType: 'text', content: input.description },
          start: { dateTime: input.start.toISOString(), timeZone: 'UTC' },
          end: { dateTime: input.end.toISOString(), timeZone: 'UTC' },
          attendees: input.attendeeEmail
            ? [
                {
                  type: 'required',
                  emailAddress: {
                    address: input.attendeeEmail,
                    name: input.attendeeName || input.attendeeEmail,
                  },
                },
              ]
            : undefined,
          transactionId: input.transactionId,
          isOnlineMeeting: input.virtual || undefined,
          onlineMeetingProvider: input.virtual ? 'teamsForBusiness' : undefined,
        }),
      },
      { attempts: 1, mutation: true },
    );
  }

  getEvent(accessToken: string, calendarId: string, eventId: string) {
    return this.graph<MicrosoftEvent | null>(
      accessToken,
      `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?$select=id,changeKey,isCancelled,showAs,start,end,lastModifiedDateTime,onlineMeeting,onlineMeetingUrl,isOnlineMeeting,transactionId`,
      {},
      { allowNotFound: true },
    );
  }

  patchEvent(
    accessToken: string,
    input: {
      calendarId: string;
      eventId: string;
      version?: string | null;
      start: Date;
      end: Date;
    },
  ) {
    return this.graph<MicrosoftEvent>(
      accessToken,
      `/me/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(input.version ? { 'If-Match': input.version } : {}),
        },
        body: JSON.stringify({
          start: { dateTime: input.start.toISOString(), timeZone: 'UTC' },
          end: { dateTime: input.end.toISOString(), timeZone: 'UTC' },
        }),
      },
      { attempts: 1, mutation: true },
    );
  }

  deleteEvent(
    accessToken: string,
    input: { calendarId: string; eventId: string; version?: string | null },
  ) {
    return this.graph<void>(
      accessToken,
      `/me/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      {
        method: 'DELETE',
        headers: input.version ? { 'If-Match': input.version } : undefined,
      },
      { attempts: 1, mutation: true, expectEmpty: true },
    );
  }

  createSubscription(
    accessToken: string,
    input: {
      accountId: string;
      notificationUrl: string;
      lifecycleNotificationUrl: string;
      clientState: string;
      expiration: Date;
    },
  ) {
    return this.graph<MicrosoftSubscription>(
      accessToken,
      '/subscriptions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changeType: 'created,updated,deleted',
          notificationUrl: input.notificationUrl,
          lifecycleNotificationUrl: input.lifecycleNotificationUrl,
          resource: `users/${input.accountId}/events`,
          expirationDateTime: input.expiration.toISOString(),
          clientState: input.clientState,
          latestSupportedTlsVersion: 'v1_2',
        }),
      },
      { attempts: 1, mutation: true },
    );
  }

  renewSubscription(
    accessToken: string,
    subscriptionId: string,
    expiration: Date,
  ) {
    return this.graph<MicrosoftSubscription>(
      accessToken,
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expirationDateTime: expiration.toISOString() }),
      },
      { attempts: 1, mutation: true },
    );
  }

  deleteSubscription(accessToken: string, subscriptionId: string) {
    return this.graph<void>(
      accessToken,
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: 'DELETE' },
      { attempts: 1, mutation: true, expectEmpty: true },
    );
  }

  transactionId(tenantId: string, idempotencyKey: string) {
    return createHash('sha256')
      .update(`${tenantId}:${idempotencyKey}`)
      .digest('hex')
      .slice(0, 64);
  }

  eventTimes(event: MicrosoftEvent) {
    return {
      startsAt: graphDate(event.start?.dateTime),
      endsAt: graphDate(event.end?.dateTime),
    };
  }

  private tokenRequest(fields: Record<string, string>) {
    return providerRequest<MicrosoftTokenResponse>(
      'microsoft_calendar',
      'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      },
      { attempts: 1, mutation: true },
    );
  }

  private graph<T>(
    accessToken: string,
    path: string,
    init: RequestInit = {},
    options: Parameters<typeof providerRequest<T>>[3] = {},
  ) {
    const url = path.startsWith('https://')
      ? path
      : `https://graph.microsoft.com/v1.0${path}`;
    return providerRequest<T>(
      'microsoft_calendar',
      url,
      {
        ...init,
        headers: graphHeaders(
          accessToken,
          Object.fromEntries(new Headers(init.headers).entries()),
        ),
      },
      options,
    );
  }
}
