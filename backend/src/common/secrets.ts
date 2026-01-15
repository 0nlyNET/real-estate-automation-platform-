import * as crypto from 'crypto';

// AES-256-GCM with random IV. Output format: base64(iv).base64(tag).base64(ciphertext)

function getKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('SECRET_ENCRYPTION_KEY missing');
  }

  // Accept 32-byte base64 or 64-char hex
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('SECRET_ENCRYPTION_KEY must be 32 bytes (base64) or 64 hex chars');
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split('.');
  if (parts.length !== 3) throw new Error('Invalid secret format');
  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const data = Buffer.from(parts[2], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

export function canEncrypt(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
