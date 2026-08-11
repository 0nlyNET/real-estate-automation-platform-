import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { hasAtLeastRole, UserRole } from '../../common/rbac';
import { sanitizeOperationalText } from '../../common/operational-log';
import { AuditService } from '../audit/audit.service';
import { CrmEventsService } from '../crm-events/crm-events.service';
import { DurableJob } from '../durable-jobs/durable-job.entity';
import { ProviderConfigService } from '../integrations/provider-config.service';
import { TenantProvisioningService } from '../integrations/tenant-provisioning.service';
import { LimitsService } from '../limits/limits.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { OperationsTask } from '../operations/operations-task.entity';
import { OperationsService } from '../operations/operations.service';
import { SettingsService } from '../settings/settings.service';
import { StatsService } from '../stats/stats.service';
import { AiConfigurationService } from './ai-configuration.service';
import { AssistantRun } from './assistant-run.entity';
import {
  RestrictedAssistantAction,
  RestrictedAssistantProvider,
} from './restricted-assistant.provider';
import { AiUsageService } from './ai-usage.service';

const CLIENT_TOOLS = [
  'get_readiness',
  'get_messaging_status',
  'get_usage',
  'get_reporting_summary',
  'retry_setup_reconciliation',
  'update_business_hours',
  'update_booking_link',
  'pause_automation',
  'resume_automation',
] as const;
const CLIENT_MUTATIONS = new Set<string>([
  'update_business_hours',
  'update_booking_link',
  'pause_automation',
  'resume_automation',
]);
const OPERATIONS_TOOLS = [
  'get_exception_summary',
  'recheck_tenant_readiness',
  'retry_durable_job',
  'reconcile_tenant_provisioning',
  'retry_webhook_delivery',
  'resolve_recovered_incident',
] as const;
const OPERATIONS_MUTATIONS = new Set<string>([
  'retry_durable_job',
  'reconcile_tenant_provisioning',
  'retry_webhook_delivery',
  'resolve_recovered_incident',
]);

type AssistantActor = {
  id: string;
  tenantId: string;
  email?: string | null;
  role?: string;
};

@Injectable()
export class RestrictedAssistantService {
  constructor(
    @InjectRepository(AssistantRun) private readonly runs: Repository<AssistantRun>,
    @InjectRepository(DurableJob) private readonly durableJobs: Repository<DurableJob>,
    @InjectRepository(OperationsTask) private readonly operationsTasks: Repository<OperationsTask>,
    private readonly provider: RestrictedAssistantProvider,
    private readonly limits: LimitsService,
    private readonly usage: AiUsageService,
    private readonly onboarding: OnboardingService,
    private readonly providerConfig: ProviderConfigService,
    private readonly stats: StatsService,
    private readonly settings: SettingsService,
    private readonly aiConfiguration: AiConfigurationService,
    private readonly operations: OperationsService,
    private readonly provisioning: TenantProvisioningService,
    private readonly crmEvents: CrmEventsService,
    private readonly audit: AuditService,
  ) {}

  askClient(actor: AssistantActor, prompt: string) {
    return this.ask('client', actor, prompt, CLIENT_TOOLS);
  }

  askOperations(actor: AssistantActor, prompt: string) {
    return this.ask('operations', actor, prompt, OPERATIONS_TOOLS);
  }

  async confirmClient(actor: AssistantActor, runId: string) {
    if (!actor.role || !hasAtLeastRole(actor.role as UserRole, 'admin')) {
      throw new ForbiddenException('Administrator permission is required to confirm changes');
    }
    return this.confirm('client', actor, runId);
  }

  confirmOperations(actor: AssistantActor, runId: string) {
    return this.confirm('operations', actor, runId);
  }

