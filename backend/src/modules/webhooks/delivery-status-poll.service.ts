import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Message } from '../messaging/message.entity';

/**
 * Polls SendGrid's Email Activity API for delivery status of outbound emails
 * that are stuck in `provider_accepted`.
 *
 * Why polling: SendGrid's Event Webhook is account-level and points to the
 * production backend, so staging never receives delivery callbacks and its UI
 * shows "Provider Accepted" forever. This poller is fully isolated — it only
 * READS from SendGrid's API and never changes any SendGrid configuration.
 *
 * Safety:
 * - No-op unless `DELIVERY_POLL_ENABLED === 'true'` and `SENDGRID_API_KEY` is set.
 * - Never runs against production unless `DELIVERY_POLL_ALLOW_PROD === 'true'`
 *   is explicitly set (default: false).
 * - Only touches outbound email messages already in `provider_accepted` with
 *   a `sendgrid:` provider message id; it never changes the webhook handler,
 *   consent, entitlement, or tenant-isolation behavior.
 */
@Injectable()
export class DeliveryStatusPollService {
  private readonly logger = new Logger(DeliveryStatusPollService.name);

  private static readonly POLL_BATCH_SIZE = 50;
  private static readonly SENDGRID_ACTIVITY_URL =
    'https://api.sendgrid.com/v3/messages';

  constructor(
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
  ) {}

  private pollEnabled(): boolean {
    return (
      process.env.DELIVERY_POLL_ENABLED === 'true' &&
      Boolean(process.env.SENDGRID_API_KEY)
    );
  }

  private environmentAllowed(): boolean {
    if (process.env.NODE_ENV === 'production') {
      return process.env.DELIVERY_POLL_ALLOW_PROD === 'true';
    }
    return true;
  }

  @Cron('*/5 * * * *')
  async pollDeliveryStatus(): Promise<void> {
    if (!this.pollEnabled()) {
      this.logger.debug(
        'Delivery status poll skipped: DELIVERY_POLL_ENABLED is not true or SENDGRID_API_KEY is missing.',
      );
      return;
    }
    if (!this.environmentAllowed()) {
      this.logger.warn(
        'Delivery status poll skipped: production environment requires DELIVERY_POLL_ALLOW_PROD=true.',
      );
      return;
    }

    const pending = await this.messages
      .createQueryBuilder('message')
      .where("message.status = 'provider_accepted'")
      .andWhere("message.channel = 'email'")
      .andWhere("message.direction = 'outbound'")
      .andWhere("message.provider_message_id LIKE 'sendgrid:%'")
      .orderBy('message.created_at', 'ASC')
      .take(DeliveryStatusPollService.POLL_BATCH_SIZE)
      .getMany();

    let updated = 0;
    for (const message of pending) {
      try {
        const changed = await this.refreshMessageStatus(message);
        if (changed) updated += 1;
      } catch (error) {
        this.logger.warn(
          `Delivery status poll failed for message ${message.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    this.logger.log(
      `Delivery status poll completed: checked ${pending.length} message(s), updated ${updated}.`,
    );
  }

  private async refreshMessageStatus(message: Message): Promise<boolean> {
    const sgMessageId = (message.providerMessageId || '')
      .replace(/^sendgrid:/, '')
      .trim();
    if (!sgMessageId) return false;

    const event = await this.fetchLatestActivity(sgMessageId);
    if (!event) return false;

    const eventType = String(event.status || '')
      .trim()
      .toLowerCase();
    if (!eventType) return false;

    message.providerStatus = eventType;

    if (eventType === 'delivered') {
      if (message.status === 'delivered') return false;
      message.status = 'delivered';
      message.deliveredAt = new Date();
      await this.messages.save(message);
      return true;
    }

    if (eventType === 'bounce' || eventType === 'dropped' || eventType === 'blocked') {
      if (message.status === 'failed') return false;
      message.status = 'failed';
      message.failedAt = new Date();
      const reason = String(event.reason || event.status || '').slice(0, 1000);
      message.lastError = reason
        ? `SendGrid activity: ${eventType}${reason ? ` — ${reason}` : ''}`
        : `SendGrid activity: ${eventType}`;
      await this.messages.save(message);
      return true;
    }

    // 'deferred', 'processed', etc: keep provider_accepted, persist latest status.
    await this.messages.save(message);
    return true;
  }

  private async fetchLatestActivity(
    sgMessageId: string,
  ): Promise<Record<string, unknown> | null> {
    const query = `msg_id="${sgMessageId}"`;
    const url = `${DeliveryStatusPollService.SENDGRID_ACTIVITY_URL}?query=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        this.logger.error(
          `SendGrid activity API authentication failed (${response.status}) for message ${sgMessageId}. Check SENDGRID_API_KEY permissions (Email Activity read scope required).`,
        );
      } else if (response.status === 429) {
        this.logger.warn(
          `SendGrid activity API rate limited (429) for message ${sgMessageId}. Backing off this cycle.`,
        );
      } else {
        this.logger.warn(
          `SendGrid activity API returned ${response.status} for message ${sgMessageId}.`,
        );
      }
      return null;
    }
    const body = (await response.json()) as {
      messages?: Array<Record<string, unknown>>;
    };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    return messages.length > 0 ? messages[0] : null;
  }
}
