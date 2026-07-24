export function isSafeBookingUrl(value?: string | null): boolean {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}
