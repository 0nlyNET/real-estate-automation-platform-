import { Injectable } from '@nestjs/common';
import { BookingProviderApiError } from './booking-provider.error';
import {
  providerRequest,
  requireProviderNextLink,
} from './provider-http';

export const CALENDLY_SCOPES = [
  'users:read',
  'event_types:read',
  'scheduled_events:write',
  'webhooks:write',
] as const;

export type CalendlyTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  owner?: string;
  organization?: string;
};

export type CalendlyUser = {
  uri: string;
  name?: string;
  email?: string;
  timezone?: string;
  current_organization?: string;
  scheduling_url?: string;
};

export type CalendlyEventType = {
  uri: string;
  name?: string;
  active?: boolean;
  duration?: number;
  scheduling_url?: string;
  kind?: string;
  locations?: Array<{ kind?: string; location?: string }>;
};

export type CalendlyAvailableTime = {
  status?: string;
  start_time: string;
  invitees_remaining?: number;
  scheduling_url?: string;
};

export type CalendlyScheduledEvent = {
  uri: string;
  name?: string;
  status?: string;
  start_time?: string;
  end_time?: string;
  event_type?: string;
  updated_at?: string;
  location?: { type?: string; location?: string; join_url?: string };
};

export type CalendlyInvitee = {
  uri: string;
  event: string;
  status?: string;
  name?: string;
  email?: string;
  timezone?: string;
  cancel_url?: string;
  reschedule_url?: string;
  created_at?: string;
  updated_at?: string;
  rescheduled?: boolean;
  old_invitee?: string | null;
  new_invitee?: string | null;
  tracking?: Record<string, string | null>;
};

export type CalendlyWebhookSubscription = {
  uri: string;
  callback_url?: string;
  state?: string;
  events?: string[];
};

function calendlyHeaders(accessToken: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...extra,
  };
}

export function calendlyId(uri?: string | null) {
  const raw = String(uri || '').replace(/\/+$/, '');
  return raw ? raw.slice(raw.lastIndexOf('/') + 1) : '';
}