  private async ask(
    assistantType: 'client' | 'operations',
    actor: AssistantActor,
    prompt: string,
    allowedTools: readonly string[],
  ) {
    const run = await this.runs.save(
      this.runs.create({
        tenantId: actor.tenantId,
        actorId: actor.id,
        assistantType,
        inputDigest: createHash('sha256').update(prompt).digest('hex'),
        promptPreview: `[content withheld; ${prompt.length} characters]`,
        status: 'processing',
        provider: null,
        model: null,
        response: null,
        requestedActions: [],
        executedActions: [],
        blockedActions: [],
        inputUsage: 0,
        outputUsage: 0,
        estimatedCostUsd: null,
        latencyMs: null,
        errorCode: null,
        sanitizedError: null,
        confirmedAt: null,
      }),
    );
    const reservation = await this.limits.reserveUsage({
      tenantId: actor.tenantId,
      metric: 'ai',
      idempotencyKey: `assistant-run:${run.id}`,
    });
    if (!reservation.ok) {
      run.status = 'blocked';
      run.errorCode = reservation.code;
      run.sanitizedError = reservation.message;
      await this.runs.save(run);
      throw new ForbiddenException({ code: reservation.code, message: reservation.message });
    }
    try {
      const generated = await this.provider.generate({ assistantType, prompt, allowedTools });
      run.provider = generated.provider;
      run.model = generated.model;
      run.response = generated.response;
      run.requestedActions = generated.actions;
      run.inputUsage = generated.inputUsage;
      run.outputUsage = generated.outputUsage;
      run.estimatedCostUsd = this.usage.estimateCost(generated.inputUsage, generated.outputUsage);
      run.latencyMs = generated.latencyMs;
      const mutations = assistantType === 'client' ? CLIENT_MUTATIONS : OPERATIONS_MUTATIONS;
      for (const action of generated.actions) {
        if (mutations.has(action.name)) {
          run.blockedActions.push({ name: action.name, status: 'confirmation_required' });
          continue;
        }
        run.executedActions.push(await this.execute(assistantType, actor, action));
      }
      run.status = generated.actions.some((action) => mutations.has(action.name))
        ? 'confirmation_required'
        : 'completed';
      await this.runs.save(run);
      await this.recordAudit(run, actor, 'assistant.request_processed');
      return this.publicRun(run);
    } catch (error: any) {
      run.status = 'failed';
      run.errorCode = String(error?.response?.code || error?.code || 'ASSISTANT_FAILED').slice(0, 80);
      run.sanitizedError = sanitizeOperationalText(error?.message || error, 1_000);
      await this.runs.save(run);
      await this.recordAudit(run, actor, 'assistant.request_failed');
      throw error;
    }
  }

  private async confirm(
    assistantType: 'client' | 'operations',
    actor: AssistantActor,
    runId: string,
  ) {
    const run = await this.runs.findOne({
      where: { id: runId, tenantId: actor.tenantId, actorId: actor.id, assistantType },
    });
    if (!run) throw new NotFoundException('Assistant request not found');
    if (run.status !== 'confirmation_required' || run.confirmedAt) {
      throw new BadRequestException('Assistant request is not awaiting confirmation');
    }
    const mutations = assistantType === 'client' ? CLIENT_MUTATIONS : OPERATIONS_MUTATIONS;
    const pending = (run.requestedActions as unknown as RestrictedAssistantAction[]).filter(
      (action) => mutations.has(action.name),
    );
    run.confirmedAt = new Date();
    run.status = 'processing';
    await this.runs.save(run);
    try {
      for (let index = 0; index < pending.length; index += 1) {
        run.executedActions.push({
          ...(await this.execute(assistantType, actor, pending[index])),
          confirmedActionIndex: index,
        });
        await this.runs.save(run);
      }
      run.blockedActions = [];
      run.status = 'completed';
      await this.runs.save(run);
      await this.recordAudit(run, actor, 'assistant.actions_confirmed');
      return this.publicRun(run);
    } catch (error: any) {
      run.status = 'failed';
      run.errorCode = String(error?.response?.code || error?.code || 'ASSISTANT_ACTION_FAILED').slice(0, 80);
      run.sanitizedError = sanitizeOperationalText(error?.message || error, 1_000);
      await this.runs.save(run);
      await this.recordAudit(run, actor, 'assistant.actions_failed');
      throw error;
    }
  }

