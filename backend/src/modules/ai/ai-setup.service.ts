import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { sanitizeOperationalText } from '../../common/operational-log';
import { AuditService } from '../audit/audit.service';
import { LimitsService } from '../limits/limits.service';
import { PlatformAiControl } from './platform-ai-control.entity';
import { RestrictedAssistantProvider } from './restricted-assistant.provider';

@Injectable()
export class AiSetupService {
  constructor(
    @InjectRepository(PlatformAiControl)
    private readonly controls: Repository<PlatformAiControl>,
    private readonly provider: RestrictedAssistantProvider,
    private readonly limits: LimitsService,
    private readonly audit: AuditService,
  ) {}

  async status() {
    const row = await this.controls.findOne({ where: { id: 'global' } });
    return {
      configured: Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
      model: String(process.env.OPENAI_ASSISTANT_MODEL || process.env.OPENAI_MODEL || '').trim() || null,
      lastTestedAt: row?.providerLastTestedAt || null,
      testedModel: row?.providerTestModel || null,
      lastError: row?.providerTestError || null,
      passed: Boolean(row?.providerLastTestedAt && !row.providerTestError),
    };
  }

  async test(actor: { id: string; tenantId: string; email?: string | null }) {
    const reservation = await this.limits.reserveUsage({
      tenantId: actor.tenantId,
      metric: 'ai',
      idempotencyKey: `openai-setup-test:${new Date().toISOString().slice(0, 13)}`,
    });
    if (!reservation.ok) throw new Error(reservation.message);
    let control = await this.controls.findOne({ where: { id: 'global' } });
    control ||= this.controls.create({ id: 'global', paused: false, reason: null });
    try {
      const result = await this.provider.generate({
        assistantType: 'operations',
        prompt: 'Return a concise readiness acknowledgement and request no actions.',
        allowedTools: [],
      });
      if (result.actions.length) throw new Error('Controlled test unexpectedly requested an action');
      control.providerLastTestedAt = new Date();
      control.providerTestModel = result.model;
      control.providerTestError = null;
      control.updatedById = actor.id;
      await this.controls.save(control);
      await this.audit.record({
        tenantId: actor.tenantId,
        actorId: actor.id,
        actorEmail: actor.email || null,
        action: 'openai.controlled_test_passed',
        resourceType: 'platform_ai_control',
        resourceId: null,
        method: 'POST',
        path: '/admin/ai/provider-test',
        statusCode: 200,
        metadata: { model: result.model, latencyMs: result.latencyMs },
      });
      return this.status();
    } catch (error: any) {
      control.providerTestError = sanitizeOperationalText(error?.message || error, 1_000);
      control.updatedById = actor.id;
      await this.controls.save(control);
      throw error;
    }
  }
}
