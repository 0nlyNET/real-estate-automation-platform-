import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { isSafeBookingUrl } from '../../common/booking-link';
import { decryptIntegrationPayload } from './integrations.service';
import { PlatformCredential } from './platform-credential.entity';

const SALES_BOOKING_PROVIDER = 'sales_calendar';

type SalesBookingPayload = {
  bookingUrl: string;
};

function encryptionKey(): Buffer {
  const raw = String(process.env.INTEGRATIONS_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('INTEGRATIONS_ENCRYPTION_KEY is missing');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('INTEGRATIONS_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return key;
}

function encryptPayload(payload: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

@Injectable()
export class SalesBookingService {
  constructor(
    @InjectRepository(PlatformCredential)
    private readonly platformCredentials: Repository<PlatformCredential>,
  ) {}

  private row() {
    return this.platformCredentials.findOne({
      where: { provider: SALES_BOOKING_PROVIDER },
    });
  }

  async summary() {
    const row = await this.row();
    const payload = row
      ? (decryptIntegrationPayload(row.encryptedValue) as SalesBookingPayload | null)
      : null;
    const bookingUrl = String(payload?.bookingUrl || '').trim();
    return {
      configured: isSafeBookingUrl(bookingUrl),
      bookingUrl: isSafeBookingUrl(bookingUrl) ? bookingUrl : null,
      updatedAt: row?.updatedAt || null,
    };
  }

  async save(bookingUrlInput: string) {
    const bookingUrl = String(bookingUrlInput || '').trim();
    if (!isSafeBookingUrl(bookingUrl)) {
      throw new BadRequestException('A valid HTTPS calendar booking link is required');
    }

    let row = await this.row();
    if (!row) {
      row = this.platformCredentials.create({
        provider: SALES_BOOKING_PROVIDER,
        encryptedValue: encryptPayload({ bookingUrl } satisfies SalesBookingPayload),
      });
    } else {
      row.encryptedValue = encryptPayload({ bookingUrl } satisfies SalesBookingPayload);
    }
    await this.platformCredentials.save(row);
    return this.summary();
  }

  async remove() {
    const row = await this.row();
    if (row) await this.platformCredentials.remove(row);
    return this.summary();
  }

  async publicSummary() {
    const summary = await this.summary();
    return {
      configured: summary.configured,
      bookingUrl: summary.bookingUrl,
    };
  }
}
