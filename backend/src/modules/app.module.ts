import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TerminusModule } from '@nestjs/terminus';

import { AppController } from '../app.controller';

import { HealthModule } from './health/health.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { LeadsModule } from './leads/leads.module';
import { MessagingModule } from './messaging/messaging.module';
import { SequencesModule } from './sequences/sequences.module';
//import { QueueModule } from './queue/queue.module';
import { CrmModule } from './crm/crm.module';
import { CalendarModule } from './calendar/calendar.module';
import { SettingsModule } from './settings/settings.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';

import ormconfig from '../ormconfig';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: async (configService: ConfigService) => ormconfig(configService),
      inject: [ConfigService],
    }),
    TerminusModule,
    HealthModule,
    TenantsModule,
    UsersModule,
    LeadsModule,
    MessagingModule,
    SequencesModule,
    QueueModule,
    CrmModule,
    CalendarModule,
    SettingsModule,
    AuditModule,
    AuthModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