  private async execute(
    assistantType: 'client' | 'operations',
    actor: AssistantActor,
    action: RestrictedAssistantAction,
  ) {
    const args = parseArguments(action.arguments);
    const output = assistantType === 'client'
      ? await this.executeClient(actor, action.name, args)
      : await this.executeOperations(action.name, args);
    return { name: action.name, status: 'executed', output };
  }

  private async executeClient(actor: AssistantActor, name: string, args: Record<string, unknown>) {
    if (CLIENT_MUTATIONS.has(name) && (!actor.role || !hasAtLeastRole(actor.role as UserRole, 'admin'))) {
      throw new ForbiddenException('Administrator permission is required for this action');
    }
    if (name === 'get_readiness') {
      const readiness: any = await this.onboarding.readiness(actor.tenantId);
      return {
        ready: readiness.ready,
        lifecycleStatus: readiness.lifecycleStatus,
        blockers: (readiness.blockers || []).map((item: any) => ({ key: item.key, label: item.label, category: item.category })),
      };
    }
    if (name === 'get_messaging_status') {
      const [sms, email] = await Promise.all([
        this.providerConfig.resolveTwilio(actor.tenantId, { allowTesting: true }),
        this.providerConfig.resolveSendGrid(actor.tenantId, { allowTesting: true }),
      ]);
      return { smsReady: Boolean(sms), emailReady: Boolean(email) };
    }
    if (name === 'get_usage') return this.limits.tenantUsageReport(actor.tenantId, 30);
    if (name === 'get_reporting_summary') {
      return this.stats.overview(actor.tenantId, { userId: actor.id, role: actor.role });
    }
    if (name === 'retry_setup_reconciliation') {
      if (!actor.role || !hasAtLeastRole(actor.role as UserRole, 'admin')) {
        throw new ForbiddenException('Administrator permission is required for this action');
      }
      const readiness: any = await this.onboarding.readiness(actor.tenantId);
      if (readiness.ready) return { queued: false, alreadyReady: true };
      const job: any = await this.provisioning.scheduleTenant(actor.tenantId);
      return { queued: true, tenantId: actor.tenantId, jobId: job?.id || null };
    }
    if (name === 'update_business_hours') {
      const businessHours = objectArgument(args.businessHours, 'businessHours');
      return this.aiConfiguration.updateKnowledge(
        actor.tenantId,
        { businessHours } as any,
        { userId: actor.id, email: actor.email },
      );
    }
    if (name === 'update_booking_link') {
      return this.settings.updateTenantSettings(actor.tenantId, {
        bookingLink: requiredString(args.bookingLink, 'bookingLink', 2_048),
      });
    }
    if (name === 'pause_automation') {
      return this.settings.updateTenantSettings(actor.tenantId, { automationsEnabled: false });
    }
    if (name === 'resume_automation') {
      return this.settings.updateTenantSettings(actor.tenantId, { automationsEnabled: true });
    }
    throw new BadRequestException('Client assistant action is not allowlisted');
  }

