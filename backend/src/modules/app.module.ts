import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TerminusModule } from '@nestjs/terminus';

import { HealthModule } from './health/health.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { LeadsModule } from './leads/leads.module';
import { MessagingModule } from './messaging/messaging.module';
import { SequencesModule } from './sequences/sequences.module';
import { CrmModule } from './crm/crm.module';
import { CalendarModule } from './calendar/calendar.module';
import { SettingsModule } from './settings/settings.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // ENV
    ConfigModule.forRoot({ isGlobal: true }),

    // DATABASE (Railway Postgres)
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: true, // OK for demo only
      ssl: {
        rejectUnauthorized: false,
      },
    }),

    // Health check (Railway needs this)
    TerminusModule,
    HealthModule,

    // Core business modules
    TenantsModule,
    UsersModule,
    LeadsModule,
    MessagingModule,
    SequencesModule,
    CrmModule,
    CalendarModule,
    SettingsModule,
    AuditModule,
    AuthModule,

    // ❌ QueueModule / Redis intentionally removed for Railway
  ],
})
export class AppModule {}