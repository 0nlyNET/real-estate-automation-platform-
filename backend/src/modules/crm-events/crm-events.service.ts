import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { decryptString, encryptString } from '../../common/crypto-secrets';
import { sanitizeOperationalText } from '../../common/operational-log';
import { DurableJobsService } from '../durable-jobs/durable-jobs.service';
import { OperationsService } from '../operations/operations.service';
import { IntegrationDeliveryEvent } from './integration-delivery-event.entity';
import { TenantWebhookSubscription } from './tenant-webhook-subscription.entity';

export const CRM_EVENT_TYPES = [
  'lead.created',
  'lead.updated',
  'lead.engaged',
  'lead.qualified',
  'lead.status_changed',
  'lead.human_handoff',
  'appointment.created',
  'conversation.summary_ready',
  'lead.opted_out',
  'test.ping',
] as const;

@Injectable()
export class CrmEventsService implements OnModuleInit {
  constructor(
    @InjectRepository(TenantWebhookSubscription)
    private readonly subscriptions: Repository<TenantWebhookSubscription>,
    @InjectRepository(IntegrationDeliveryEvent)
    private readonly deliveries: Repository<IntegrationDeliveryEvent>,
    private readonly jobs: DurableJobsService,
    private readonly operations: OperationsService,
  ) {}

  onModuleInit() {
    this.jobs.register('integration.webhook_delivery', async (job) => {
      const deliveryId = String(job.payload.deliveryId || '');
      if (!deliveryId) throw new Error('Webhook delivery job is missing deliveryId');
      try {
        await this.deliver(deliveryId);
      } catch (error: any) {
        if (job.attemptCount >= job.maxAttempts) {
          await this.markExhausted(deliveryId, error);
        }
        throw error;
      }
    });
  }

  async createSubscription(tenantId: string, eventType: string, targetUrl: string) {
    assertEventType(eventType);
    const normalizedUrl = assertSafeWebhookUrl(targetUrl);
    if (await this.subscriptions.count({ where: { tenantId, status: 'active' } }) >= 20) {
      throw new BadRequestException('Webhook subscription limit reached');
    }
    const rawSecret = `rtwhsec_${randomBytes(32).toString('base64url')}`;
    const saved = await this.subscriptions.save(
      this.subscriptions.create({
        tenantId,
        eventType,
        targetUrl: normalizedUrl,
        encryptedSigningSecret: encryptString(rawSecret),
        secretLast4: rawSecret.slice(-4),
        status: 'active',
        failureCount: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
      }),
    );
    return { ...this.publicSubscription(saved), signingSecret: rawSecret };
  }

