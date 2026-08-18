import { Injectable } from '@nestjs/common';

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
] as const;

export type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
};

export type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
  deleted?: boolean;
};

export type GoogleCalendarEvent = {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  transparency?: string;
  htmlLink?: string;
  extendedProperties?: { private?: Record<string, string> };
};

export class GoogleCalendarApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number | null,
    public readonly transient: boolean,
    public readonly outcomeUncertain = false,
  ) {
    super(message);
  }
}

function retryAfterMs(response: Response) {
  const raw = response.headers.get('retry-after');
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1_000, 0), 2_000);
  const date = new Date(raw).getTime();
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), 2_000) : 0;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class GoogleCalendarClient {
  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent select_account');
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
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
    });
  }

  async revokeToken(token: string) {
    const body = new URLSearchParams({ token });
    await this.request('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }, { authRequest: true, expectEmpty: true, attempts: 1 });
  }

  async listCalendars(accessToken: string) {
    const items: GoogleCalendarListEntry[] = [];
    let pageToken = '';
    do {
      const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
      url.searchParams.set('maxResults', '250');
      url.searchParams.set('minAccessRole', 'writer');
      url.searchParams.set('showDeleted', 'false');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const payload = await this.authorizedJson<any>(accessToken, url.toString());
      items.push(...(Array.isArray(payload?.items) ? payload.items : []));
      pageToken = String(payload?.nextPageToken || '');
    } while (pageToken && items.length < 1_000);
    return items.filter((item) => item.id && !item.deleted);
  }

  getCalendar(accessToken: string, calendarId: string) {
    return this.authorizedJson<GoogleCalendarListEntry>(
      accessToken,
      `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}`,
    );
  }

  async freeBusy(
    accessToken: string,
    input: { calendarId: string; start: Date; end: Date; timeZone: string },
  ) {
    const payload = await this.authorizedJson<any>(
      accessToken,
      'https://www.googleapis.com/calendar/v3/freeBusy',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeMin: input.start.toISOString(),
          timeMax: input.end.toISOString(),
          timeZone: input.timeZone,
          items: [{ id: input.calendarId }],
        }),
      },
    );
    const calendar = payload?.calendars?.[input.calendarId];
    if (
      !calendar ||
      (Array.isArray(calendar.errors) && calendar.errors.length) ||
      !Array.isArray(calendar.busy)
    ) {
      throw new GoogleCalendarApiError(
        'GOOGLE_FREE_BUSY_UNCERTAIN',
        'Google Calendar could not confirm availability.',
        null,
        true,
      );
    }
    const busy = calendar.busy.map((row: any) => ({
      start: new Date(String(row.start)),
      end: new Date(String(row.end)),
    }));
    if (
      busy.some(
        (range) =>
          Number.isNaN(range.start.getTime()) ||
          Number.isNaN(range.end.getTime()) ||
          range.end <= range.start,
      )
    ) {
      throw new GoogleCalendarApiError(
        'GOOGLE_FREE_BUSY_UNCERTAIN',
        'Google Calendar returned invalid availability data.',
        null,
        true,
      );
    }
    return busy;
  }

  async listEvents(
    accessToken: string,
    input: {
      calendarId: string;
      start?: Date;
      end?: Date;
      privateExtendedProperty?: string;
      showDeleted?: boolean;
    },
  ) {
    const items: GoogleCalendarEvent[] = [];
    let pageToken = '';
    do {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
      );
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('maxResults', '250');
      url.searchParams.set('showDeleted', input.showDeleted ? 'true' : 'false');
      if (input.start) url.searchParams.set('timeMin', input.start.toISOString());
      if (input.end) url.searchParams.set('timeMax', input.end.toISOString());
      if (input.privateExtendedProperty) {
        url.searchParams.set('privateExtendedProperty', input.privateExtendedProperty);
      }
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const payload = await this.authorizedJson<any>(accessToken, url.toString());
      items.push(...((Array.isArray(payload?.items) ? payload.items : []) as GoogleCalendarEvent[]));
      pageToken = String(payload?.nextPageToken || '');
    } while (pageToken && items.length < 1_000);
    if (pageToken) {
      throw new GoogleCalendarApiError(
        'GOOGLE_CALENDAR_RESULT_TRUNCATED',
        'Google Calendar returned too many events to verify the result safely.',
        null,
        false,
      );
    }
    return items;
  }

  getEvent(accessToken: string, calendarId: string, eventId: string) {
    return this.request<GoogleCalendarEvent | null>(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { allowNotFound: true },
    );
  }

  insertEvent(
    accessToken: string,
    input: {
      calendarId: string;
      summary: string;
      description: string;
      start: Date;
      end: Date;
      timeZone: string;
      attendeeEmail?: string | null;
      idempotencyHash: string;
      eventId: string;
    },
  ) {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
    );
    url.searchParams.set('sendUpdates', input.attendeeEmail ? 'all' : 'none');
    return this.authorizedJson<GoogleCalendarEvent>(accessToken, url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: input.eventId,
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
        end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
        attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
        extendedProperties: {
          private: {
            realtytechai: 'appointment',
            rtaIdempotency: input.idempotencyHash,
          },
        },
      }),
    }, { attempts: 1 });
  }

  patchEvent(
    accessToken: string,
    input: {
      calendarId: string;
      eventId: string;
      etag?: string | null;
      summary: string;
      start: Date;
      end: Date;
      timeZone: string;
      attendeeEmail?: string | null;
    },
  ) {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
    );
    url.searchParams.set('sendUpdates', input.attendeeEmail ? 'all' : 'none');
    return this.authorizedJson<GoogleCalendarEvent>(accessToken, url.toString(), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(input.etag ? { 'If-Match': input.etag } : {}),
      },
      body: JSON.stringify({
        summary: input.summary,
        start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
        end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
        attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
      }),
    });
  }

  async deleteEvent(
    accessToken: string,
    input: { calendarId: string; eventId: string; etag?: string | null },
  ) {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
    );
    url.searchParams.set('sendUpdates', 'all');
    await this.request(
      url.toString(),
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(input.etag ? { 'If-Match': input.etag } : {}),
        },
      },
      { expectEmpty: true, allowNotFound: true },
    );
  }

  private tokenRequest(body: Record<string, string>) {
    return this.request<GoogleTokenResponse>(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
      },
      { authRequest: true },
    );
  }

  private authorizedJson<T>(
    accessToken: string,
    url: string,
    init: RequestInit = {},
    options: { attempts?: number } = {},
  ) {
    return this.request<T>(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${accessToken}`,
      },
    }, options);
  }

  private async request<T = unknown>(
    url: string,
    init: RequestInit,
    options: {
      authRequest?: boolean;
      expectEmpty?: boolean;
      allowNotFound?: boolean;
      attempts?: number;
    } = {},
  ): Promise<T> {
    const attempts = Math.min(Math.max(options.attempts ?? 3, 1), 3);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.timeout(8_000),
        });
        if (options.allowNotFound && (response.status === 404 || response.status === 410)) {
          return null as T;
        }
        if (response.ok) {
          if (options.expectEmpty || response.status === 204) return undefined as T;
          return (await response.json()) as T;
        }
        const responseText = await response.text().catch(() => '');
        let googleReason = '';
        try {
          const payload = JSON.parse(responseText);
          googleReason = String(
            payload?.error?.errors?.[0]?.reason || payload?.error?.status || '',
          );
        } catch {
          // Provider response bodies are never surfaced or logged.
        }
        const rateLimited =
          response.status === 403 &&
          [
            'rateLimitExceeded',
            'userRateLimitExceeded',
            'quotaExceeded',
            'RESOURCE_EXHAUSTED',
          ].includes(googleReason);
        const transient =
          response.status === 408 ||
          response.status === 409 ||
          response.status === 429 ||
          response.status >= 500 ||
          rateLimited;
        if (transient && attempt + 1 < attempts) {
          await wait(retryAfterMs(response) || Math.min(1_000, 150 * 2 ** attempt));
          continue;
        }
        const authRequired =
          response.status === 401 ||
          (response.status === 403 && !rateLimited) ||
          (options.authRequest === true && response.status === 400);
        const precondition = response.status === 412;
        throw new GoogleCalendarApiError(
          authRequired
            ? 'GOOGLE_AUTH_REQUIRED'
            : precondition
              ? 'GOOGLE_CALENDAR_CHANGED'
              : transient
                ? 'GOOGLE_CALENDAR_TEMPORARY_FAILURE'
                : 'GOOGLE_CALENDAR_REQUEST_FAILED',
          authRequired
            ? 'Google authorization is invalid or expired.'
            : precondition
              ? 'The Google Calendar event changed outside RealtyTechAI.'
              : transient
                ? 'Google Calendar is temporarily unavailable.'
                : 'Google Calendar rejected the request.',
          response.status,
          transient,
          transient && ['POST', 'PATCH', 'DELETE'].includes(String(init.method || 'GET')),
        );
      } catch (error: any) {
        if (error instanceof GoogleCalendarApiError) throw error;
        if (attempt + 1 < attempts) {
          await wait(Math.min(1_000, 150 * 2 ** attempt));
          continue;
        }
      }
    }
    throw new GoogleCalendarApiError(
      'GOOGLE_CALENDAR_TIMEOUT',
      'Google Calendar did not respond in time.',
      null,
      true,
      ['POST', 'PATCH', 'DELETE'].includes(String(init.method || 'GET')),
    );
  }
}
