import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TerminusModule } from '@nestjs/terminus';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import ormconfig from './ormconfig';

import { HealthModule } from './modules/health/health.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { LeadsModule } from './modules/leads/leads.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { SequencesModule } from './modules/sequences/sequences.module';
import { CrmModule } from './modules/crm/crm.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { MeModule } from './modules/me/me.module';
import { StatsModule } from './modules/stats/stats.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';

@Module({
  imports: [
    // ENV
    ConfigModule.forRoot({ isGlobal: true }),

    // RATE LIMITING (global baseline)
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.RATE_LIMIT_TTL ?? 60),
        limit: Number(process.env.RATE_LIMIT_LIMIT ?? 60),
      },
    ]),

    // DATABASE
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: ormconfig,
    }),

    // HEALTH
    TerminusModule,
    HealthModule,

    // CORE MODULES
    TenantsModule,
    UsersModule,
    AuthModule,
    LeadsModule,
    MessagingModule,
    SequencesModule,
    CrmModule,
    CalendarModule,
    SettingsModule,
    IntegrationsModule,
    AuditModule,
    MeModule,
    StatsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}