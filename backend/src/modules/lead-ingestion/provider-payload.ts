import { BadRequestException } from "@nestjs/common";
import { normalizePhoneE164 } from "../../common/phone";

const MAX_TEXT_PAYLOAD_BYTES = 256_000;

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseProviderPayload(value: unknown): Record<string, unknown> {
  const direct = asRecord(value);
  if (direct) return unwrapEncodedPayload(direct);
  if (typeof value !== "string") {
    throw new BadRequestException(
      "Lead payload must be a JSON object or encoded text form",
    );
  }

  const text = value.trim();
  if (!text || Buffer.byteLength(text, "utf8") > MAX_TEXT_PAYLOAD_BYTES) {
    throw new BadRequestException("Lead payload is empty or exceeds 256 KB");
  }
  if (text.startsWith("{")) {
    try {
      const parsed = asRecord(JSON.parse(text));
      if (!parsed) throw new Error("not an object");
      return unwrapEncodedPayload(parsed);
    } catch {
      throw new BadRequestException("Lead text payload is not valid JSON");
    }
  }

  if (!text.includes("=")) {
    throw new BadRequestException(
      "Lead text payload is not a supported form payload",
    );
  }
  const params = new URLSearchParams(text);
  const result: Record<string, unknown> = {};
  params.forEach((item, key) => {
    result[key] = item;
  });
  if (Object.keys(result).length === 0) {
    throw new BadRequestException(
      "Lead text payload is not a supported form payload",
    );
  }
  return unwrapEncodedPayload(result);
}

function unwrapEncodedPayload(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const encoded = input.payload ?? input.data;
  if (typeof encoded !== "string" || !encoded.trim().startsWith("{"))
    return input;
  try {
    const parsed = asRecord(JSON.parse(encoded));
    return parsed ? { ...input, ...parsed } : input;
  } catch {
    throw new BadRequestException(
      "Embedded provider payload is not valid JSON",
    );
  }
}

export function nestedRecord(
  source: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> {
  for (const key of keys) {
    const value = asRecord(source[key]);
    if (value) return value;
  }
  return {};
}

export function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

export function normalizeEmailAddress(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized.length > 320) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

export function normalizePhoneNumber(value: unknown): string | null {
  return normalizePhoneE164(firstText(value));
}

export function parseProviderDate(value: unknown): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const text = firstText(value);
  if (text) {
    const parsed = new Date(text);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function sanitizedPayloadMetadata(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const keys = Object.keys(payload).sort().slice(0, 100);
  return {
    keys,
    fieldCount: Object.keys(payload).length,
    hasEmail: keys.some((key) => /email/i.test(key)),
    hasPhone: keys.some((key) => /phone|mobile/i.test(key)),
    hasMessage: keys.some((key) => /message|comment|inquiry/i.test(key)),
  };
}
