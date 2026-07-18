export function normalizePhoneDigits(value?: string | null): string | null {
  if (!value) return null;
  let digits = String(value).replace(/\D/g, '');
  if (digits.length === 10) digits = `1${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function normalizePhoneE164(value?: string | null): string | null {
  const digits = normalizePhoneDigits(value);
  return digits ? `+${digits}` : null;
}
