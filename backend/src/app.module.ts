import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';

import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { MeModule } from './modules/me/me.module';
import { BillingModule } from './modules/billing/billing.module';
import { LeadsModule } from './modules/leads/leads.module';
import { TeamsModule } from './modules/teams/teams.module';
import { StatsModule } from './modules/stats/stats.module';
import { AdminModule } from './modules/admin/admin.module';
import { PresenceModule } from './modules/presence/presence.module';
import { RoutingModule } from './modules/routing/routing.module';
import { ComplianceModule } from './modules/compliance/compliance.module';

import { Tenant } from './modules/tenants/tenant.entity';
import { TenantSettings } from './modules/settings/tenant-settings.entity';
import { Credential } from './modules/settings/credential.entity';

import { User } from './modules/users/user.entity';
import { Team } from './modules/teams/team.entity';

import { Lead } from './modules/leads/lead.entity';
import { LeadEvent } from './modules/leads/lead-event.entity';

import { Message } from './modules/messaging/message.entity';

import { Sequence } from './modules/sequences/sequence.entity';
import { SequenceEnrollment } from './modules/sequences/sequence-enrollment.entity';
import { SequenceStep } from './modules/sequences/sequence-step.entity';

import { RoutingRule } from './modules/routing/routing-rule.entity';
import { RoutingAssignmentLog } from './modules/routing/routing-assignment-log.entity';

import { AgentPresence } from './modules/presence/agent-presence.entity';

import { ComplianceOptOut } from './modules/compliance/compliance-optout.entity';
import { ComplianceEvent } from './modules/compliance/compliance-event.entity';
import { TenantQuietHours } from './modules/compliance/tenant-quiet-hours.entity';
import { PasswordResetToken } from './modules/auth/password-reset-token.entity';
import { SupportTicket } from './modules/support/support-ticket.entity';
import { AuditLog } from './modules/audit/audit-log.entity';
import { HealthModule } from './modules/health/health.module';
import { SettingsModule } from './modules/settings/settings.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { PublicModule } from './modules/public/public.module';
import { SupportModule } from './modules/support/support.module';
import { AuditModule } from './modules/audit/audit.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

function buildDatabaseConfig() {
  const url = process.env.DATABASE_URL;

  const entities = [
    Tenant,
    User,
    Team,
    Lead,
    LeadEvent,
    Message,
    Sequence,
    SequenceEnrollment,
    SequenceStep,
    Credential,
    TenantSettings,
    RoutingRule,
    RoutingAssignmentLog,
    AgentPresence,
    ComplianceOptOut,
    ComplianceEvent,
    TenantQuietHours,
    PasswordResetToken,
    SupportTicket,
    AuditLog,
  ];

  if (url) {
    const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
    const allowSync = process.env.TYPEORM_SYNC === 'true' && isLocal;
    const useSsl = !isLocal && process.env.DATABASE_SSL !== 'false';

    return {
      type: 'postgres' as const,
      url,
      entities,
      synchronize: allowSync,
      ssl: useSsl
        ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : false,
    };
  }

  return {
    type: 'postgres' as const,
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'real_estate',
    entities,
    synchronize: process.env.TYPEORM_SYNC === 'true',
    ssl: process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : false,
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['backend/.env', '.env'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    TypeOrmModule.forRoot(buildDatabaseConfig()),
    TenantsModule,
    UsersModule,
    AuthModule,
    MeModule,
    BillingModule,
    LeadsModule,
    TeamsModule,
    StatsModule,
    AdminModule,
    PresenceModule,
    RoutingModule,
    ComplianceModule,
    HealthModule,
    SettingsModule,
    IntegrationsModule,
    WebhooksModule,
    PublicModule,
    SupportModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
