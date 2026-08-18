import { BookingProviderApiError } from './booking-provider.error';
import { BookingProviderName } from './booking-provider.types';

type RequestOptions = {
  allowNotFound?: boolean;
  attempts?: number;
  expectEmpty?: boolean;
  mutation?: boolean;
  timeoutMs?: number;
};

function providerPrefix(provider: BookingProviderName) {
  return provider === 'microsoft_calendar'
    ? 'MICROSOFT'
    : provider === 'calendly'
      ? 'CALENDLY'
      : 'GOOGLE';
}

function retryAfterMs(response: Response) {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.min(Math.max(seconds * 1_000, 0), 2_000);
  }
  const date = new Date(value).getTime();
  return Number.isFinite(date)
    ? Math.min(Math.max(date - Date.now(), 0), 2_000)
    : 0;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function providerRequest<T>(
  provider: BookingProviderName,
  url: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(options.attempts || 2, 3));
  const prefix = providerPrefix(provider);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1_000, Math.min(options.timeoutMs || 10_000, 30_000)),
    );
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (options.allowNotFound && response.status === 404) {
        return null as T;
      }
      if (!response.ok) {
        const transient =
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500;
        if (transient && attempt < attempts && !options.mutation) {
          await wait(retryAfterMs(response) || attempt * 150);
          continue;
        }
        const code =
          response.status === 401 || response.status === 403
            ? `${prefix}_AUTH_REQUIRED`
            : response.status === 412
              ? `${prefix}_EVENT_CHANGED`
              : transient
                ? `${prefix}_TEMPORARY_FAILURE`
                : `${prefix}_REQUEST_REJECTED`;
        throw new BookingProviderApiError(
          provider,
          code,
          `${provider} request failed with status ${response.status}.`,
          response.status,
          transient,
          Boolean(options.mutation && transient),
        );
      }
      if (options.expectEmpty || response.status === 204) return undefined as T;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new BookingProviderApiError(
          provider,
          `${prefix}_RESULT_UNCERTAIN`,
          `${provider} returned an unexpected response format.`,
          response.status,
          true,
          Boolean(options.mutation),
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof BookingProviderApiError) throw error;
      const timedOut = (error as Error)?.name === 'AbortError';
      if (attempt < attempts && !options.mutation) {
        await wait(attempt * 150);
        continue;
      }
      throw new BookingProviderApiError(
        provider,
        timedOut ? `${prefix}_TIMEOUT` : `${prefix}_TEMPORARY_FAILURE`,
        timedOut
          ? `${provider} did not respond in time.`
          : `${provider} could not be reached.`,
        null,
        true,
        Boolean(options.mutation),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new BookingProviderApiError(
    provider,
    `${prefix}_TEMPORARY_FAILURE`,
    `${provider} could not complete the request.`,
    null,
    true,
    Boolean(options.mutation),
  );
}

export function requireProviderNextLink(
  value: unknown,
  expectedHost: string,
): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:' || parsed.hostname !== expectedHost) {
    throw new Error('Provider pagination returned an unsafe URL');
  }
  return parsed.toString();
}