  private async executeOperations(name: string, args: Record<string, unknown>) {
    if (name === 'get_exception_summary') return this.operations.exceptionSummary();
    if (name === 'recheck_tenant_readiness') {
      return this.onboarding.readiness(requiredUuid(args.tenantId, 'tenantId'));
    }
    if (name === 'retry_durable_job') {
      const id = requiredUuid(args.jobId, 'jobId');
      const job = await this.durableJobs.findOne({ where: { id } });
      if (!job) throw new NotFoundException('Durable job not found');
      if (job.status !== 'failed') throw new BadRequestException('Only failed jobs can be retried');
      job.status = 'scheduled';
      job.nextRunAt = new Date();
      job.attemptCount = 0;
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.lastError = null;
      job.completedAt = null;
      await this.durableJobs.save(job);
      return { jobId: job.id, queued: true };
    }
    if (name === 'reconcile_tenant_provisioning') {
      const tenantId = requiredUuid(args.tenantId, 'tenantId');
      const job: any = await this.provisioning.scheduleTenant(tenantId);
      return { tenantId, queued: true, jobId: job?.id || null };
    }
    if (name === 'retry_webhook_delivery') {
      return this.crmEvents.retryDelivery(
        requiredUuid(args.tenantId, 'tenantId'),
        requiredUuid(args.deliveryId, 'deliveryId'),
      );
    }
    if (name === 'resolve_recovered_incident') {
      const taskId = requiredUuid(args.taskId, 'taskId');
      const evidence = requiredString(args.recoveryEvidence, 'recoveryEvidence', 1_000);
      if (evidence.length < 12) throw new BadRequestException('Recovery evidence is too short');
      const task = await this.operationsTasks.findOne({ where: { id: taskId } });
      if (!task) throw new NotFoundException('Operations task not found');
      if (task.relatedEntityType === 'durable_job' && task.relatedEntityId) {
        const job = await this.durableJobs.findOne({ where: { id: task.relatedEntityId } });
        if (!job || job.status !== 'completed') {
          throw new BadRequestException('Related durable job has not recovered');
        }
      }
      return this.operations.updateTask(taskId, { status: 'resolved', evidenceNote: evidence });
    }
    throw new BadRequestException('Operations assistant action is not allowlisted');
  }

  private recordAudit(run: AssistantRun, actor: AssistantActor, eventType: string) {
    return this.audit.record({
      tenantId: run.tenantId,
      actorId: actor.id,
      actorEmail: actor.email || null,
      action: eventType,
      eventType,
      resourceType: 'assistant_run',
      resourceId: run.id,
      method: 'SYSTEM',
      path: `/ai/${run.assistantType}-assistant`,
      statusCode: run.status === 'failed' ? 500 : 200,
      metadata: {
        assistantType: run.assistantType,
        status: run.status,
        provider: run.provider,
        model: run.model,
        requestedActions: run.requestedActions.map((item: any) => item.name),
        executedActions: run.executedActions.map((item: any) => item.name),
        inputUsage: run.inputUsage,
        outputUsage: run.outputUsage,
        estimatedCostUsd: run.estimatedCostUsd,
        latencyMs: run.latencyMs,
      },
    });
  }

  private publicRun(run: AssistantRun) {
    return {
      id: run.id,
      assistantType: run.assistantType,
      status: run.status,
      provider: run.provider,
      model: run.model,
      response: run.response,
      results: run.executedActions,
      confirmationRequired: run.status === 'confirmation_required'
        ? run.requestedActions.filter((item: any) =>
            (run.assistantType === 'client' ? CLIENT_MUTATIONS : OPERATIONS_MUTATIONS).has(item.name),
          ).map((item: any) => ({ name: item.name, arguments: safeArguments(item.arguments) }))
        : [],
      usage: {
        inputTokens: run.inputUsage,
        outputTokens: run.outputUsage,
        estimatedCostUsd: run.estimatedCostUsd,
        latencyMs: run.latencyMs,
      },
    };
  }
}

function parseArguments(value: string) {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new BadRequestException('Assistant action arguments must be a JSON object');
  }
}

function safeArguments(value: unknown) {
  const parsed = parseArguments(String(value || '{}'));
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, typeof item === 'string' ? item.slice(0, 500) : item]));
}

function requiredString(value: unknown, label: string, max: number) {
  const result = typeof value === 'string' ? value.trim().slice(0, max) : '';
  if (!result) throw new BadRequestException(`${label} is required`);
  return result;
}

function requiredUuid(value: unknown, label: string) {
  const result = requiredString(value, label, 40);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new BadRequestException(`${label} must be a UUID`);
  }
  return result;
}

function objectArgument(value: unknown, label: string) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new BadRequestException(`${label} must be an object`);
  }
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 14);
  return Object.fromEntries(entries.map(([key, item]) => [key.slice(0, 30), String(item).slice(0, 160)]));
}
