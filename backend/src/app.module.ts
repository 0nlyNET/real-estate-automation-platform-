import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AppController } from "./app.controller";

import { TenantsModule } from "./modules/tenants/tenants.module";
import { UsersModule } from "./modules/users/users.module";
import { AuthModule } from "./modules/auth/auth.module";
import { MeModule } from "./modules/me/me.module";
import { BillingModule } from "./modules/billing/billing.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { TeamsModule } from "./modules/teams/teams.module";
import { StatsModule } from "./modules/stats/stats.module";
import { AdminModule } from "./modules/admin/admin.module";
import { PresenceModule } from "./modules/presence/presence.module";
import { RoutingModule } from "./modules/routing/routing.module";
import { ComplianceModule } from "./modules/compliance/compliance.module";

import { HealthModule } from "./modules/health/health.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { WebhooksModule } from "./modules/webhooks/webhooks.module";
import { PublicModule } from "./modules/public/public.module";
import { SupportModule } from "./modules/support/support.module";
import { AuditModule } from "./modules/audit/audit.module";
import { IntegrationsModule } from "./modules/integrations/integrations.module";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { buildDatabaseOptions } from "./database/database-options";
import { AuditInterceptor } from "./modules/audit/audit.interceptor";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["backend/.env", ".env"],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    TypeOrmModule.forRoot(buildDatabaseOptions()),
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
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