  async listSubscriptions(tenantId: string) {
    const rows = await this.subscriptions.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.publicSubscription(row));
  }

  async revokeSubscription(tenantId: string, id: string) {
    const subscription = await this.subscriptions.findOne({ where: { id, tenantId } });
    if (!subscription) throw new NotFoundException('Webhook subscription not found');
    subscription.status = 'revoked';
    await this.subscriptions.save(subscription);
    return this.publicSubscription(subscription);
  }

  async testSubscription(tenantId: string, id: string) {
    const subscription = await this.subscriptions.findOne({ where: { id, tenantId, status: 'active' } });
    if (!subscription) throw new NotFoundException('Active webhook subscription not found');
    const [delivery] = await this.persistDeliveries(
      tenantId,
      'test.ping',
      { connection: 'zapier', requestedAt: new Date().toISOString() },
      [subscription],
    );
    return { queued: true, eventId: delivery.eventId, deliveryId: delivery.id };
  }

  async publish(
    tenantId: string,
    eventType: Exclude<(typeof CRM_EVENT_TYPES)[number], 'test.ping'>,
    data: Record<string, unknown>,
  ) {
    assertEventType(eventType);
    const subscriptions = await this.subscriptions.find({
      where: { tenantId, eventType, status: 'active' },
    });
    if (!subscriptions.length) return { queued: 0 };
    const deliveries = await this.persistDeliveries(tenantId, eventType, data, subscriptions);
    return { queued: deliveries.length, eventIds: deliveries.map((row) => row.eventId) };
  }

  async retryDelivery(tenantId: string, deliveryId: string) {
    const delivery = await this.deliveries.findOne({ where: { id: deliveryId, tenantId } });
    if (!delivery) throw new NotFoundException('Webhook delivery not found');
    delivery.status = 'scheduled';
    delivery.lastError = null;
    await this.deliveries.save(delivery);
    await this.schedule(delivery);
    return { queued: true, deliveryId };
  }

  private async persistDeliveries(
    tenantId: string,
    eventType: string,
    data: Record<string, unknown>,
    subscriptions: TenantWebhookSubscription[],
  ) {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const payload = {
      id: eventId,
      type: eventType,
      occurredAt,
      tenantId,
      apiVersion: '2026-08-11',
      data,
    };
    const deliveries = await this.deliveries.save(
      subscriptions.map((subscription) =>
        this.deliveries.create({
          tenantId,
          subscriptionId: subscription.id,
          eventId,
          eventType,
          payload,
          status: 'scheduled',
          attemptCount: 0,
          lastHttpStatus: null,
          lastError: null,
          deliveredAt: null,
        }),
      ),
    );
    await Promise.all(deliveries.map((delivery) => this.schedule(delivery)));
    return deliveries;
  }

  private schedule(delivery: IntegrationDeliveryEvent) {
    return this.jobs.schedule({
      taskType: 'integration.webhook_delivery',
      tenantId: delivery.tenantId,
      dedupeKey: `integration-delivery:${delivery.id}`,
      payload: { deliveryId: delivery.id },
      maxAttempts: 10,
    });
  }

  private async deliver(deliveryId: string) {
    const delivery = await this.deliveries.findOne({ where: { id: deliveryId } });
    if (!delivery || delivery.status === 'delivered') return;
    const subscription = await this.subscriptions.findOne({
      where: { id: delivery.subscriptionId, tenantId: delivery.tenantId },
    });
    if (!subscription || subscription.status !== 'active') {
      throw new Error('Webhook subscription is not active');
    }
    const targetUrl = assertSafeWebhookUrl(subscription.targetUrl);
    const body = JSON.stringify(delivery.payload);
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = createHmac('sha256', decryptString(subscription.encryptedSigningSecret))
      .update(`${timestamp}.${body}`)
      .digest('hex');
    delivery.status = 'delivering';
    delivery.attemptCount += 1;
    await this.deliveries.save(delivery);
    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'RealtyTechAI-Webhooks/1.0',
          'X-RealtyTechAI-Event-Id': delivery.eventId,
          'X-RealtyTechAI-Event-Type': delivery.eventType,
          'X-RealtyTechAI-Timestamp': timestamp,
          'X-RealtyTechAI-Signature': `v1=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      delivery.lastHttpStatus = response.status;
      if (!response.ok) {
        const responseBody = await response.text().catch(() => '');
        throw new Error(`Webhook returned ${response.status}: ${responseBody.slice(0, 300)}`);
      }
      delivery.status = 'delivered';
      delivery.deliveredAt = new Date();
      delivery.lastError = null;
      subscription.failureCount = 0;
      subscription.lastSuccessAt = new Date();
      subscription.lastError = null;
      await Promise.all([
        this.deliveries.save(delivery),
        this.subscriptions.save(subscription),
      ]);
    } catch (error: any) {
      const safe = sanitizeOperationalText(error?.message || error, 1_000);
      delivery.status = 'scheduled';
      delivery.lastError = safe;
      subscription.failureCount += 1;
      subscription.lastFailureAt = new Date();
      subscription.lastError = safe;
      await Promise.all([
        this.deliveries.save(delivery),
        this.subscriptions.save(subscription),
      ]);
      throw error;
    }
  }

  private async markExhausted(deliveryId: string, error: unknown) {
    const delivery = await this.deliveries.findOne({ where: { id: deliveryId } });
    if (!delivery) return;
    delivery.status = 'failed';
    delivery.lastError = sanitizeOperationalText(
      error instanceof Error ? error.message : String(error),
      1_000,
    );
    await this.deliveries.save(delivery);
    await this.operations.createTask({
      tenantId: delivery.tenantId,
      category: 'integration_delivery',
      title: 'CRM webhook delivery retries exhausted',
      description: delivery.lastError,
      priority: 'high',
      relatedEntityType: 'integration_delivery_event',
      relatedEntityId: delivery.id,
      dedupeOpen: true,
    });
  }

  private publicSubscription(row: TenantWebhookSubscription) {
    return {
      id: row.id,
      eventType: row.eventType,
      targetUrl: row.targetUrl,
      status: row.status,
      secretLast4: row.secretLast4,
      failureCount: row.failureCount,
      lastSuccessAt: row.lastSuccessAt,
      lastFailureAt: row.lastFailureAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
    };
  }
}

function assertEventType(eventType: string) {
  if (!(CRM_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new BadRequestException('Unsupported webhook event type');
  }
}

export function assertSafeWebhookUrl(value: string) {
  let url: URL;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new BadRequestException('Webhook URL is invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new BadRequestException('Webhook URL must use HTTPS without credentials or a custom port');
  }
  const configured = String(process.env.OUTBOUND_WEBHOOK_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const allowed = ['hooks.zapier.com', ...configured];
  const hostname = url.hostname.toLowerCase();
  if (!allowed.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    throw new BadRequestException('Webhook host is not on the approved allowlist');
  }
  url.hash = '';
  return url.toString();
}
