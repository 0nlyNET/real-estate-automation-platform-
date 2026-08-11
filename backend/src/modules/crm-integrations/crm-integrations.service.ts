import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CrmEventsService } from '../crm-events/crm-events.service';
import { IntegrationIngressEvent } from '../crm-events/integration-ingress-event.entity';
import { TenantIntegrationConnection } from '../crm-events/tenant-integration-connection.entity';
import { LeadsService } from '../leads/leads.service';
import { TestRun } from '../testing/test-run.entity';
import { CreateWebhookSubscriptionDto, ZapierLeadIngressDto } from './crm-integrations.dto';
import { ZapierCrmConnector } from './crm-connector';

@Injectable()
export class CrmIntegrationsService {
  private readonly zapier = new ZapierCrmConnector();

  constructor(
    @InjectRepository(TenantIntegrationConnection)
    private readonly connections: Repository<TenantIntegrationConnection>,
    @InjectRepository(IntegrationIngressEvent)
    private readonly ingressEvents: Repository<IntegrationIngressEvent>,
    @InjectRepository(TestRun)
    private readonly testRuns: Repository<TestRun>,
    private readonly leads: LeadsService,
    private readonly events: CrmEventsService,
    private readonly audit: AuditService,
  ) {}

  async createZapierConnection(tenantId: string, label?: string) {
    if (await this.connections.count({ where: { tenantId, provider: 'zapier', status: 'active' } }) >= 10) {
      throw new BadRequestException('Zapier connection limit reached');
    }
    const publicIdentifier = randomBytes(9).toString('base64url');
    const secret = randomBytes(32).toString('base64url');
    const row = await this.connections.save(
      this.connections.create({
        tenantId,
        provider: 'zapier',
        status: 'active',
        publicIdentifier,
        secretHash: digest(secret),
        secretLast4: secret.slice(-4),
        configuration: { label: String(label || 'Zapier').trim() },
        capabilities: this.zapier.capabilities,
        lastUsedAt: null,
        lastTestedAt: null,
        lastError: null,
        revokedAt: null,
      }),
    );
    return {
      ...this.publicConnection(row),
      credential: `rtzi_${publicIdentifier}.${secret}`,
      notice: 'Copy this credential now. RealtyTechAI stores only its hash.',
    };
  }

