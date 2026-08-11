import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Team } from '../teams/team.entity';
import { Lead } from '../leads/lead.entity';
import { Sequence } from '../sequences/sequence.entity';
import { RoutingRule } from '../routing/routing-rule.entity';
import { ComplianceOptOut } from './compliance-optout.entity';
import { ComplianceEvent } from './compliance-event.entity';
import { TenantQuietHours } from './tenant-quiet-hours.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { SupportTicket } from '../support/support-ticket.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { IntegrationsService } from '../integrations/integrations.service';
import { Appointment } from '../client-operations/appointment.entity';
import { BillingEvent } from '../billing/billing-event.entity';

@Injectable()
export class DataExportService {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Team) private readonly teams: Repository<Team>,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(Sequence)
    private readonly sequences: Repository<Sequence>,
    @InjectRepository(RoutingRule)
    private readonly routingRules: Repository<RoutingRule>,
    @InjectRepository(ComplianceOptOut)
    private readonly optOuts: Repository<ComplianceOptOut>,
    @InjectRepository(ComplianceEvent)
    private readonly complianceEvents: Repository<ComplianceEvent>,
    @InjectRepository(TenantQuietHours)
    private readonly quietHours: Repository<TenantQuietHours>,
    @InjectRepository(TenantSettings)
    private readonly settings: Repository<TenantSettings>,
    @InjectRepository(SupportTicket)
    private readonly supportTickets: Repository<SupportTicket>,
    @InjectRepository(AuditLog)
    private readonly auditLogs: Repository<AuditLog>,
    private readonly integrations: IntegrationsService,
    @Optional()
    @InjectRepository(Appointment)
    private readonly appointments?: Repository<Appointment>,
    @Optional()
    @InjectRepository(BillingEvent)
    private readonly billingEvents?: Repository<BillingEvent>,
  ) {}

  async exportWorkspace(tenantId: string) {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Workspace not found');

    const [
      users,
      teams,
      leads,
      sequences,
      routingRules,
      optOuts,
      complianceEvents,
      quietHours,
      settings,
      supportTickets,
      auditLogs,
      integrations,
      appointments,
      billingEvents,
    ] = await Promise.all([
      this.users.find({ where: { tenantId }, order: { email: 'ASC' } }),
      this.teams.find({ where: { tenantId }, order: { name: 'ASC' } }),
      this.leads.find({
        where: { tenantId },
        relations: ['messages', 'events', 'enrollments'],
        order: { createdAt: 'DESC' },
      }),
      this.sequences.find({
        where: { tenantId },
        relations: ['steps'],
        order: { createdAt: 'DESC' },
      }),
      this.routingRules.find({
        where: { tenantId },
        order: { priority: 'ASC' },
      }),
      this.optOuts.find({ where: { tenantId }, order: { createdAt: 'DESC' } }),
      this.complianceEvents.find({
        where: { tenantId },
        order: { createdAt: 'DESC' },
      }),
      this.quietHours.findOne({ where: { tenantId } }),
      this.settings.findOne({ where: { tenantId } }),
      this.supportTickets.find({
        where: { tenant: { id: tenantId } as Tenant },
        order: { createdAt: 'DESC' },
      }),
      this.auditLogs.find({
        where: { tenantId },
        order: { createdAt: 'DESC' },
      }),
      this.integrations.list(tenantId),
      this.appointments?.find({
        where: { tenantId },
        order: { startsAt: 'DESC' },
      }) || Promise.resolve([]),
      this.billingEvents?.find({
        where: { tenantId },
        order: { occurredAt: 'DESC' },
      }) || Promise.resolve([]),
    ]);

    return {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      workspace: {
        id: tenant.id,
        name: tenant.name,
        plan: tenant.plan,
        status: tenant.status,
        billingInterval: tenant.billingInterval,
        trialEndsAt: tenant.trialEndsAt,
        currentPeriodEnd: tenant.currentPeriodEnd,
        cancelAtPeriodEnd: tenant.cancelAtPeriodEnd,
        cancelAt: tenant.cancelAt,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      },
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        teamId: user.teamId,
        isActive: user.isActive,
        isEmailVerified: user.isEmailVerified,
      })),
      teams,
      settings: settings
        ? {
            timeZone: settings.timeZone,
            quietHoursStart: settings.quietHoursStart,
            quietHoursEnd: settings.quietHoursEnd,
            bookingLink: settings.bookingLink || '',
            automationsEnabled: settings.automationsEnabled,
            roundRobinEnabled: settings.roundRobinEnabled,
            roundRobinTeamId: settings.roundRobinTeamId || null,
            leadSource: settings.leadSource || null,
          }
        : null,
      quietHours,
      integrations,
      appointments,
      billingRecords: billingEvents,
      leads,
      sequences,
      routingRules,
      compliance: { optOuts, events: complianceEvents },
      supportTickets,
      auditLogs,
    };
  }
}
