import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { In, IsNull, Repository } from 'typeorm';
import { decryptString, encryptString } from '../../common/crypto-secrets';
import { hasAtLeastRole, UserRole } from '../../common/rbac';
import { sanitizeOperationalText } from '../../common/operational-log';
import { AuditService } from '../audit/audit.service';
import { CrmEventsService } from '../crm-events/crm-events.service';
import { Appointment } from '../client-operations/appointment.entity';
import { DurableJob } from '../durable-jobs/durable-job.entity';
import { ProviderConfigService } from '../integrations/provider-config.service';
import { TenantProvisioningService } from '../integrations/tenant-provisioning.service';
import { LimitsService } from '../limits/limits.service';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { OnboardingService } from '../onboarding/onboarding.service';
import { OperationsTask } from '../operations/operations-task.entity';
import { OperationsService } from '../operations/operations.service';
import { SettingsService } from '../settings/settings.service';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { StatsService } from '../stats/stats.service';
import { Tenant } from '../tenants/tenant.entity';
import { AiConfigurationService } from './ai-configuration.service';
import { AssistantRun } from './assistant-run.entity';
import { PlatformAiControl } from './platform-ai-control.entity';
import {
  RestrictedAssistantAction,
  RestrictedAssistantHistoryMessage,
  RestrictedAssistantProvider,
} from './restricted-assistant.provider';
import { AiUsageService } from './ai-usage.service';