  async listConnections(tenantId: string) {
    const rows = await this.connections.find({
      where: { tenantId, provider: 'zapier' },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.publicConnection(row));
  }

  async rotateConnection(tenantId: string, id: string) {
    const row = await this.requireTenantConnection(tenantId, id);
    if (row.status === 'revoked') throw new BadRequestException('Revoked connection cannot be rotated');
    const secret = randomBytes(32).toString('base64url');
    row.secretHash = digest(secret);
    row.secretLast4 = secret.slice(-4);
    row.status = 'active';
    row.lastError = null;
    await this.connections.save(row);
    return {
      ...this.publicConnection(row),
      credential: `rtzi_${row.publicIdentifier}.${secret}`,
      notice: 'The prior credential stopped working immediately.',
    };
  }

  async revokeConnection(tenantId: string, id: string) {
    const row = await this.requireTenantConnection(tenantId, id);
    row.status = 'revoked';
    row.revokedAt = new Date();
    await this.connections.save(row);
    return this.publicConnection(row);
  }

  createWebhook(tenantId: string, dto: CreateWebhookSubscriptionDto) {
    return this.events.createSubscription(tenantId, dto.eventType, dto.targetUrl);
  }

  listWebhooks(tenantId: string) {
    return this.events.listSubscriptions(tenantId);
  }

  revokeWebhook(tenantId: string, id: string) {
    return this.events.revokeSubscription(tenantId, id);
  }

  testWebhook(tenantId: string, id: string) {
    return this.events.testSubscription(tenantId, id);
  }

  async ingestZapierLead(input: {
    authorization?: string;
    headerEventId?: string;
    testRunId?: string;
    payload: ZapierLeadIngressDto;
  }) {
    const connection = await this.authenticate(input.authorization);
    return this.ingestForConnection(connection, input);
  }

  async sendTestLead(tenantId: string, connectionId: string) {
    const connection = await this.requireTenantConnection(tenantId, connectionId);
    if (connection.status !== 'active') {
      throw new BadRequestException('Zapier connection is not active');
    }
    const run = await this.testRuns.findOne({
      where: { tenantId, status: 'running' },
      order: { createdAt: 'DESC' },
    });
    if (!run || run.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Start a controlled test run before sending a Zapier test lead');
    }
    if (!run.smsRecipient && !run.emailRecipient) {
      throw new BadRequestException('Controlled test recipients are missing');
    }
    const result = await this.ingestForConnection(connection, {
      headerEventId: undefined,
      testRunId: run.id,
      payload: {
        externalEventId: randomUUID(),
        externalLeadId: `controlled-test-${run.id}`,
        fullName: 'RealtyTechAI Zapier Test Lead',
        phone: run.smsRecipient || undefined,
        email: run.emailRecipient || undefined,
        source: 'controlled_zapier_test',
        sourceSystem: 'zapier_connection_test',
        message: 'Controlled Zapier connection test',
        leadType: 'buyer',
        temperature: 'warm',
        consent: {
          sms: Boolean(run.smsRecipient),
          email: Boolean(run.emailRecipient),
          source: 'controlled_uat',
        } as any,
      },
    });
    connection.lastTestedAt = new Date();
    connection.lastError = null;
    await this.connections.save(connection);
    return { ...result, controlledTest: true, testRunId: run.id };
  }

  private async ingestForConnection(
    connection: TenantIntegrationConnection,
    input: {
      headerEventId?: string;
      testRunId?: string;
      payload: ZapierLeadIngressDto;
    },
  ) {
    const payloadEventId = String(input.payload.externalEventId || '').trim();
    const headerEventId = String(input.headerEventId || '').trim();
    if (headerEventId && headerEventId !== payloadEventId) {
      throw new BadRequestException('Event ID header and payload do not match');
    }
    const normalized = this.zapier.normalizeInboundLead(input.payload);
    assertMetadata(input.payload.metadata);
    const existing = await this.ingressEvents.findOne({
      where: { connectionId: connection.id, externalEventId: payloadEventId },
    });
    let event = existing;
    if (event && event.status !== 'failed') return this.duplicateResponse(event);
    if (event) {
      event.status = 'processing';
      event.failureReason = null;
      event.processedAt = null;
      await this.ingressEvents.save(event);
    } else {
      event = this.ingressEvents.create({
        id: randomUUID(),
        tenantId: connection.tenantId,
        connectionId: connection.id,
        externalEventId: payloadEventId,
        leadId: null,
        status: 'processing',
        attribution: {
          provider: this.zapier.provider,
          sourceSystem: normalized.sourceSystem,
          originalSource: normalized.originalSource,
          externalLeadId: normalized.externalLeadId,
        },
        failureReason: null,
        processedAt: null,
      });
      try {
        await this.ingressEvents
          .createQueryBuilder()
          .insert()
          .into(IntegrationIngressEvent)
          .values(event as any)
          .execute();
      } catch (error: any) {
        if (String(error?.code) !== '23505') throw error;
        const duplicate = await this.ingressEvents.findOneOrFail({
          where: { connectionId: connection.id, externalEventId: payloadEventId },
        });
        return this.duplicateResponse(duplicate);
      }
    }

    try {
      const controlledTest = await this.controlledTest(
        connection.tenantId,
        input.testRunId,
      );
      const lead = await this.leads.intake(
        connection.tenantId,
        {
          ...normalized,
        } as any,
        controlledTest,
      );
      const attributed = await this.leads.applyIntegrationAttribution(connection.tenantId, lead.id, {
        ingestionProvider: normalized.ingestionProvider,
        sourceSystem: normalized.sourceSystem,
        originalSource: normalized.originalSource,
        externalLeadId: normalized.externalLeadId,
      });
      event.leadId = attributed.id;
      event.status = 'accepted';
      event.processedAt = new Date();
      await this.ingressEvents.save(event);
      connection.lastUsedAt = new Date();
      if ('controlledTest' in controlledTest && controlledTest.controlledTest) {
        connection.lastTestedAt = new Date();
      }
      connection.lastError = null;
      await this.connections.save(connection);
      await this.audit.recordSystemEvent({
        tenantId: connection.tenantId,
        eventType: 'integration.lead_ingested',
        resourceType: 'lead',
        resourceId: attributed.id,
        metadata: {
          connectionId: connection.id,
          ingressEventId: event.id,
          externalEventId: payloadEventId,
          sourceSystem: attributed.sourceSystem,
        },
      });
      return { accepted: true, deduplicated: false, eventId: event.id, leadId: attributed.id };
    } catch (error: any) {
      event.status = 'failed';
      event.failureReason = String(error?.message || error).slice(0, 2_000);
      event.processedAt = new Date();
      await this.ingressEvents.save(event);
      connection.lastError = event.failureReason;
      await this.connections.save(connection);
      throw error;
    }
  }

  private async authenticate(authorization?: string) {
    const match = /^Bearer\s+rtzi_([A-Za-z0-9_-]{8,32})\.([A-Za-z0-9_-]{32,})$/i.exec(
      String(authorization || '').trim(),
    );
    if (!match) throw new UnauthorizedException('Valid Zapier connection credential required');
    const connection = await this.connections.findOne({
      where: { publicIdentifier: match[1], provider: 'zapier', status: 'active' },
    });
    const provided = Buffer.from(digest(match[2]), 'hex');
    const expected = Buffer.from(connection?.secretHash || '0'.repeat(64), 'hex');
    if (!connection || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new UnauthorizedException('Valid Zapier connection credential required');
    }
    return connection;
  }

  private async controlledTest(tenantId: string, testRunId?: string) {
    if (!testRunId) return { source: 'zapier' as const };
    const run = await this.testRuns.findOne({ where: { id: testRunId, tenantId, status: 'running' } });
    if (!run || run.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Controlled test run is invalid or expired');
    }
    return { source: 'zapier' as const, controlledTest: true, testRunId: run.id };
  }

  private duplicateResponse(event: IntegrationIngressEvent) {
    if (event.status === 'processing') {
      return { accepted: true, processing: true, deduplicated: true, eventId: event.id };
    }
    if (event.status === 'failed') {
      throw new BadRequestException({
        code: 'EVENT_PREVIOUSLY_FAILED',
        message: 'This event ID was already processed and failed; retry with a new event ID',
      });
    }
    return { accepted: true, deduplicated: true, eventId: event.id, leadId: event.leadId };
  }

  private async requireTenantConnection(tenantId: string, id: string) {
    const row = await this.connections.findOne({ where: { id, tenantId, provider: 'zapier' } });
    if (!row) throw new NotFoundException('Zapier connection not found');
    return row;
  }

  private publicConnection(row: TenantIntegrationConnection) {
    return {
      id: row.id,
      provider: row.provider,
      status: row.status,
      secretLast4: row.secretLast4,
      configuration: row.configuration,
      capabilities: row.capabilities,
      inboundUrl: `${String(process.env.PUBLIC_API_URL || '').replace(/\/+$/, '')}/integrations/zapier/leads`,
      lastUsedAt: row.lastUsedAt,
      lastTestedAt: row.lastTestedAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
    };
  }
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function assertMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return;
  const serialized = JSON.stringify(metadata);
  if (Buffer.byteLength(serialized, 'utf8') > 8_192) {
    throw new BadRequestException('Metadata exceeds 8 KB');
  }
  const visit = (value: unknown, depth: number) => {
    if (depth > 5) throw new BadRequestException('Metadata nesting is too deep');
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        throw new BadRequestException('Metadata contains an unsafe key');
      }
      visit(nested, depth + 1);
    }
  };
  visit(metadata, 0);
}
