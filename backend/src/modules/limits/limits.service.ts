import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { operationalEvent } from '../../common/operational-log';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationsService } from '../operations/operations.service';
import { OnboardingRecord } from '../onboarding/onboarding-record.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Tenant } from '../tenants/tenant.entity';
import { UsageBucket, UsageMetric, UsageWindow } from './usage-bucket.entity';
import { UsagePolicy, UsagePolicyScope } from './usage-policy.entity';
import { UsageReservation } from './usage-reservation.entity';

export type LimitCheckResult =
  | { ok: true; duplicate?: boolean; warnings?: string[] }
  | {
      ok: false;
      code: 'PLAN_BLOCKED' | 'LIMIT_LEADS' | 'USAGE_LIMIT' | 'COST_LIMIT';
      message: string;
      scope?: UsagePolicyScope;
      metric?: UsageMetric;
    };

export type UsagePolicyInput = {
  maxSmsPerHour: number;
  maxSmsPerDay: number;
  maxEmailsPerHour: number;
  maxEmailsPerDay: number;
  maxAiCallsPerDay: number;
  maxLeadsPerHour: number;
  warningPercentage: number;
  warningCostThresholdUsd: number | string;
  hardCostThresholdUsd: number | string;
  enabled: boolean;
};

export const PLATFORM_SCOPE_ID = 'platform';

export function isHardLimitExceeded(
  current: number,
  requested: number,
  limit: number,
) {
  return current + requested > limit;
}

export function defaultTenantUsagePolicy(scopeId: string): Partial<UsagePolicy> {
  return {
    scopeType: 'tenant',
    scopeId,
    maxSmsPerHour: 60,
    maxSmsPerDay: 500,
    maxEmailsPerHour: 120,
    maxEmailsPerDay: 1_000,
    maxAiCallsPerDay: 200,
    maxLeadsPerHour: 100,
    warningPercentage: 80,
    warningCostThresholdUsd: '20.0000',
    hardCostThresholdUsd: '30.0000',
    enabled: true,
  };
}

export function defaultPlatformUsagePolicy(): Partial<UsagePolicy> {
  return {
    scopeType: 'platform',
    scopeId: PLATFORM_SCOPE_ID,
    maxSmsPerHour: 600,
    maxSmsPerDay: 5_000,
    maxEmailsPerHour: 1_200,
    maxEmailsPerDay: 10_000,
    maxAiCallsPerDay: 2_000,
    maxLeadsPerHour: 1_000,
    warningPercentage: 80,
    warningCostThresholdUsd: '200.0000',
    hardCostThresholdUsd: '250.0000',
    enabled: true,
  };
}

type ScopeEvaluation = {
  policy: UsagePolicy;
  hourQuantity: number;
  dayQuantity: number;
  dayCost: number;
  hourLimit: number | null;
  dayLimit: number | null;
};