const CLIENT_TOOLS = [
  'get_readiness',
  'get_messaging_status',
  'get_usage',
  'get_reporting_summary',
  'get_automation_status',
  'get_recent_conversations',
  'get_upcoming_appointments',
  'get_lead_snapshot',
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
const CLIENT_MEMBER_TOOLS = [
  'get_readiness',
  'get_messaging_status',
  'get_usage',
  'get_reporting_summary',
  'get_automation_status',
  'get_recent_conversations',
  'get_upcoming_appointments',
  'get_lead_snapshot',
] as const;
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
const OPERATIONS_STAFF_TOOLS = [
  'get_exception_summary',
  'recheck_tenant_readiness',
] as const;

type AssistantActor = {
  id: string;
  tenantId: string;
  email?: string | null;
  role?: string;
  platformRole?: 'super_admin' | 'staff' | null;
};

@Injectable()
export class RestrictedAssistantService {
  private readonly logger = new Logger(RestrictedAssistantService.name);

  constructor(
    @InjectRepository(AssistantRun)
    private readonly runs: Repository<AssistantRun>,
    @InjectRepository(DurableJob)
    private readonly durableJobs: Repository<DurableJob>,
    @InjectRepository(OperationsTask)
    private readonly operationsTasks: Repository<OperationsTask>,
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
    @Optional()
    @InjectRepository(Tenant)
    private readonly tenants?: Repository<Tenant>,
    @Optional()
    @InjectRepository(TenantSettings)
    private readonly tenantSettings?: Repository<TenantSettings>,
    @Optional()
    @InjectRepository(PlatformAiControl)
    private readonly platformControls?: Repository<PlatformAiControl>,
    @Optional()
    @InjectRepository(Lead)
    private readonly leads?: Repository<Lead>,
    @Optional()
    @InjectRepository(Message)
    private readonly messages?: Repository<Message>,
    @Optional()
    @InjectRepository(Appointment)
    private readonly appointments?: Repository<Appointment>,
  ) {}

  askClient(actor: AssistantActor, prompt: string, requestId?: string) {
    const canAdminister = Boolean(
      actor.role && hasAtLeastRole(actor.role as UserRole, 'admin'),
    );
    return this.ask(
      'client',
      actor,
      prompt,
      canAdminister ? CLIENT_TOOLS : CLIENT_MEMBER_TOOLS,
      requestId,
    );
  }

  askOperations(actor: AssistantActor, prompt: string, requestId?: string) {
    return this.ask(
      'operations',
      actor,
      prompt,
      actor.platformRole === 'super_admin'
        ? OPERATIONS_TOOLS
        : OPERATIONS_STAFF_TOOLS,
      requestId,
    );
  }

  historyClient(actor: AssistantActor) {
    return this.listHistory('client', actor);
  }

  historyOperations(actor: AssistantActor) {
    return this.listHistory('operations', actor);
  }

  clientStatus() {
    return this.provider.configurationStatus();
  }

  async confirmClient(actor: AssistantActor, runId: string) {
    if (!actor.role || !hasAtLeastRole(actor.role as UserRole, 'admin')) {
      throw new ForbiddenException(
        'Administrator permission is required to confirm changes',
      );
    }
    return this.confirm('client', actor, runId);
  }

  confirmOperations(actor: AssistantActor, runId: string) {
    if (actor.platformRole !== 'super_admin') {
      throw new ForbiddenException(
        'Super-administrator permission is required to confirm recovery actions',
      );
    }
    return this.confirm('operations', actor, runId);
  }

  private async ask(
    assistantType: 'client' | 'operations',
    actor: AssistantActor,
    prompt: string,
    allowedTools: readonly string[],
    requestedId?: string,
  ) {
    const requestId = requestedId || randomUUID();
    const inputDigest = createHash('sha256').update(prompt).digest('hex');
    const existing = await this.runs.findOne({
      where: {
        tenantId: actor.tenantId,
        actorId: actor.id,
        assistantType,
        requestId,
      },
    });
    let run: AssistantRun;
    if (existing) {
      if (existing.inputDigest !== inputDigest) {
        throw new ConflictException({
          code: 'ASSISTANT_REQUEST_ID_REUSED',
          message: 'This assistant request ID was already used for different text.',
        });
      }
      if (!this.canRetry(existing)) return this.duplicateRun(existing);
      const claim = await this.runs.update(
        {
          id: existing.id,
          tenantId: actor.tenantId,
          actorId: actor.id,
          assistantType,
          status: In(['failed', 'blocked']),
          confirmedAt: IsNull(),
        },
        {
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
        },
      );
      if (claim.affected !== 1) {
        const current = await this.runs.findOne({
          where: {
            id: existing.id,
            tenantId: actor.tenantId,
            actorId: actor.id,
            assistantType,
          },
        });
        if (!current) throw new NotFoundException('Assistant request not found');
        return this.duplicateRun(current);
      }
      Object.assign(existing, {
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
      });
      run = existing;
    } else {
      let promptEncrypted: string;
      try {
        promptEncrypted = encryptString(prompt);
      } catch {
        throw new ServiceUnavailableException({
          code: 'ASSISTANT_HISTORY_NOT_CONFIGURED',
          message:
            'Secure assistant history is not configured. Set INTEGRATIONS_ENCRYPTION_KEY in the backend production environment and redeploy.',
        });
      }
      try {
        run = await this.runs.save(
          this.runs.create({
            tenantId: actor.tenantId,
            actorId: actor.id,
            assistantType,
            requestId,
            promptEncrypted,
            inputDigest,
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
      } catch (error: any) {
        if (String(error?.code || '') !== '23505') throw error;
        const duplicate = await this.runs.findOne({
          where: {
            tenantId: actor.tenantId,
            actorId: actor.id,
            assistantType,
            requestId,
          },
        });
        if (!duplicate) throw error;
        if (duplicate.inputDigest !== inputDigest) {
          throw new ConflictException({
            code: 'ASSISTANT_REQUEST_ID_REUSED',
            message:
              'This assistant request ID was already used for different text.',
          });
        }
        return this.duplicateRun(duplicate);
      }
    }

    const [history, context] = await Promise.all([
      this.contextHistory(assistantType, actor),
      this.requestContext(assistantType, actor),
    ]);

    try {
      const reservation = await this.limits.reserveUsage({
        tenantId: actor.tenantId,
        metric: 'ai',
        idempotencyKey: `assistant-request:${actor.id}:${requestId}`,
      });
      if (!reservation.ok) {
        run.status = 'blocked';
        run.errorCode = reservation.code;
        run.sanitizedError = reservation.message;
        await this.runs.save(run);
        await this.recordAuditSafely(run, actor, 'assistant.request_blocked');
        throw new ForbiddenException({
          code: reservation.code,
          message: reservation.message,
        });
      }
      const generated = await this.provider.generate({
        assistantType,
        prompt,
        allowedTools,
        history,
        context,
      });
      run.provider = generated.provider;
      run.model = generated.model;
      run.requestedActions = generated.actions;
      run.inputUsage = generated.inputUsage;
      run.outputUsage = generated.outputUsage;
      run.latencyMs = generated.latencyMs;
      const mutations =
        assistantType === 'client' ? CLIENT_MUTATIONS : OPERATIONS_MUTATIONS;
      for (const action of generated.actions) {
        if (mutations.has(action.name)) {
          run.blockedActions.push({
            name: action.name,
            status: 'confirmation_required',
          });
          continue;
        }
        run.executedActions.push(
          await this.executeSafely(assistantType, actor, action),
        );
      }
      if (generated.actions.length) {
        const finalized = await this.provider.finalize({
          assistantType,
          prompt,
          history,
          context,
          plannedResponse: generated.response,
          actionResults: [
            ...run.executedActions,
            ...run.blockedActions,
          ] as Array<Record<string, unknown>>,
        });
        run.response = finalized.response;
        run.model = finalized.model || run.model;
        run.inputUsage += finalized.inputUsage;
        run.outputUsage += finalized.outputUsage;
        run.latencyMs = (run.latencyMs || 0) + finalized.latencyMs;
      } else {
        run.response = generated.response;
      }
      run.estimatedCostUsd = this.usage.estimateCost(
        run.inputUsage,
        run.outputUsage,
      );
      run.status = generated.actions.some((action) =>
        mutations.has(action.name),
      )
        ? 'confirmation_required'
        : 'completed';
      await this.runs.save(run);
      await this.recordAuditSafely(run, actor, 'assistant.request_processed');
      return this.publicRun(run);
    } catch (error: any) {
      if (run.status === 'blocked') throw error;
      run.status = 'failed';
      run.errorCode = errorCode(error, 'ASSISTANT_FAILED');
      run.sanitizedError = errorMessage(error);
      await this.runs.save(run).catch((saveError) => {
        this.logger.error(
          `Assistant failure state could not be saved: ${saveError?.message || saveError}`,
        );
      });
      await this.recordAuditSafely(run, actor, 'assistant.request_failed');
      throw error;
    }
  }

  private async confirm(
    assistantType: 'client' | 'operations',
    actor: AssistantActor,
    runId: string,
  ) {
    const run = await this.runs.findOne({
      where: {
        id: runId,
        tenantId: actor.tenantId,
        actorId: actor.id,
        assistantType,
      },
    });
    if (!run) throw new NotFoundException('Assistant request not found');
    if (run.status !== 'confirmation_required' || run.confirmedAt) {
      throw new BadRequestException(
        'Assistant request is not awaiting confirmation',
      );
    }
    const mutations =
      assistantType === 'client' ? CLIENT_MUTATIONS : OPERATIONS_MUTATIONS;
    const pending = (
      run.requestedActions as unknown as RestrictedAssistantAction[]
    ).filter((action) => mutations.has(action.name));
    const confirmedAt = new Date();
    const claim = await this.runs.update(
      {
        id: run.id,
        tenantId: actor.tenantId,
        actorId: actor.id,
        assistantType,
        status: 'confirmation_required',
        confirmedAt: IsNull(),
      },
      { status: 'processing', confirmedAt },
    );
    if (claim.affected !== 1) {
      throw new ConflictException({
        code: 'ASSISTANT_CONFIRMATION_ALREADY_CLAIMED',
        message:
          'This assistant action was already confirmed or is being processed.',
      });
    }
    run.confirmedAt = confirmedAt;
    run.status = 'processing';
    for (let index = 0; index < pending.length; index += 1) {
      run.executedActions.push({
        ...(await this.executeSafely(assistantType, actor, pending[index])),
        confirmedActionIndex: index,
      });
      await this.runs.save(run);
    }
    run.blockedActions = [];
    const failed = run.executedActions.some(
      (result: any) => result.status === 'failed',
    );
    run.status = failed ? 'failed' : 'completed';
    if (failed) {
      run.errorCode = 'ASSISTANT_ACTION_FAILED';
      run.sanitizedError =
        'One or more confirmed actions could not be completed.';
    }
    await this.runs.save(run);
    await this.recordAuditSafely(
      run,
      actor,
      failed ? 'assistant.actions_failed' : 'assistant.actions_confirmed',
    );
    return this.publicRun(run);
  }

  private async executeSafely(
    assistantType: 'client' | 'operations',
    actor: AssistantActor,
    action: RestrictedAssistantAction,
  ) {
    try {
      return await this.execute(assistantType, actor, action);
    } catch (error: any) {
      return {
        name: action.name,
        status: 'failed',
        errorCode: errorCode(error, 'ASSISTANT_ACTION_FAILED'),
        message: errorMessage(error),
      };
    }
  }

  private async execute(
    assistantType: 'client' | 'operations',
    actor: AssistantActor,
    action: RestrictedAssistantAction,
  ) {
    const args = parseArguments(action.arguments);
    const output =
      assistantType === 'client'
        ? await this.executeClient(actor, action.name, args)
        : await this.executeOperations(action.name, args);
    return { name: action.name, status: 'executed', output };
  }

  private async executeClient(
    actor: AssistantActor,
    name: string,
    args: Record<string, unknown>,
  ) {
    if (
      CLIENT_MUTATIONS.has(name) &&
      (!actor.role || !hasAtLeastRole(actor.role as UserRole, 'admin'))
    ) {
      throw new ForbiddenException(
        'Administrator permission is required for this action',
      );
    }
    if (name === 'get_readiness') {
      const readiness: any = await this.onboarding.readiness(actor.tenantId);
      return {
        ready: readiness.ready,
        lifecycleStatus: readiness.lifecycleStatus,
        blockers: (readiness.blockers || []).map((item: any) => ({
          key: item.key,
          label: item.label,
          category: item.category,
        })),
      };
    }
    if (name === 'get_messaging_status') {
      const [sms, email] = await Promise.all([
        this.providerConfig.resolveTwilio(actor.tenantId, {
          allowTesting: true,
        }),
        this.providerConfig.resolveSendGrid(actor.tenantId, {
          allowTesting: true,
        }),
      ]);
      return { smsReady: Boolean(sms), emailReady: Boolean(email) };
    }
    if (name === 'get_usage')
      return this.limits.tenantUsageReport(actor.tenantId, 30);
    if (name === 'get_reporting_summary') {
      return this.stats.overview(actor.tenantId, {
        userId: actor.id,
        role: actor.role,
      });
    }
    if (name === 'get_automation_status') {
      const [settings, control] = await Promise.all([
        this.tenantSettings?.findOne({ where: { tenantId: actor.tenantId } }),
        this.platformControls?.findOne({ where: { id: 'global' } }),
      ]);
      return {
        workspaceAutomationsEnabled: settings?.automationsEnabled === true,
        globalAutomationsPaused:
          process.env.GLOBAL_AUTOMATIONS_DISABLED === 'true',
        platformAiPaused: control?.paused === true,
        platformAiPauseReason: control?.paused ? control.reason || null : null,
        manualRepliesContinue: true,
      };
    }
    if (name === 'get_recent_conversations') {
      return this.recentConversations(
        actor,
        boundedIntegerArgument(args.limit, 5, 1, 10),
      );
    }
    if (name === 'get_upcoming_appointments') {
      return this.upcomingAppointments(
        actor,
        boundedIntegerArgument(args.days, 30, 1, 90),
        boundedIntegerArgument(args.limit, 5, 1, 10),
      );
    }
    if (name === 'get_lead_snapshot') {
      return this.leadSnapshot(
        actor,
        requiredString(args.query, 'query', 160),
      );
    }
    if (name === 'retry_setup_reconciliation') {
      if (!actor.role || !hasAtLeastRole(actor.role as UserRole, 'admin')) {
        throw new ForbiddenException(
          'Administrator permission is required for this action',
        );
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
      return this.settings.updateTenantSettings(actor.tenantId, {
        automationsEnabled: false,
      });
    }
    if (name === 'resume_automation') {
      return this.settings.updateTenantSettings(actor.tenantId, {
        automationsEnabled: true,
      });
    }
    throw new BadRequestException('Client assistant action is not allowlisted');
  }

  private async recentConversations(actor: AssistantActor, limit: number) {
    if (!this.messages) throw assistantContextUnavailable();
    const latestMessageIds = this.messages
      .createQueryBuilder('latestMessage')
      .select('latestMessage.id')
      .distinctOn(['latestMessage.leadId'])
      .leftJoin('latestMessage.lead', 'latestLead')
      .where('latestLead.tenantId = :tenantId', {
        tenantId: actor.tenantId,
      })
      .orderBy('latestMessage.leadId', 'ASC')
      .addOrderBy('latestMessage.createdAt', 'DESC');
    if (!this.canSeeAllWorkspaceRecords(actor)) {
      latestMessageIds.andWhere('latestLead.assignedToUserId = :actorId', {
        actorId: actor.id,
      });
    }
    const query = this.messages
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.lead', 'lead')
      .where(`message.id IN (${latestMessageIds.getQuery()})`)
      .setParameters(latestMessageIds.getParameters());
    const rows = await query
      .orderBy('message.createdAt', 'DESC')
      .take(limit)
      .getMany();
    return rows.map((message) => ({
      leadId: message.lead.id,
      leadName: message.lead.fullName,
      stage: message.lead.stage,
      readiness: message.lead.readinessLevel,
      conversationSummary: message.lead.conversationSummary || null,
      lastMessage: {
        channel: message.channel,
        direction: message.direction,
        body: assistantMessageBody(message.body),
        status: message.status,
        createdAt: message.createdAt,
      },
    }));
  }

  private async upcomingAppointments(
    actor: AssistantActor,
    days: number,
    limit: number,
  ) {
    if (!this.appointments) throw assistantContextUnavailable();
    const now = new Date();
    const through = new Date(now.getTime() + days * 24 * 60 * 60_000);
    const query = this.appointments
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.lead', 'lead')
      .where('appointment.tenantId = :tenantId', {
        tenantId: actor.tenantId,
      })
      .andWhere('appointment.startsAt >= :now', { now })
      .andWhere('appointment.startsAt <= :through', { through })
      .andWhere('appointment.status IN (:...statuses)', {
        statuses: ['scheduled', 'confirmed'],
      });
    if (!this.canSeeAllWorkspaceRecords(actor)) {
      query.andWhere('lead.assignedToUserId = :actorId', {
        actorId: actor.id,
      });
    }
    const rows = await query
      .orderBy('appointment.startsAt', 'ASC')
      .take(limit)
      .getMany();
    return rows.map((appointment) => ({
      appointmentId: appointment.id,
      leadId: appointment.leadId,
      leadName: appointment.lead?.fullName || 'Lead',
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      meetingMode: appointment.meetingMode,
      calendarSource: appointment.calendarSource,
      syncStatus: appointment.syncStatus,
    }));
  }

  private async leadSnapshot(actor: AssistantActor, rawQuery: string) {
    if (!this.leads || !this.messages || !this.appointments) {
      throw assistantContextUnavailable();
    }
    const search = `%${rawQuery.toLowerCase()}%`;
    const phoneDigits = rawQuery.replace(/\D/g, '');
    const query = this.leads
      .createQueryBuilder('lead')
      .where('lead.tenantId = :tenantId', { tenantId: actor.tenantId })
      .andWhere(
        `(LOWER(lead.fullName) LIKE :search
          OR LOWER(COALESCE(lead.email, '')) LIKE :search
          OR (:phoneDigits <> '' AND regexp_replace(COALESCE(lead.phone, ''), '\\D', '', 'g') LIKE :phoneSearch))`,
        { search, phoneDigits, phoneSearch: `%${phoneDigits}%` },
      );
    if (!this.canSeeAllWorkspaceRecords(actor)) {
      query.andWhere('lead.assignedToUserId = :actorId', {
        actorId: actor.id,
      });
    }
    const leads = await query
      .orderBy('lead.lastActivityAt', 'DESC', 'NULLS LAST')
      .addOrderBy('lead.createdAt', 'DESC')
      .take(3)
      .getMany();
    if (!leads.length) return { matches: [] };
    const leadIds = leads.map((lead) => lead.id);
    const [messages, appointments] = await Promise.all([
      this.messages.find({
        where: { leadId: In(leadIds) },
        order: { createdAt: 'DESC' },
        take: Math.min(leadIds.length * 6, 18),
      }),
      this.appointments.find({
        where: { tenantId: actor.tenantId, leadId: In(leadIds) },
        order: { startsAt: 'DESC' },
        take: Math.min(leadIds.length * 3, 9),
      }),
    ]);
    return {
      matches: leads.map((lead) => ({
        leadId: lead.id,
        name: lead.fullName,
        stage: lead.stage,
        temperature: lead.temperature,
        readiness: lead.readinessLevel,
        communicationStatus: lead.communicationStatus,
        summary: lead.conversationSummary || null,
        recommendedNextAction: lead.recommendedNextAction || null,
        recentMessages: messages
          .filter((message) => message.leadId === lead.id)
          .slice(0, 6)
          .reverse()
          .map((message) => ({
            channel: message.channel,
            direction: message.direction,
            body: assistantMessageBody(message.body),
            status: message.status,
            createdAt: message.createdAt,
          })),
        appointments: appointments
          .filter((appointment) => appointment.leadId === lead.id)
          .slice(0, 3)
          .map((appointment) => ({
            startsAt: appointment.startsAt,
            endsAt: appointment.endsAt,
            status: appointment.status,
            meetingMode: appointment.meetingMode,
          })),
      })),
    };
  }

  private canSeeAllWorkspaceRecords(actor: AssistantActor) {
    return Boolean(
      actor.role && hasAtLeastRole(actor.role as UserRole, 'admin'),
    );
  }

  private async executeOperations(name: string, args: Record<string, unknown>) {
    if (name === 'get_exception_summary')
      return this.operations.exceptionSummary();
    if (name === 'recheck_tenant_readiness') {
      return this.onboarding.readiness(requiredUuid(args.tenantId, 'tenantId'));
    }
    if (name === 'retry_durable_job') {
      const id = requiredUuid(args.jobId, 'jobId');
      const job = await this.durableJobs.findOne({ where: { id } });
      if (!job) throw new NotFoundException('Durable job not found');
      if (job.status !== 'failed')
        throw new BadRequestException('Only failed jobs can be retried');
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
      const evidence = requiredString(
        args.recoveryEvidence,
        'recoveryEvidence',
        1_000,
      );
      if (evidence.length < 12)
        throw new BadRequestException('Recovery evidence is too short');
      const task = await this.operationsTasks.findOne({
        where: { id: taskId },
      });
      if (!task) throw new NotFoundException('Operations task not found');
      if (task.relatedEntityType === 'durable_job' && task.relatedEntityId) {
        const job = await this.durableJobs.findOne({
          where: { id: task.relatedEntityId },
        });
        if (!job || job.status !== 'completed') {
          throw new BadRequestException(
            'Related durable job has not recovered',
          );
        }
      }
      return this.operations.updateTask(taskId, {
        status: 'resolved',
        evidenceNote: evidence,
      });
    }
    throw new BadRequestException(
      'Operations assistant action is not allowlisted',
    );
  }

  private recordAudit(
    run: AssistantRun,
    actor: AssistantActor,
    eventType: string,
  ) {
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

  private async recordAuditSafely(
    run: AssistantRun,
    actor: AssistantActor,
    eventType: string,
  ) {
    try {
      await this.recordAudit(run, actor, eventType);
    } catch (error: any) {
      // The run is the source of truth. An unavailable audit sink must be
      // visible to operators, but must not turn a completed provider/tool flow
      // into a red error for the user.
      this.logger.error(
        `Assistant audit write failed for run ${run.id}: ${error?.message || error}`,
      );
    }
  }

  private canRetry(run: AssistantRun) {
    if (!['failed', 'blocked'].includes(run.status) || run.confirmedAt) {
      return false;
    }
    const mutations =
      run.assistantType === 'client' ? CLIENT_MUTATIONS : OPERATIONS_MUTATIONS;
    return !(run.executedActions || []).some(
      (result: any) =>
        result?.status === 'executed' && mutations.has(String(result?.name)),
    );
  }

  private async requestContext(
    assistantType: 'client' | 'operations',
    actor: AssistantActor,
  ) {
    if (assistantType === 'operations') {
      return {
        assistantScope: 'platform_operations',
        authenticatedRole: actor.platformRole || 'staff',
      };
    }
    const [tenant, settings, control] = await Promise.all([
      this.tenants?.findOne({ where: { id: actor.tenantId } }),
      this.tenantSettings?.findOne({ where: { tenantId: actor.tenantId } }),
      this.platformControls?.findOne({ where: { id: 'global' } }),
    ]);
    return {
      assistantScope: 'authenticated_workspace',
      authenticatedRole: actor.role || 'member',
      workspace: {
        name: tenant?.name || 'Client workspace',
        lifecycleStatus: tenant?.lifecycleStatus || 'unknown',
      },
      automation: {
        workspaceEnabled: settings?.automationsEnabled === true,
        globalAutomationsPaused:
          process.env.GLOBAL_AUTOMATIONS_DISABLED === 'true',
        platformAiPaused: control?.paused === true,
      },
    };
  }

  private duplicateRun(run: AssistantRun) {
    if (run.status === 'processing') {
      throw new ConflictException({
        code: 'ASSISTANT_REQUEST_IN_PROGRESS',
        message: 'This assistant request is already being processed.',
      });
    }
    return this.publicRun(run);
  }

  private async contextHistory(
    assistantType: 'client' | 'operations',
    actor: AssistantActor,
  ): Promise<RestrictedAssistantHistoryMessage[]> {
    const rows = await this.runs.find({
      where: {
        tenantId: actor.tenantId,
        actorId: actor.id,
        assistantType,
      },
      order: { createdAt: 'DESC' },
      take: 6,
    });
    const messages: RestrictedAssistantHistoryMessage[] = [];
    for (const row of rows.reverse()) {
      if (!row.promptEncrypted || !row.response || row.status === 'failed')
        continue;
      try {
        messages.push({
          role: 'user',
          content: decryptString(row.promptEncrypted).slice(0, 4_000),
        });
        messages.push({
          role: 'assistant',
          content: row.response.slice(0, 4_000),
        });
      } catch (error: any) {
        this.logger.warn(
          `Assistant history could not be decrypted for run ${row.id}: ${error?.message || error}`,
        );
      }
    }
    return messages;
  }

  private async listHistory(
    assistantType: 'client' | 'operations',
    actor: AssistantActor,
  ) {
    const rows = await this.runs.find({
      where: {
        tenantId: actor.tenantId,
        actorId: actor.id,
        assistantType,
      },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    const items: Array<{
      prompt: string;
      run: Record<string, unknown>;
    }> = [];
    for (const row of rows.reverse()) {
      if (!row.promptEncrypted) continue;
      try {
        items.push({
          prompt: decryptString(row.promptEncrypted).slice(0, 4_000),
          run: this.publicRun(row),
        });
      } catch (error: any) {
        this.logger.warn(
          `Assistant history could not be decrypted for run ${row.id}: ${error?.message || error}`,
        );
      }
    }
    return { items };
  }

  private publicRun(run: AssistantRun) {
    return {
      id: run.id,
      requestId: run.requestId,
      assistantType: run.assistantType,
      status: run.status,
      provider: run.provider,
      model: run.model,
      response: run.response || '',
      results: run.executedActions,
      confirmationRequired:
        run.status === 'confirmation_required'
          ? run.requestedActions
              .filter((item: any) =>
                (run.assistantType === 'client'
                  ? CLIENT_MUTATIONS
                  : OPERATIONS_MUTATIONS
                ).has(item.name),
              )
              .map((item: any) => ({
                name: item.name,
                arguments: safeArguments(item.arguments),
              }))
          : [],
      usage: {
        inputTokens: run.inputUsage,
        outputTokens: run.outputUsage,
        estimatedCostUsd: run.estimatedCostUsd,
        latencyMs: run.latencyMs,
      },
      error: run.errorCode
        ? {
            code: run.errorCode,
            message: run.sanitizedError || 'Assistant request failed',
          }
        : null,
      createdAt: run.createdAt,
    };
  }
}

function parseArguments(value: string) {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new BadRequestException(
      'Assistant action arguments must be a JSON object',
    );
  }
}

function safeArguments(value: unknown) {
  const parsed = parseArguments(String(value || '{}'));
  return Object.fromEntries(
    Object.entries(parsed).map(([key, item]) => [
      key,
      typeof item === 'string' ? item.slice(0, 500) : item,
    ]),
  );
}

function requiredString(value: unknown, label: string, max: number) {
  const result = typeof value === 'string' ? value.trim().slice(0, max) : '';
  if (!result) throw new BadRequestException(`${label} is required`);
  return result;
}

function requiredUuid(value: unknown, label: string) {
  const result = requiredString(value, label, 40);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result,
    )
  ) {
    throw new BadRequestException(`${label} must be a UUID`);
  }
  return result;
}

function objectArgument(value: unknown, label: string) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new BadRequestException(`${label} must be an object`);
  }
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 14);
  return Object.fromEntries(
    entries.map(([key, item]) => [
      key.slice(0, 30),
      String(item).slice(0, 160),
    ]),
  );
}

function boundedIntegerArgument(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function assistantContextUnavailable() {
  return new ServiceUnavailableException({
    code: 'ASSISTANT_CONTEXT_UNAVAILABLE',
    message:
      'Workspace context is temporarily unavailable. Retry this request shortly.',
  });
}

function assistantMessageBody(value: string) {
  return String(value || '')
    .replace(/\n\nUnsubscribe:\s*\{\{unsubscribeUrl\}\}\s*$/i, '')
    .slice(0, 600);
}

function errorCode(error: any, fallback: string) {
  return String(error?.response?.code || error?.code || fallback).slice(0, 80);
}

function errorMessage(error: any) {
  const responseMessage = error?.response?.message;
  return sanitizeOperationalText(
    typeof responseMessage === 'string'
      ? responseMessage
      : error?.message || error,
    1_000,
  );
}