@Injectable()
export class CalendlyClient {
  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }) {
    const url = new URL('https://auth.calendly.com/oauth/authorize');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', input.state);
    url.searchParams.set('scope', CALENDLY_SCOPES.join(' '));
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
    return this.tokenRequest(
      input.clientId,
      input.clientSecret,
      {
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      },
    );
  }

  refreshAccessToken(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }) {
    return this.tokenRequest(
      input.clientId,
      input.clientSecret,
      {
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
      },
    );
  }

  async getCurrentUser(accessToken: string) {
    const payload = await this.api<{ resource?: CalendlyUser }>(
      accessToken,
      '/users/me',
    );
    return payload.resource;
  }

  async listEventTypes(accessToken: string, userUri: string) {
    const results: CalendlyEventType[] = [];
    const first = new URL('https://api.calendly.com/event_types');
    first.searchParams.set('user', userUri);
    first.searchParams.set('active', 'true');
    first.searchParams.set('count', '100');
    let url: string | null = first.toString();
    while (url && results.length < 1_000) {
      const page = await providerRequest<{
        collection?: CalendlyEventType[];
        pagination?: { next_page?: string | null };
      }>('calendly', url, { headers: calendlyHeaders(accessToken) });
      results.push(...(Array.isArray(page?.collection) ? page.collection : []));
      url = requireProviderNextLink(
        page?.pagination?.next_page,
        'api.calendly.com',
      );
    }
    return results.filter((eventType) => eventType.uri && eventType.active !== false);
  }

  async getEventType(accessToken: string, eventTypeId: string) {
    const payload = await this.api<{ resource?: CalendlyEventType }>(
      accessToken,
      `/event_types/${encodeURIComponent(eventTypeId)}`,
    );
    return payload.resource;
  }

  async listAvailableTimes(
    accessToken: string,
    input: { eventTypeUri: string; start: Date; end: Date },
  ) {
    const slots: CalendlyAvailableTime[] = [];
    const first = new URL(
      'https://api.calendly.com/event_type_available_times',
    );
    first.searchParams.set('event_type', input.eventTypeUri);
    first.searchParams.set('start_time', input.start.toISOString());
    first.searchParams.set('end_time', input.end.toISOString());
    first.searchParams.set('count', '100');
    let url: string | null = first.toString();
    while (url && slots.length < 1_000) {
      const page = await providerRequest<{
        collection?: CalendlyAvailableTime[];
        pagination?: { next_page?: string | null };
      }>('calendly', url, { headers: calendlyHeaders(accessToken) });
      slots.push(...(Array.isArray(page?.collection) ? page.collection : []));
      url = requireProviderNextLink(
        page?.pagination?.next_page,
        'api.calendly.com',
      );
    }
    return slots;
  }

  async createInvitee(
    accessToken: string,
    input: {
      eventTypeUri: string;
      start: Date;
      name: string;
      email: string;
      timeZone: string;
      trackingFingerprint: string;
      location?: { kind: string; location?: string } | null;
    },
  ) {
    const payload = await this.api<{ resource?: CalendlyInvitee }>(
      accessToken,
      '/invitees',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: input.eventTypeUri,
          start_time: input.start.toISOString(),
          invitee: {
            name: input.name,
            email: input.email,
            timezone: input.timeZone,
          },
          location: input.location || undefined,
          tracking: {
            utm_source: 'realtytechai',
            utm_campaign: 'direct_booking',
            utm_content: input.trackingFingerprint,
          },
        }),
      },
      { attempts: 1, mutation: true },
    );
    return payload.resource;
  }

  async getScheduledEvent(accessToken: string, eventId: string) {
    const payload = await this.api<{ resource?: CalendlyScheduledEvent } | null>(
      accessToken,
      `/scheduled_events/${encodeURIComponent(eventId)}`,
      {},
      { allowNotFound: true },
    );
    return payload?.resource || null;
  }

  async getInvitee(
    accessToken: string,
    eventId: string,
    inviteeId: string,
  ) {
    const payload = await this.api<{ resource?: CalendlyInvitee } | null>(
      accessToken,
      `/scheduled_events/${encodeURIComponent(eventId)}/invitees/${encodeURIComponent(inviteeId)}`,
      {},
      { allowNotFound: true },
    );
    return payload?.resource || null;
  }

  async listEventInvitees(accessToken: string, eventId: string) {
    const payload = await this.api<{ collection?: CalendlyInvitee[] }>(
      accessToken,
      `/scheduled_events/${encodeURIComponent(eventId)}/invitees?count=100`,
    );
    return Array.isArray(payload?.collection) ? payload.collection : [];
  }

  async findInviteeByTracking(
    accessToken: string,
    input: {
      userUri: string;
      start: Date;
      end: Date;
      email: string;
      trackingFingerprint: string;
    },
  ) {
    const url = new URL('https://api.calendly.com/scheduled_events');
    url.searchParams.set('user', input.userUri);
    url.searchParams.set(
      'min_start_time',
      new Date(input.start.getTime() - 60_000).toISOString(),
    );
    url.searchParams.set(
      'max_start_time',
      new Date(input.end.getTime() + 60_000).toISOString(),
    );
    url.searchParams.set('status', 'active');
    url.searchParams.set('count', '100');
    let next: string | null = url.toString();
    let inspected = 0;
    while (next && inspected < 1_000) {
      const page = await providerRequest<{
        collection?: CalendlyScheduledEvent[];
        pagination?: { next_page?: string | null };
      }>('calendly', next, {
        headers: calendlyHeaders(accessToken),
      });
      const events = Array.isArray(page.collection) ? page.collection : [];
      inspected += events.length;
      for (const event of events) {
        const eventId = calendlyId(event.uri);
        if (!eventId) continue;
        const invitees = await this.listEventInvitees(accessToken, eventId);
        const match = invitees.find(
          (invitee) =>
            String(invitee.email || '').toLowerCase() ===
              input.email.toLowerCase() &&
            invitee.tracking?.utm_content === input.trackingFingerprint,
        );
        if (match) return { event, invitee: match };
      }
      next = requireProviderNextLink(
        page.pagination?.next_page,
        'api.calendly.com',
      );
    }
    if (next) {
      throw new BookingProviderApiError(
        'calendly',
        'CALENDLY_RESULT_TRUNCATED',
        'Calendly returned too many candidate events to reconcile safely.',
        null,
        false,
      );
    }
    return null;
  }

  cancelEvent(accessToken: string, eventId: string) {
    return this.api<void>(
      accessToken,
      `/scheduled_events/${encodeURIComponent(eventId)}/cancellation`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled through RealtyTechAI' }),
      },
      { attempts: 1, mutation: true, expectEmpty: true },
    );
  }

  async createWebhookSubscription(
    accessToken: string,
    input: {
      callbackUrl: string;
      organizationUri: string;
      userUri: string;
    },
  ) {
    const payload = await this.api<{ resource?: CalendlyWebhookSubscription }>(
      accessToken,
      '/webhook_subscriptions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: input.callbackUrl,
          events: ['invitee.created', 'invitee.canceled'],
          organization: input.organizationUri,
          user: input.userUri,
          scope: 'user',
        }),
      },
      { attempts: 1, mutation: true },
    );
    return payload.resource;
  }

  deleteWebhookSubscription(accessToken: string, subscriptionId: string) {
    return this.api<void>(
      accessToken,
      `/webhook_subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: 'DELETE' },
      { attempts: 1, mutation: true, expectEmpty: true },
    );
  }

  private tokenRequest(
    clientId: string,
    clientSecret: string,
    fields: Record<string, string>,
  ) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    return providerRequest<CalendlyTokenResponse>(
      'calendly',
      'https://auth.calendly.com/oauth/token',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields),
      },
      { attempts: 1, mutation: true },
    );
  }

  private api<T>(
    accessToken: string,
    path: string,
    init: RequestInit = {},
    options: Parameters<typeof providerRequest<T>>[3] = {},
  ) {
    return providerRequest<T>(
      'calendly',
      `https://api.calendly.com${path}`,
      {
        ...init,
        headers: calendlyHeaders(
          accessToken,
          Object.fromEntries(new Headers(init.headers).entries()),
        ),
      },
      options,
    );
  }
}
