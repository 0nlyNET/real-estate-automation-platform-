import * as crypto from "crypto";

/**
 * Pure integration credential encryption helpers.
 *
 * This module is intentionally dependency-free: it must NOT import Nest
 * services, provider modules, NotificationsService, or IntegrationsService.
 * `mail.service.ts` imports these helpers while `notifications.service.ts`
 * imports `MailService`; if these helpers lived in `integrations.service.ts`
 * (which imports `NotificationsService`), the resulting circular runtime
 * import (NotificationsService -> MailService -> integrations.service ->
 * NotificationsService) left `MailService` undefined during dependency
 * injection and crashed the backend before browser-e2e tests could start.
 */

function isV1Encrypted(v: string) {
  return typeof v === "string" && v.startsWith("v1:");
}

export function getIntegrationEncryptionKey(): Buffer {
  const b64 = process.env.INTEGRATIONS_ENCRYPTION_KEY || "";
  if (!b64.trim()) {
    throw new Error("INTEGRATIONS_ENCRYPTION_KEY is missing in backend/.env");
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(
      "INTEGRATIONS_ENCRYPTION_KEY must decode to 32 bytes (base64 of 32 random bytes)",
    );
  }
  return key;
}

export function encryptIntegrationPayload(obj: any): string {
  const key = getIntegrationEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const plaintext = Buffer.from(JSON.stringify(obj), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptIntegrationPayload(
  value: string | null | undefined,
): any {
  if (!value) return null;

  // Backward compatible: older rows stored plain JSON
  if (!isV1Encrypted(value)) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  try {
    const parts = value.split(":");
    if (parts.length !== 4) return null;

    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ciphertext = Buffer.from(parts[3], "base64");

    const key = getIntegrationEncryptionKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext);
  } catch {
    return null;
  }
}
