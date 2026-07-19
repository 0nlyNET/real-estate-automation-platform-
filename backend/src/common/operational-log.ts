const SENSITIVE_FIELD =
  /(^|_)(authorization|cookie|password|secret|token|api_?key|credential)($|_)/i;

export function sanitizeOperationalText(value: unknown, limit = 1_000) {
  return String(value ?? '')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\bBasic\s+[^\s,;]+/gi, 'Basic [redacted]')
    .replace(/\bsk_(?:live|test)_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bSG\.[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(
      /((?:api[_-]?key|auth[_-]?token|access[_-]?token|password|webhook[_-]?secret)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[redacted]',
    )
    .slice(0, limit);
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (SENSITIVE_FIELD.test(key)) return '[redacted]';
  if (typeof value === 'string') return sanitizeOperationalText(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => sanitizeValue('', item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        sanitizeValue(childKey, child),
      ]),
    );
  }
  return value;
}

export function operationalEvent(
  event: string,
  fields: Record<string, unknown> = {},
) {
  return JSON.stringify({
    event: sanitizeOperationalText(event, 100),
    timestamp: new Date().toISOString(),
    ...Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, sanitizeValue(key, value)]),
    ),
  });
}
