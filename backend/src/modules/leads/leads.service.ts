import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { IntakeLeadDto } from './dto/intake-lead.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';

import { Lead } from './lead.entity';
import { LeadEvent } from './lead-event.entity';

import { TenantsService } from '../tenants/tenants.service';
import { MessagingService } from '../messaging/messaging.service';
import { SequencesService } from '../sequences/sequences.service';
import { UserRole, hasAtLeastRole } from '../../common/rbac';
import { User } from '../users/user.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Team } from '../teams/team.entity';
import { RoutingService } from '../routing/routing.service';
import { ComplianceService } from '../compliance/compliance.service';
import { LeadStageEvent } from './lead-stage-event.entity';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepository: Repository<Lead>,

    @InjectRepository(LeadEvent)
    private readonly leadEventsRepository: Repository<LeadEvent>,

    @InjectRepository(LeadStageEvent)
    private readonly leadStageEventsRepository: Repository<LeadStageEvent>,

    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,

    @InjectRepository(TenantSettings)
    private readonly tenantSettingsRepository: Repository<TenantSettings>,

    @InjectRepository(Team)
    private readonly teamsRepository: Repository<Team>,

    private readonly tenantsService: TenantsService,
    private readonly messagingService: MessagingService,
    private readonly sequencesService: SequencesService,
    private readonly routingService: RoutingService,
    private readonly complianceService: ComplianceService,
  ) {}

  private async applyRoutingRules(lead: Lead, plan: string) {
    if (!['teams', 'enterprise'].includes(plan)) return lead;
    const assignment = await this.routingService.routeLead(lead);
    if (!assignment) return lead;
    lead.assignedToUserId = assignment.assignedToUserId;
    lead.assignedToTeamId = assignment.assignedToTeamId;
    lead.assignedTo = assignment.assignedToLabel;
    const saved = await this.leadsRepository.save(lead);
    await this.logLeadEvent(saved, 'routed', assignment);
    return saved;
  }

  // -------------------------
  // Helpers
  // -------------------------

  private normalizePhone(phone?: string): string | undefined {
    if (!phone) return undefined;
    let digits = String(phone).replace(/\D/g, '');
    if (digits.length === 10) digits = `1${digits}`;
    return digits || undefined;
  }

  private normalizeEmail(email?: string): string | undefined {
    if (!email) return undefined;
    const v = String(email).trim().toLowerCase();
    return v || undefined;
  }

  private normalizeName(name?: string): string {
    return String(name || '').trim();
  }

  private normalizeString(v: any): string | undefined {
    if (v === null || v === undefined) return undefined;
    const s = String(v).trim();
    return s || undefined;
  }

  private normalizeStringArray(v: any): string[] | undefined {
    if (v === null || v === undefined) return undefined;
    if (!Array.isArray(v)) return undefined;
    const arr = v
      .filter(Boolean)
      .map((x) => String(x).trim())
      .filter(Boolean);
    return arr.length ? arr : undefined;
  }

  private clampScore(v: any): number | undefined {
    if (v === null || v === undefined) return undefined;
    const n = Number(v);
    if (Number.isNaN(n)) return undefined;
    return Math.max(0, Math.min(100, Math.floor(n)));
  }


  private async getTenantSettings(tenantId: string): Promise<TenantSettings | null> {
    try {
      return await this.tenantSettingsRepository.findOne({ where: { tenantId } as any });
    } catch {
      return null;
    }
  }

  private async pickRoundRobinAssignee(tenantId: string, teamId: string | null | undefined): Promise<string | null> {
    // Eligible users: active users in tenant with role agent/admin/owner
    const qb = this.usersRepository
      .createQueryBuilder("u")
      .where("u.tenantId = :tenantId", { tenantId })
      .andWhere("u.isActive = true")
      .orderBy("u.createdAt", "ASC");

    if (teamId) {
      qb.andWhere("u.teamId = :teamId", { teamId });
    }

    const users = await qb.getMany();
    const eligible = users.filter((u: any) => {
      const r = String((u as any).role || "agent").toLowerCase();
      return r === "owner" || r === "admin" || r === "agent" || r === "tc";
    });

    if (!eligible.length) return null;

    const settings = await this.getTenantSettings(tenantId);
    const last = settings?.roundRobinLastUserId || null;

    const idx = last ? eligible.findIndex((u: any) => (u as any).id === last) : -1;
    const next = eligible[(idx + 1 + eligible.length) % eligible.length];

    // Persist last assigned
    if (settings) {
      (settings as any).roundRobinLastUserId = (next as any).id;
      await this.tenantSettingsRepository.save(settings);
    }

    return (next as any).id;
  }

  private async requireTenant(tenantId?: string) {
    if (!tenantId) throw new Error('Missing tenant');
    const tenant = await this.tenantsService.findById(tenantId);
    if (!tenant) throw new Error('Invalid tenant');
    return tenant;
  }

  private async findDuplicateLead(params: {
    tenantId: string;
    email?: string;
    phone?: string;
  }): Promise<Lead | null> {
    const where: Array<Record<string, any>> = [];
    if (params.email) where.push({ tenantId: params.tenantId, email: params.email });
    if (params.phone) where.push({ tenantId: params.tenantId, phone: params.phone });
    if (where.length === 0) return null;

    // Passing array for "where" => OR conditions
    return (await this.leadsRepository.findOne({ where })) || null;
  }

  // -------------------------
  // Events
  // -------------------------

  async logLeadEvent(lead: Lead, eventType: string, metadata?: Record<string, any>) {
    const event = this.leadEventsRepository.create({
      lead,
      eventType,
      metadata,
    });
    return this.leadEventsRepository.save(event);
  }

  // -------------------------
  // Public intake (webhook/forms/FB)
  // -------------------------

  async intake(tenantId: string, payload: IntakeLeadDto): Promise<Lead> {
    const tenant = await this.requireTenant(tenantId);

    const fullName = this.normalizeName(payload.fullName ?? undefined);
    if (!fullName) throw new Error('fullName is required');

    const email = this.normalizeEmail(payload.email ?? undefined);
    const phone = this.normalizePhone(payload.phone ?? undefined);

    const existing = await this.findDuplicateLead({ tenantId: tenant.id, email, phone });
    if (existing) {
      this.logger.log(`Deduped lead ${existing.id}`);
      await this.logLeadEvent(existing, 'deduped', payload as any);
      await this.complianceService.recordLeadConsent(tenant.id, existing.id, payload.consent);
      return existing;
    }

    // Teams/Brokerages: lead routing (round robin)
    const settings = await this.getTenantSettings(tenant.id);
    const shouldRoute = Boolean((settings as any)?.roundRobinEnabled) && ['teams','enterprise'].includes(String(tenant.plan));
    const teamId = (settings as any)?.roundRobinTeamId || null;
    const assigneeUserId = shouldRoute ? await this.pickRoundRobinAssignee(tenant.id, teamId) : null;

    const lead = this.leadsRepository.create({
      tenant,
      tenantId: tenant.id,

      fullName,
      email,
      phone,

      source: this.normalizeString(payload.source) || 'Website',
      location: this.normalizeString(payload.location),
      propertyInterest: this.normalizeString(payload.propertyInterest),

      leadType: (payload.leadType ?? 'buyer') as any,
      temperature: (payload.temperature ?? 'warm') as any,
      stage: (payload.stage ?? 'new') as any,

      budgetRange: this.normalizeString((payload as any).budgetRange),
      estimatedPrice: this.normalizeString((payload as any).estimatedPrice),
      preferredAreas: this.normalizeStringArray((payload as any).preferredAreas),

      notes: this.normalizeString((payload as any).notes),

      assignedToUserId: assigneeUserId,
      assignedToTeamId: teamId,

      score: this.clampScore((payload as any).score),

      lastActivityAt: new Date(),
    } as Partial<Lead>);

    let saved = await this.leadsRepository.save(lead as Lead);
    saved = await this.applyRoutingRules(saved, String(tenant.plan));

    await this.logLeadEvent(saved, 'created', payload as any);
    await this.recordStageChange(saved, null, saved.stage, undefined, 'intake');
    await this.complianceService.recordLeadConsent(tenant.id, saved.id, payload.consent);

    // Automation hooks
    await this.messagingService.queueInstantResponses(saved);
    await this.sequencesService.startForLead(saved);

    return saved;
  }

  // -------------------------
  // Protected: agent manually creates a lead
  // -------------------------

  async createLead(
    tenantId: string | undefined,
    payload: CreateLeadDto,
    ctx?: { userId?: string; role?: UserRole },
  ): Promise<Lead> {
    const tenant = await this.requireTenant(tenantId);

    const fullName = this.normalizeName(payload.fullName ?? undefined);
    if (!fullName) throw new Error('fullName is required');

    const email = this.normalizeEmail(payload.email ?? undefined);
    const phone = this.normalizePhone(payload.phone ?? undefined);

    const existing = await this.findDuplicateLead({ tenantId: tenant.id, email, phone });
    if (existing) {
      await this.logLeadEvent(existing, 'deduped', payload as any);
      await this.complianceService.recordLeadConsent(
        tenant.id,
        existing.id,
        payload.consent,
        ctx?.userId,
      );
      return existing;
    }


    let teamId = this.normalizeString((payload as any).assignedToTeamId ?? undefined) || null;
    let assigneeUserId = this.normalizeString((payload as any).assignedToUserId ?? undefined) || null;

    const canAssign = ctx?.role ? hasAtLeastRole(ctx.role, 'admin') : false;
    if (!canAssign && ctx?.userId) {
      const currentUser = await this.usersRepository.findOne({ where: { id: ctx.userId, tenantId: tenant.id, isActive: true } });
      assigneeUserId = currentUser?.id || null;
      teamId = currentUser?.teamId || null;
    }

    if (canAssign && assigneeUserId) {
      const assignee = await this.usersRepository.findOne({ where: { id: assigneeUserId, tenantId: tenant.id, isActive: true } });
      if (!assignee) throw new ForbiddenException('Assignee must be an active user in this tenant');
    }
    if (canAssign && teamId) {
      const team = await this.teamsRepository.findOne({ where: { id: teamId, tenantId: tenant.id } });
      if (!team) throw new ForbiddenException('Team must belong to this tenant');
    }

    // Teams/Enterprise: if no manual assignee, apply round robin routing when enabled.
    if (!assigneeUserId && ['teams', 'enterprise'].includes(String(tenant.plan))) {
      const settings = await this.getTenantSettings(tenant.id);
      const shouldRoute = Boolean((settings as any)?.roundRobinEnabled);
      const rrTeamId = (settings as any)?.roundRobinTeamId || null;
      if (shouldRoute) {
        if (!teamId) teamId = rrTeamId;
        assigneeUserId = await this.pickRoundRobinAssignee(tenant.id, teamId);
      }
    }

    const lead = this.leadsRepository.create({
      tenant,
      tenantId: tenant.id,

      fullName,
      email,
      phone,

      source: this.normalizeString(payload.source) || 'Manual',
      location: this.normalizeString(payload.location),
      propertyInterest: this.normalizeString(payload.propertyInterest),

      leadType: (payload.leadType ?? 'buyer') as any,
      temperature: (payload.temperature ?? 'warm') as any,
      stage: (payload.stage ?? 'new') as any,

      budgetRange: this.normalizeString((payload as any).budgetRange),
      estimatedPrice: this.normalizeString((payload as any).estimatedPrice),
      preferredAreas: this.normalizeStringArray((payload as any).preferredAreas),

      notes: this.normalizeString((payload as any).notes),

      assignedTo: this.normalizeString((payload as any).assignedTo),
      assignedToUserId: assigneeUserId,
      assignedToTeamId: teamId,
      score: this.clampScore((payload as any).score),
      nextFollowUpAt: (payload as any).nextFollowUpAt ? new Date((payload as any).nextFollowUpAt) : undefined,

      lastActivityAt: new Date(),
    } as Partial<Lead>);

    let saved = await this.leadsRepository.save(lead as Lead);
    if (!assigneeUserId) saved = await this.applyRoutingRules(saved, String(tenant.plan));
    await this.logLeadEvent(saved, 'created', payload as any);
    await this.recordStageChange(saved, null, saved.stage, ctx?.userId, 'manual_create');
    await this.complianceService.recordLeadConsent(
      tenant.id,
      saved.id,
      payload.consent,
      ctx?.userId,
    );

    const trigger = (payload as any).triggerAutomation !== false;
    if (trigger) {
      await this.messagingService.queueInstantResponses(saved);
      await this.sequencesService.startForLead(saved);
    }

    return saved;
  }

  // -------------------------
  // Protected: agent updates lead
  // -------------------------

  async updateLead(tenantId: string | undefined, id: string, payload: UpdateLeadDto, ctx?: { userId?: string; role?: UserRole }): Promise<Lead> {
    if (!tenantId) throw new Error('Missing tenant');

    const lead = await this.leadsRepository.findOne({ where: { id, tenantId } });
    if (!lead) throw new NotFoundException('Lead not found');

    const canSeeAll = ctx?.role ? hasAtLeastRole(ctx.role, 'admin') : true;
    if (!canSeeAll && lead.assignedToUserId !== ctx?.userId) {
      throw new ForbiddenException('Lead is not assigned to this user');
    }

    const previousStage = lead.stage;

    if (payload.fullName !== undefined) {
      const v = this.normalizeName(payload.fullName ?? undefined);
      if (v) lead.fullName = v;
    }

    if (payload.email !== undefined) {
      lead.email = payload.email === null ? null as any : (this.normalizeEmail(payload.email ?? undefined) as any);
    }
    if (payload.phone !== undefined) {
      lead.phone = payload.phone === null ? null as any : (this.normalizePhone(payload.phone ?? undefined) as any);
    }

    if ((payload as any).source !== undefined) {
      if ((payload as any).source === null) lead.source = null as any;
      else lead.source = this.normalizeString((payload as any).source ?? undefined) as any;
    }
    if ((payload as any).location !== undefined) {
      if ((payload as any).location === null) lead.location = null as any;
      else lead.location = this.normalizeString((payload as any).location ?? undefined) as any;
    }
    if ((payload as any).propertyInterest !== undefined) {
      if ((payload as any).propertyInterest === null) lead.propertyInterest = null as any;
      else lead.propertyInterest = this.normalizeString((payload as any).propertyInterest ?? undefined) as any;
    }

    if (payload.leadType !== undefined) lead.leadType = payload.leadType as any;
    if (payload.temperature !== undefined) lead.temperature = payload.temperature as any;
    if (payload.stage !== undefined) lead.stage = payload.stage as any;

    if ((payload as any).budgetRange !== undefined) lead.budgetRange = this.normalizeString((payload as any).budgetRange);
    if ((payload as any).estimatedPrice !== undefined) lead.estimatedPrice = this.normalizeString((payload as any).estimatedPrice);
    if ((payload as any).preferredAreas !== undefined) lead.preferredAreas = this.normalizeStringArray((payload as any).preferredAreas);

    if ((payload as any).notes !== undefined) lead.notes = this.normalizeString((payload as any).notes);
    if ((payload as any).assignedTo !== undefined) lead.assignedTo = this.normalizeString((payload as any).assignedTo);

    if (payload.score !== undefined) {
      const sc = this.clampScore(payload.score);
      if (sc !== undefined) lead.score = sc;
    }

    if ((payload as any).nextFollowUpAt !== undefined) {
      lead.nextFollowUpAt = (payload as any).nextFollowUpAt ? new Date((payload as any).nextFollowUpAt) : undefined;
    }

    lead.lastActivityAt = new Date();

    const saved = await this.leadsRepository.save(lead);
    await this.logLeadEvent(saved, 'updated', payload as any);
    if (saved.stage !== previousStage) {
      await this.recordStageChange(
        saved,
        previousStage,
        saved.stage,
        ctx?.userId,
        'lead_update',
      );
    }
    return saved;
  }

  private recordStageChange(
    lead: Lead,
    previousStage: string | null,
    newStage: string,
    changedByUserId?: string,
    changeSource = 'application',
  ) {
    return this.leadStageEventsRepository.save(
      this.leadStageEventsRepository.create({
        tenantId: lead.tenantId,
        leadId: lead.id,
        previousStage,
        newStage,
        changedByUserId: changedByUserId || null,
        changeSource,
      }),
    );
  }

  // -------------------------
  // Protected: sample leads for demo/onboarding
  // -------------------------

  async createSampleLeads(tenantId: string | undefined): Promise<Lead[]> {
    const tenant = await this.requireTenant(tenantId);

    const now = Date.now();

    const samples: Array<Partial<Lead>> = [
      {
        fullName: 'Ava Johnson',
        leadType: 'buyer' as any,
        stage: 'new' as any,
        temperature: 'warm' as any,
        score: 58,
        source: 'Facebook',
        location: 'Brooklyn',
        propertyInterest: '2 bed condo',
        budgetRange: '$650k-$800k',
      },
      {
        fullName: 'Marcus Lee',
        leadType: 'seller' as any,
        stage: 'contacted' as any,
        temperature: 'warm' as any,
        score: 62,
        source: 'Referral',
        location: 'Queens',
        propertyInterest: 'List my townhouse',
        estimatedPrice: '$900k-$1.1M',
      },
      {
        fullName: 'Sofia Martinez',
        leadType: 'buyer' as any,
        stage: 'qualified' as any,
        temperature: 'hot' as any,
        score: 88,
        source: 'Website',
        location: 'Manhattan',
        propertyInterest: '1 bed rental',
      },
      {
        fullName: 'Daniel Kim',
        leadType: 'investor' as any,
        stage: 'contacted' as any,
        temperature: 'warm' as any,
        score: 73,
        source: 'Open house',
        location: 'Jersey City',
        propertyInterest: 'Multi-family cashflow',
      },
      {
        fullName: 'Emily Chen',
        leadType: 'buyer' as any,
        stage: 'under_contract' as any,
        temperature: 'hot' as any,
        score: 85,
        source: 'Facebook',
        location: 'Long Island',
        propertyInterest: '3 bed single family',
      },
      {
        fullName: 'Noah Williams',
        leadType: 'seller' as any,
        stage: 'new' as any,
        temperature: 'cold' as any,
        score: 42,
        source: 'Manual',
        location: 'Bronx',
        propertyInterest: 'Thinking about selling',
      },
      {
        fullName: 'Olivia Brown',
        leadType: 'renter' as any,
        stage: 'contacted' as any,
        temperature: 'warm' as any,
        score: 55,
        source: 'Website',
        location: 'Downtown Brooklyn',
        propertyInterest: 'Studio rental',
      },
      {
        fullName: 'Ethan Davis',
        leadType: 'buyer' as any,
        stage: 'closed' as any,
        temperature: 'warm' as any,
        score: 67,
        source: 'Referral',
        location: 'Staten Island',
        propertyInterest: 'Starter home',
      },
    ];

    const created: Lead[] = [];

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];

      const unique = `${now}-${i}`;
      const email = `sample+${tenant.id.slice(0, 6)}-${unique}@realtytechai.dev`;
      const phone = `555${String((now + i) % 10000000).padStart(7, '0')}`;

      // IMPORTANT: no "as any" here. Use Partial<Lead> so TS picks the single-entity overload.
      const lead = this.leadsRepository.create({
        ...s,
        email,
        phone,
        tenant,
        tenantId: tenant.id,

      lastActivityAt: new Date(),
        nextFollowUpAt: i % 3 === 0 ? new Date() : undefined,
      } as Partial<Lead>);

      const saved = await this.leadsRepository.save(lead as Lead);

      await this.logLeadEvent(saved, 'sample_created', { sample: true });

      created.push(saved);
    }

    return created;
  }

  // -------------------------
  // Protected: list and get
  // -------------------------

  async listLeads(params: { tenantId?: string; userId?: string; role?: UserRole; take: number; skip: number }): Promise<Lead[]> {
    if (!params.tenantId) return [];

    const canSeeAll = params.role ? hasAtLeastRole(params.role, 'admin') : true;
    const where: any = { tenantId: params.tenantId };
    if (!canSeeAll && params.userId) {
      // Agents/TCs see only leads assigned to them.
      where.assignedToUserId = params.userId;
    }

    return this.leadsRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: params.take,
      skip: params.skip,
    });
  }

  async getLeadById(tenantId: string | undefined, id: string, ctx?: { userId?: string; role?: UserRole }): Promise<Lead> {
    if (!tenantId) throw new Error('Missing tenant');

    const lead = await this.leadsRepository.findOne({
      where: { id, tenantId },
    });

    if (!lead) throw new NotFoundException('Lead not found');

    const canSeeAll = ctx?.role ? hasAtLeastRole(ctx.role, 'admin') : true;
    if (!canSeeAll && lead.assignedToUserId !== ctx?.userId) {
      throw new ForbiddenException('Lead is not assigned to this user');
    }

    return lead;
  }

  async assignLead(params: { tenantId: string | undefined; leadId: string; assignedToUserId?: string | null; assignedToTeamId?: string | null; assignedToLabel?: string | null }) {
    if (!params.tenantId) throw new Error('Missing tenant');
    const lead = await this.leadsRepository.findOne({ where: { id: params.leadId, tenantId: params.tenantId } });
    if (!lead) throw new Error('Lead not found');

    if (params.assignedToUserId) {
      const user = await this.usersRepository.findOne({
        where: { id: params.assignedToUserId, tenantId: params.tenantId, isActive: true },
      });
      if (!user) throw new ForbiddenException('Assignee must be an active user in this tenant');
    }
    if (params.assignedToTeamId) {
      const team = await this.teamsRepository.findOne({ where: { id: params.assignedToTeamId, tenantId: params.tenantId } });
      if (!team) throw new ForbiddenException('Team must belong to this tenant');
    }

    lead.assignedToUserId = params.assignedToUserId ?? null;
    lead.assignedToTeamId = params.assignedToTeamId ?? null;
    if (params.assignedToLabel !== undefined) {
      lead.assignedTo = params.assignedToLabel ?? undefined;
    }

    lead.lastActivityAt = new Date();
    const saved = await this.leadsRepository.save(lead);
    await this.logLeadEvent(saved, 'assigned', {
      assignedToUserId: saved.assignedToUserId,
      assignedToTeamId: saved.assignedToTeamId,
      assignedTo: saved.assignedTo,
    });
    return saved;
  }
}
