import * as crypto from 'crypto';

function getKeyBytes(): Buffer {
  const raw = (process.env.INTEGRATIONS_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('INTEGRATIONS_ENCRYPTION_KEY missing');

  try {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
  } catch {}

  try {
    const hex = Buffer.from(raw, 'hex');
    if (hex.length === 32) return hex;
  } catch {}

  throw new Error('INTEGRATIONS_ENCRYPTION_KEY invalid. Must decode to 32 bytes (base64 or hex).');
}

export function encryptString(plain: string): string {
  const key = getKeyBytes();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

export function decryptString(enc: string): string {
  if (!enc) return '';
  if (!enc.startsWith('v1:')) {
    throw new Error('Credential is not encrypted (missing v1: prefix). Reconnect integration to re-save securely.');
  }

  const key = getKeyBytes();
  const packed = Buffer.from(enc.slice(3), 'base64');
  if (packed.length < 12 + 16 + 1) throw new Error('Invalid encrypted payload');

  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
