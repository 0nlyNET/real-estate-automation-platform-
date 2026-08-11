import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { User } from '../users/user.entity';
import { hasAtLeastRole, UserRole } from '../../common/rbac';
import { ComplianceOptOut } from '../compliance/compliance-optout.entity';
import { LeadStageEvent } from '../leads/lead-stage-event.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';

type ReportingPeriod = { from?: string; to?: string };

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(ComplianceOptOut) private readonly optOuts: Repository<ComplianceOptOut>,
    @InjectRepository(LeadStageEvent) private readonly stageEvents: Repository<LeadStageEvent>,
    @InjectRepository(TenantSettings) private readonly settings: Repository<TenantSettings>,
  ) {}

  private period(input?: ReportingPeriod) {
    const to = input?.to ? new Date(input.to) : new Date();
    const from = input?.from
      ? new Date(input.from)
      : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
      throw new BadRequestException('Reporting dates are invalid');
    }
    if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Reporting range cannot exceed 366 days');
    }
    return { from, to };
  }

  async overview(
    tenantId: string,
    ctx?: { userId?: string; role?: string },
    periodInput?: ReportingPeriod,
  ) {
    const { from, to } = this.period(periodInput);
    const canSeeAll = ctx?.role ? hasAtLeastRole(ctx.role as UserRole, 'admin') : false;
    const scopedUserId = canSeeAll ? undefined : ctx?.userId;
    const scope = (alias: string) => scopedUserId ? `${alias}.assignedToUserId = :userId` : '1=1';
    const params = { tenantId, userId: scopedUserId, from, to };

    const leadsTotal = await this.leads.count({
      where: {
        tenantId,
        ...(scopedUserId ? { assignedToUserId: scopedUserId } : {}),
      },
    });
    const leadsCreated = await this.leads
      .createQueryBuilder('lead')
      .where('lead.tenantId = :tenantId', params)
      .andWhere(scope('lead'), params)
      .andWhere('lead.createdAt >= :from AND lead.createdAt < :to', params)
      .getCount();

    const messageRow = await this.messages
      .createQueryBuilder('message')
      .leftJoin('message.lead', 'lead')
      .select("COUNT(*) FILTER (WHERE message.direction = 'outbound')", 'created')
      .addSelect("COUNT(*) FILTER (WHERE message.direction = 'outbound' AND message.attempt_count > 0)", 'attempted')
      .addSelect("COUNT(*) FILTER (WHERE message.direction = 'outbound' AND message.status IN ('provider_accepted','sent','delivered'))", 'providerAccepted')
      .addSelect("COUNT(*) FILTER (WHERE message.direction = 'outbound' AND message.status IN ('sent','delivered'))", 'sent')
      .addSelect("COUNT(*) FILTER (WHERE message.direction = 'outbound' AND message.status = 'delivered')", 'delivered')
      .addSelect("COUNT(*) FILTER (WHERE message.direction = 'outbound' AND message.status = 'failed')", 'failed')
      .addSelect("COUNT(*) FILTER (WHERE message.direction = 'outbound' AND message.status = 'skipped')", 'skipped')
      .addSelect("COUNT(*) FILTER (WHERE message.direction = 'outbound' AND message.status = 'canceled')", 'canceled')
      .addSelect("COUNT(*) FILTER (WHERE message.direction = 'inbound' AND message.status = 'received')", 'replies')
      .where('lead.tenantId = :tenantId', params)
      .andWhere(scope('lead'), params)
      .andWhere('message.createdAt >= :from AND message.createdAt < :to', params)
      .getRawOne();
    const number = (value: unknown) => Number(value || 0);
    const messageMetrics = {
      created: number(messageRow?.created),
      attempted: number(messageRow?.attempted),
      providerAccepted: number(messageRow?.providerAccepted),
      sent: number(messageRow?.sent),
      delivered: number(messageRow?.delivered),
      failed: number(messageRow?.failed),
      skipped: number(messageRow?.skipped),
      canceled: number(messageRow?.canceled),
    };

    const replyTiming = await this.leads
      .createQueryBuilder('lead')
      .select('AVG(lead.firstResponseTimeSec)', 'avg')
      .addSelect('COUNT(*)', 'count')
      .where('lead.tenantId = :tenantId', params)
      .andWhere(scope('lead'), params)
      .andWhere('lead.firstResponseReceivedAt >= :from AND lead.firstResponseReceivedAt < :to', params)
      .andWhere('lead.firstResponseTimeSec IS NOT NULL')
      .getRawOne();
    const outreachTiming = await this.leads
      .createQueryBuilder('lead')
      .select('AVG(EXTRACT(EPOCH FROM (lead.firstContactSentAt - lead.createdAt)))', 'avg')
      .addSelect('COUNT(*)', 'count')
      .addSelect("COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (lead.firstContactSentAt - lead.createdAt)) <= 300)", 'within5')
      .where('lead.tenantId = :tenantId', params)
      .andWhere(scope('lead'), params)
      .andWhere('lead.createdAt >= :from AND lead.createdAt < :to', params)
      .andWhere('lead.firstContactSentAt IS NOT NULL')
      .getRawOne();
    const outreachSamples = number(outreachTiming?.count);

    const currentAppointments = await this.leads
      .createQueryBuilder('lead')
      .where('lead.tenantId = :tenantId', params)
      .andWhere(scope('lead'), params)
      .andWhere("lead.stage = 'appointment_set'")
      .getCount();
    const appointmentEvents = await this.stageEvents
      .createQueryBuilder('event')
      .innerJoin(Lead, 'lead', 'lead.id = event.lead_id')
      .where('event.tenant_id = :tenantId', params)
      .andWhere(scope('lead'), params)
      .andWhere("event.new_stage = 'appointment_set'")
      .andWhere('event.created_at >= :from AND event.created_at < :to', params)
      .getCount();
    const optOuts = await this.optOuts
      .createQueryBuilder('optout')
      .where('optout.tenantId = :tenantId', params)
      .andWhere('optout.createdAt >= :from AND optout.createdAt < :to', params)
      .getCount();
    const assignments = await this.leads
      .createQueryBuilder('lead')
      .where('lead.tenantId = :tenantId', params)
      .andWhere(scope('lead'), params)
      .andWhere('lead.createdAt >= :from AND lead.createdAt < :to', params)
      .andWhere('lead.assignedToUserId IS NOT NULL')
      .getCount();

    const stageRows = await this.leads
      .createQueryBuilder('lead')
      .select('lead.stage', 'label')
      .addSelect('COUNT(*)', 'count')
      .where('lead.tenantId = :tenantId', params)
      .andWhere(scope('lead'), params)
      .groupBy('lead.stage')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();
    const sourceRows = await this.leads
      .createQueryBuilder('lead')
      .select("COALESCE(NULLIF(lead.source, ''), 'Unknown')", 'label')
      .addSelect('COUNT(*)', 'count')
      .where('lead.tenantId = :tenantId', params)
      .andWhere(scope('lead'), params)
      .andWhere('lead.createdAt >= :from AND lead.createdAt < :to', params)
      .groupBy("COALESCE(NULLIF(lead.source, ''), 'Unknown')")
      .orderBy('COUNT(*)', 'DESC')
      .limit(8)
      .getRawMany();
    const workspaceSettings = await this.settings.findOne({ where: { tenantId } });
    const breakdown = (rows: Array<{ label?: string; count?: string }>) =>
      rows.map((row) => ({ label: String(row.label || 'Unknown'), count: number(row.count) }));

    const avgInitialOutreachSec = outreachTiming?.avg == null ? null : Math.round(Number(outreachTiming.avg));
    const avgFirstResponseSec = replyTiming?.avg == null ? null : Math.round(Number(replyTiming.avg));
    const pctContactedWithin5Min = outreachSamples
      ? Math.round((number(outreachTiming?.within5) / outreachSamples) * 100)
      : null;

    return {
      leadsTotal,
      leadsCreated,
      newLeads7d: leadsCreated,
      messagesTotal: messageMetrics.created,
      messageMetrics,
      replies: number(messageRow?.replies),
      optOuts,
      assignments,
      avgInitialOutreachSec,
      initialOutreachSamples: outreachSamples,
      avgFirstResponseSec,
      responseSamples: number(replyTiming?.count),
      pctContactedWithin5Min,
      currentAppointments,
      appointmentSetEvents: appointmentEvents,
      appointmentsSet7d: appointmentEvents,
      verifiedBookings: null,
      stageBreakdown: breakdown(stageRows),
      sourceBreakdown: breakdown(sourceRows),
      reporting: {
        from: from.toISOString(),
        to: to.toISOString(),
        timeZone: workspaceSettings?.timeZone || 'UTC',
        dataSources: ['PostgreSQL leads', 'message provider states', 'lead-stage history', 'compliance opt-outs'],
        statusDefinitions: {
          providerAccepted: 'Provider API accepted the request; this is not delivery.',
          sent: 'Twilio reported sent, or an equivalent provider state was recorded.',
          delivered: 'Twilio delivery callback reported delivered. Email delivery is not tracked.',
          appointmentSetEvents: 'Lead moved to Appointment Set during the selected period.',
        },
        limitations: [
          'No calendar synchronization; verified bookings are unavailable.',
          'Revenue, ROI, closed-deal attribution, social performance, and time saved are not tracked.',
        ],
      },
    };
  }

  async agentPerformance(tenantId: string) {
    const agents = await this.users.find({
      where: { tenant: { id: tenantId }, isActive: true } as any,
    });
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return Promise.all(agents.map(async (user) => {
      const leadsAssigned = await this.leads.count({ where: { tenantId, assignedToUserId: user.id } });
      const leadsNew7d = await this.leads
        .createQueryBuilder('lead')
        .where('lead.tenantId = :tenantId', { tenantId })
        .andWhere('lead.assignedToUserId = :userId', { userId: user.id })
        .andWhere('lead.createdAt >= :since', { since })
        .getCount();
      const messagesProviderAccepted7d = await this.messages
        .createQueryBuilder('message')
        .leftJoin('message.lead', 'lead')
        .where('lead.tenantId = :tenantId', { tenantId })
        .andWhere('lead.assignedToUserId = :userId', { userId: user.id })
        .andWhere("message.direction = 'outbound'")
        .andWhere("message.status IN ('provider_accepted','sent','delivered')")
        .andWhere('message.createdAt >= :since', { since })
        .getCount();
      return {
        userId: user.id,
        email: user.email,
        role: user.role,
        teamId: user.teamId,
        leadsAssigned,
        leadsNew7d,
        messagesProviderAccepted7d,
        messagesSent7d: messagesProviderAccepted7d,
      };
    }));
  }

  agentMetrics(tenantId: string) {
    return this.agentPerformance(tenantId);
  }

  async teamPerformance(
    tenantId: string,
    filters: ReportingPeriod & {
      teamId?: string;
      agentId?: string;
      source?: string;
    },
  ) {
    const { from, to } = this.period(filters);
    const query = this.leads
      .createQueryBuilder('lead')
      .leftJoin('lead.assignedToTeam', 'team')
      .leftJoin('lead.assignedToUser', 'agent')
      .select("COALESCE(lead.assignedToTeamId::text, 'unassigned')", 'teamId')
      .addSelect("COALESCE(team.name, 'Unassigned')", 'teamName')
      .addSelect("COALESCE(lead.assignedToUserId::text, 'unassigned')", 'agentId')
      .addSelect("COALESCE(agent.email, 'Unassigned')", 'agentEmail')
      .addSelect("COALESCE(NULLIF(lead.source, ''), 'Unknown')", 'source')
      .addSelect("TO_CHAR(DATE_TRUNC('day', lead.createdAt), 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(*)', 'leads')
      .addSelect("COUNT(*) FILTER (WHERE lead.stage IN ('qualified','appointment_set','showing_scheduled','offer_out','under_contract','closed'))", 'qualified')
      .addSelect("COUNT(*) FILTER (WHERE lead.stage = 'appointment_set')", 'appointments')
      .addSelect("COUNT(*) FILTER (WHERE lead.stage = 'closed')", 'closed')
      .addSelect('AVG(lead.firstResponseTimeSec) FILTER (WHERE lead.firstResponseTimeSec IS NOT NULL)', 'avgResponseTimeSec')
      .addSelect(`COALESCE(SUM((
        SELECT COUNT(*) FROM messages response
         WHERE response."leadId" = lead.id
           AND response.direction = 'inbound'
           AND response.status = 'received'
           AND response.created_at >= :from
           AND response.created_at < :to
      )), 0)`, 'responses')
      .addSelect(`COALESCE(SUM((
        SELECT COUNT(*) FROM lead_handoffs handoff
         WHERE handoff.lead_id = lead.id
           AND handoff.tenant_id = :tenantId
           AND handoff.created_at >= :from
           AND handoff.created_at < :to
      )), 0)`, 'handoffs')
      .where('lead.tenantId = :tenantId', { tenantId })
      .andWhere('lead.createdAt >= :from AND lead.createdAt < :to', { from, to });
    if (filters.teamId) query.andWhere('lead.assignedToTeamId = :teamId', { teamId: filters.teamId });
    if (filters.agentId) query.andWhere('lead.assignedToUserId = :agentId', { agentId: filters.agentId });
    if (filters.source) query.andWhere('lead.source = :source', { source: filters.source.slice(0, 160) });
    const rows = await query
      .groupBy("COALESCE(lead.assignedToTeamId::text, 'unassigned')")
      .addGroupBy("COALESCE(team.name, 'Unassigned')")
      .addGroupBy("COALESCE(lead.assignedToUserId::text, 'unassigned')")
      .addGroupBy("COALESCE(agent.email, 'Unassigned')")
      .addGroupBy("COALESCE(NULLIF(lead.source, ''), 'Unknown')")
      .addGroupBy("DATE_TRUNC('day', lead.createdAt)")
      .orderBy("DATE_TRUNC('day', lead.createdAt)", 'DESC')
      .addOrderBy("COALESCE(team.name, 'Unassigned')", 'ASC')
      .getRawMany();
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      filters: {
        teamId: filters.teamId || null,
        agentId: filters.agentId || null,
        source: filters.source || null,
      },
      rows: rows.map((row) => ({
        teamId: row.teamId,
        teamName: row.teamName,
        agentId: row.agentId,
        agentEmail: row.agentEmail,
        source: row.source,
        date: row.date,
        leads: Number(row.leads || 0),
        responses: Number(row.responses || 0),
        qualified: Number(row.qualified || 0),
        appointments: Number(row.appointments || 0),
        avgResponseTimeSec: row.avgResponseTimeSec == null
          ? null
          : Math.round(Number(row.avgResponseTimeSec)),
        handoffs: Number(row.handoffs || 0),
        closed: Number(row.closed || 0),
      })),
      definitions: {
        leads: 'Leads created during the selected period.',
        responses: 'Inbound lead replies received during the selected period.',
        qualified: 'Leads currently at Qualified or a later pipeline stage.',
        appointments: 'Those leads whose current stage is Appointment Set.',
        avgResponseTimeSec: 'Average time from initial contact to the first inbound response.',
        handoffs: 'Human handoffs created during the selected period.',
        closed: 'Those leads whose current stage is Closed.',
      },
    };
  }
}
