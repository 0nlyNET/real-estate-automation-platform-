const REDACTED = '[REDACTED]';
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 25;
const MAX_STRING_LENGTH = 500;

const SENSITIVE_KEY_PARTS = new Set([
  'authorization',
  'body',
  'cookie',
  'credential',
  'passcode',
  'password',
  'payload',
  'secret',
  'token',
]);

function isSensitiveKey(key: string) {
  const parts = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return (
    parts.some((part) => SENSITIVE_KEY_PARTS.has(part)) ||
    parts.some((part, index) => part === 'api' && parts[index + 1] === 'key')
  );
}

function sanitize(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > MAX_DEPTH) return '[TRUNCATED]';
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitize(item, depth + 1));
  }
  if (typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      clean[key] = isSensitiveKey(key)
        ? REDACTED
        : sanitize(child, depth + 1);
    }
    return clean;
  }
  return String(value);
}

export function sanitizeAuditMetadata(
  metadata?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!metadata) return null;
  return sanitize(metadata, 0) as Record<string, unknown>;
}