@Injectable()
export class LimitsService {
  private readonly logger = new Logger(LimitsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(UsagePolicy)
    private readonly policies: Repository<UsagePolicy>,
    private readonly operations: OperationsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  estimatedCost(metric: UsageMetric) {
    const envKey: Record<UsageMetric, string> = {
      sms: 'ESTIMATED_SMS_COST_USD',
      email: 'ESTIMATED_EMAIL_COST_USD',
      ai: 'ESTIMATED_AI_CALL_COST_USD',
      lead: 'ESTIMATED_LEAD_INGESTION_COST_USD',
    };
    const fallback: Record<UsageMetric, number> = {
      sms: 0.01,
      email: 0.001,
      ai: 0.02,
      lead: 0,
    };
    const configured = Number(process.env[envKey[metric]]);
    return Number.isFinite(configured) && configured >= 0
      ? configured
      : fallback[metric];
  }

  async getTenantPolicy(tenantId: string) {
    return this.policies.findOne({
      where: { scopeType: 'tenant', scopeId: tenantId },
    });
  }

  async getPlatformPolicy() {
    return this.policies.findOne({
      where: { scopeType: 'platform', scopeId: PLATFORM_SCOPE_ID },
    });
  }

  async ensureTenantPolicy(tenantId: string) {
    const existing = await this.getTenantPolicy(tenantId);
    if (existing) return existing;
    try {
      return await this.policies.save(
        this.policies.create(defaultTenantUsagePolicy(tenantId)),
      );
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      return this.policies.findOneOrFail({
        where: { scopeType: 'tenant', scopeId: tenantId },
      });
    }
  }

  async updateTenantPolicy(tenantId: string, input: UsagePolicyInput) {
    const policy = await this.ensureTenantPolicy(tenantId);
    const before = this.publicPolicy(policy);
    Object.assign(policy, this.validatePolicy(input));
    const saved = await this.policies.save(policy);
    await this.audit.recordSystemEvent({
      tenantId,
      eventType: 'usage_policy.changed',
      resourceType: 'usage_policy',
      resourceId: saved.id,
      beforeState: before,
      afterState: this.publicPolicy(saved),
    });
    return this.publicPolicy(saved);
  }

  async updatePlatformPolicy(input: UsagePolicyInput) {
    let policy = await this.getPlatformPolicy();
    if (!policy) {
      policy = this.policies.create(defaultPlatformUsagePolicy());
    }
    Object.assign(policy, this.validatePolicy(input));
    return this.publicPolicy(await this.policies.save(policy));
  }

  publicPolicy(policy: UsagePolicy) {
    return {
      id: policy.id,
      scopeType: policy.scopeType,
      scopeId: policy.scopeId,
      maxSmsPerHour: policy.maxSmsPerHour,
      maxSmsPerDay: policy.maxSmsPerDay,
      maxEmailsPerHour: policy.maxEmailsPerHour,
      maxEmailsPerDay: policy.maxEmailsPerDay,
      maxAiCallsPerDay: policy.maxAiCallsPerDay,
      maxLeadsPerHour: policy.maxLeadsPerHour,
      warningPercentage: policy.warningPercentage,
      warningCostThresholdUsd: Number(policy.warningCostThresholdUsd),
      hardCostThresholdUsd: Number(policy.hardCostThresholdUsd),
      enabled: policy.enabled,
      updatedAt: policy.updatedAt,
    };
  }

  async canCreateLead(tenantId: string): Promise<LimitCheckResult> {
    const tenant = await this.dataSource.getRepository(Tenant).findOne({
      where: { id: tenantId },
    });
    if (!tenant) {
      return { ok: false, code: 'PLAN_BLOCKED', message: 'Tenant not found' };
    }
    if (['canceled', 'unpaid', 'paused'].includes(tenant.status)) {
      return {
        ok: false,
        code: 'PLAN_BLOCKED',
        message: 'The subscription is not active. Update billing to continue.',
      };
    }
    return { ok: true };
  }

  async tenantUsageReport(tenantId: string, days = 30) {
    const safeDays = Math.max(1, Math.min(366, Math.floor(days)));
    const since = new Date(Date.now() - safeDays * 86_400_000);
    const [tenant, rows] = await Promise.all([
      this.dataSource.getRepository(Tenant).findOne({ where: { id: tenantId } }),
      this.dataSource
        .getRepository(UsageReservation)
        .createQueryBuilder('usage')
        .select('usage.metric', 'metric')
        .addSelect('SUM(usage.quantity)', 'quantity')
        .addSelect('SUM(usage.estimatedCostUsd)', 'estimatedCostUsd')
        .where('usage.tenantId = :tenantId', { tenantId })
        .andWhere('usage.createdAt >= :since', { since })
        .groupBy('usage.metric')
        .getRawMany(),
    ]);
    if (!tenant) throw new BadRequestException('Tenant not found');
    const usage = Object.fromEntries(
      rows.map((row) => [
        String(row.metric),
        {
          quantity: Number(row.quantity || 0),
          estimatedCostUsd: Number(row.estimatedCostUsd || 0),
        },
      ]),
    );
    const estimatedProviderCostUsd = Object.values(usage).reduce(
      (sum, item: any) => sum + Number(item.estimatedCostUsd || 0),
      0,
    );
    const recurringRevenueUsd = Number(tenant.stripeUnitAmount || 0) / 100;
    const normalizedRevenueUsd =
      tenant.billingInterval === 'year' ? recurringRevenueUsd / 12 : recurringRevenueUsd;
    return {
      tenantId,
      periodDays: safeDays,
      since,
      usage,
      estimatedProviderCostUsd,
      normalizedMonthlyRevenueUsd: normalizedRevenueUsd,
      estimatedContributionMarginUsd: normalizedRevenueUsd - estimatedProviderCostUsd,
      currency: tenant.stripeCurrency || 'usd',
      note: 'Provider costs are estimates from configured unit costs; reconcile against provider invoices.',
    };
  }

  async reserveUsage(input: {
    tenantId: string;
    metric: UsageMetric;
    idempotencyKey: string;
    quantity?: number;
    estimatedCostUsd?: number;
  }): Promise<LimitCheckResult> {
    const quantity = Math.max(1, Math.floor(input.quantity || 1));
    const cost = Math.max(
      0,
      Number(input.estimatedCostUsd ?? this.estimatedCost(input.metric)) || 0,
    );
    const now = new Date();
    const hourStart = new Date(now);
    hourStart.setUTCMinutes(0, 0, 0);
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const decision = await this.dataSource.transaction(async (manager) => {
      const reservations = manager.getRepository(UsageReservation);
      if (
        await reservations.findOne({
          where: { idempotencyKey: input.idempotencyKey },
        })
      ) {
        return { ok: true, duplicate: true } as LimitCheckResult;
      }

      const policies = manager.getRepository(UsagePolicy);
      const scopes = await Promise.all([
        policies.findOne({
          where: { scopeType: 'tenant', scopeId: input.tenantId },
        }),
        policies.findOne({
          where: { scopeType: 'platform', scopeId: PLATFORM_SCOPE_ID },
        }),
      ]);
      if (!scopes[0] || !scopes[1]) {
        return {
          ok: false,
          code: 'USAGE_LIMIT',
          message: 'Required usage safety limits are not configured.',
          scope: !scopes[0] ? 'tenant' : 'platform',
          metric: input.metric,
        } as LimitCheckResult;
      }
      const activePolicies = scopes as [UsagePolicy, UsagePolicy];

      for (const policy of activePolicies) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `usage:${policy.scopeType}:${policy.scopeId}`,
        ]);
      }
      if (
        await reservations.findOne({
          where: { idempotencyKey: input.idempotencyKey },
        })
      ) {
        return { ok: true, duplicate: true } as LimitCheckResult;
      }
      const evaluations = await Promise.all(
        activePolicies.map((policy) =>
          this.evaluateScope(
            manager,
            policy,
            input.metric,
            hourStart,
            dayStart,
          ),
        ),
      );
      for (const evaluation of evaluations) {
        if (!evaluation.policy.enabled) continue;
        const hardCost = Number(evaluation.policy.hardCostThresholdUsd);
        if (hardCost > 0 && isHardLimitExceeded(evaluation.dayCost, cost, hardCost)) {
          return {
            ok: false,
            code: 'COST_LIMIT',
            message: `${evaluation.policy.scopeType} daily cost safety limit reached.`,
            scope: evaluation.policy.scopeType,
            metric: input.metric,
          } as LimitCheckResult;
        }
        if (
          (evaluation.hourLimit !== null &&
            isHardLimitExceeded(evaluation.hourQuantity, quantity, evaluation.hourLimit)) ||
          (evaluation.dayLimit !== null &&
            isHardLimitExceeded(evaluation.dayQuantity, quantity, evaluation.dayLimit))
        ) {
          return {
            ok: false,
            code: input.metric === 'lead' ? 'LIMIT_LEADS' : 'USAGE_LIMIT',
            message: `${evaluation.policy.scopeType} ${input.metric} safety limit reached.`,
            scope: evaluation.policy.scopeType,
            metric: input.metric,
          } as LimitCheckResult;
        }
      }

      for (const evaluation of evaluations) {
        await this.incrementBucket(
          manager,
          evaluation.policy,
          input.metric,
          'hour',
          hourStart,
          quantity,
          cost,
        );
        await this.incrementBucket(
          manager,
          evaluation.policy,
          input.metric,
          'day',
          dayStart,
          quantity,
          cost,
        );
      }
      await reservations.save(
        reservations.create({
          tenantId: input.tenantId,
          idempotencyKey: input.idempotencyKey.slice(0, 255),
          metric: input.metric,
          quantity,
          estimatedCostUsd: cost.toFixed(4),
        }),
      );

      const warnings = evaluations.flatMap((evaluation) =>
        this.warningReasons(evaluation, quantity, cost),
      );
      return { ok: true, warnings } as LimitCheckResult;
    });

    if (!decision.ok) {
      await this.pauseAffectedAutomation(input.tenantId, decision);
    } else if (decision.warnings?.length) {
      await this.warnOwner(input.tenantId, input.metric, decision.warnings, now);
    }
    return decision;
  }

  private async evaluateScope(
    manager: EntityManager,
    policy: UsagePolicy,
    metric: UsageMetric,
    hourStart: Date,
    dayStart: Date,
  ): Promise<ScopeEvaluation> {
    const buckets = manager.getRepository(UsageBucket);
    const [hour, day, costRow] = await Promise.all([
      buckets.findOne({
        where: {
          scopeType: policy.scopeType,
          scopeId: policy.scopeId,
          metric,
          windowType: 'hour',
          windowStart: hourStart,
        },
      }),
      buckets.findOne({
        where: {
          scopeType: policy.scopeType,
          scopeId: policy.scopeId,
          metric,
          windowType: 'day',
          windowStart: dayStart,
        },
      }),
      buckets
        .createQueryBuilder('bucket')
        .select('COALESCE(SUM(bucket.estimatedCostUsd), 0)', 'cost')
        .where('bucket.scopeType = :scopeType', {
          scopeType: policy.scopeType,
        })
        .andWhere('bucket.scopeId = :scopeId', { scopeId: policy.scopeId })
        .andWhere('bucket.windowType = :windowType', { windowType: 'day' })
        .andWhere('bucket.windowStart = :windowStart', {
          windowStart: dayStart,
        })
        .getRawOne(),
    ]);
    const limits = this.metricLimits(policy, metric);
    return {
      policy,
      hourQuantity: Number(hour?.quantity || 0),
      dayQuantity: Number(day?.quantity || 0),
      dayCost: Number(costRow?.cost || 0),
      ...limits,
    };
  }

  private metricLimits(policy: UsagePolicy, metric: UsageMetric) {
    if (metric === 'sms') {
      return {
        hourLimit: policy.maxSmsPerHour,
        dayLimit: policy.maxSmsPerDay,
      };
    }
    if (metric === 'email') {
      return {
        hourLimit: policy.maxEmailsPerHour,
        dayLimit: policy.maxEmailsPerDay,
      };
    }
    if (metric === 'ai') {
      return { hourLimit: null, dayLimit: policy.maxAiCallsPerDay };
    }
    return { hourLimit: policy.maxLeadsPerHour, dayLimit: null };
  }

  private async incrementBucket(
    manager: EntityManager,
    policy: UsagePolicy,
    metric: UsageMetric,
    windowType: UsageWindow,
    windowStart: Date,
    quantity: number,
    cost: number,
  ) {
    await manager.query(
      `INSERT INTO usage_buckets
        (id, scope_type, scope_id, metric, window_type, window_start, quantity, estimated_cost_usd, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now(), now())
       ON CONFLICT (scope_type, scope_id, metric, window_type, window_start)
       DO UPDATE SET
         quantity = usage_buckets.quantity + EXCLUDED.quantity,
         estimated_cost_usd = usage_buckets.estimated_cost_usd + EXCLUDED.estimated_cost_usd,
         updated_at = now()`,
      [
        policy.scopeType,
        policy.scopeId,
        metric,
        windowType,
        windowStart,
        quantity,
        cost,
      ],
    );
  }

  private warningReasons(
    evaluation: ScopeEvaluation,
    quantity: number,
    cost: number,
  ) {
    if (!evaluation.policy.enabled) return [];
    const warningRatio = evaluation.policy.warningPercentage / 100;
    const reasons: string[] = [];
    if (
      evaluation.hourLimit &&
      evaluation.hourQuantity + quantity >= evaluation.hourLimit * warningRatio
    ) {
      reasons.push(
        `${evaluation.policy.scopeType} hourly ${evaluation.policy.scopeId} ${evaluation.policy.warningPercentage}% ${evaluation.policy.scopeType === 'platform' ? 'platform ' : ''}limit`,
      );
    }
    if (
      evaluation.dayLimit &&
      evaluation.dayQuantity + quantity >= evaluation.dayLimit * warningRatio
    ) {
      reasons.push(
        `${evaluation.policy.scopeType} daily ${evaluation.policy.scopeId} ${evaluation.policy.warningPercentage}% limit`,
      );
    }
    const warningCost = Number(evaluation.policy.warningCostThresholdUsd);
    if (warningCost > 0 && evaluation.dayCost + cost >= warningCost) {
      reasons.push(`${evaluation.policy.scopeType} daily cost warning threshold`);
    }
    return reasons;
  }

  private async warnOwner(
    tenantId: string,
    metric: UsageMetric,
    reasons: string[],
    now: Date,
  ) {
    await this.notifications.createForPlatform({
      eventType: 'usage.warning_threshold',
      category: 'system',
      severity: 'warning',
      audience: 'super_admin',
      title: 'Usage is approaching a safety limit',
      message: `${metric.toUpperCase()}: ${[...new Set(reasons)].join('; ')}.`,
      deduplicationKey: `usage-warning:${tenantId}:${metric}:${now.toISOString().slice(0, 13)}`,
      incidentKey: `usage:${tenantId}:${metric}`,
      actionUrl: `/admin/dashboard?view=clients&tenantId=${tenantId}&clientTab=setup`,
      entityType: 'tenant',
      entityId: tenantId,
    });
  }

  private async pauseAffectedAutomation(
    tenantId: string,
    decision: Exclude<LimitCheckResult, { ok: true }>,
  ) {
    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `service-control:${tenantId}`,
      ]);
      const settingsRepo = manager.getRepository(TenantSettings);
      let settings = await settingsRepo.findOne({ where: { tenantId } });
      if (!settings) settings = settingsRepo.create({ tenantId });
      settings.automationsEnabled = false;
      await settingsRepo.save(settings);

      const tenants = manager.getRepository(Tenant);
      const tenant = await tenants.findOne({ where: { id: tenantId } });
      if (tenant && tenant.lifecycleStatus === 'ACTIVE') {
        tenant.lifecycleStatus = 'PAUSED';
        tenant.servicePausedAt = new Date();
        await tenants.save(tenant);
      }
      await manager.getRepository(OnboardingRecord).update(
        { tenantId },
        {
          activationStatus: 'paused',
          blockedReason: decision.message,
        },
      );
    });

    await this.operations.createTask({
      tenantId,
      category: 'usage_limit',
      title: 'Automation paused by a usage safety limit',
      description: `${decision.message} Review the tenant and platform usage counters before resuming automation.`,
      priority: 'critical',
      relatedEntityType: 'tenant',
      relatedEntityId: tenantId,
      dedupeOpen: true,
    });
    await this.audit.recordSystemEvent({
      tenantId,
      eventType: 'automation.paused_usage_limit',
      resourceType: 'tenant',
      resourceId: tenantId,
      afterState: {
        automationsEnabled: false,
        code: decision.code,
        scope: decision.scope || null,
        metric: decision.metric || null,
      },
    });
    this.logger.error(
      operationalEvent('usage_hard_limit_reached', {
        tenantId,
        code: decision.code,
        scope: decision.scope,
        metric: decision.metric,
      }),
    );
  }

  private validatePolicy(input: UsagePolicyInput): UsagePolicyInput {
    const integers = [
      input.maxSmsPerHour,
      input.maxSmsPerDay,
      input.maxEmailsPerHour,
      input.maxEmailsPerDay,
      input.maxAiCallsPerDay,
      input.maxLeadsPerHour,
    ];
    if (integers.some((value) => !Number.isInteger(value) || value < 1)) {
      throw new BadRequestException('Usage limits must be positive integers');
    }
    if (
      !Number.isInteger(input.warningPercentage) ||
      input.warningPercentage < 50 ||
      input.warningPercentage > 99
    ) {
      throw new BadRequestException('Warning percentage must be between 50 and 99');
    }
    const warningCost = Number(input.warningCostThresholdUsd);
    const hardCost = Number(input.hardCostThresholdUsd);
    if (
      !Number.isFinite(warningCost) ||
      !Number.isFinite(hardCost) ||
      warningCost < 0 ||
      hardCost <= 0 ||
      warningCost >= hardCost
    ) {
      throw new BadRequestException(
        'Cost thresholds must be valid and the warning threshold must be below the hard threshold',
      );
    }
    return {
      ...input,
      warningCostThresholdUsd: warningCost.toFixed(4),
      hardCostThresholdUsd: hardCost.toFixed(4),
    };
  }
}
