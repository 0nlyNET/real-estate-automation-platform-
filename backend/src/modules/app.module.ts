import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { LeadsModule } from './leads/leads.module';
import { MessagingModule } from './messaging/messaging.module';
import { SequencesModule } from './sequences/sequences.module';
import { SettingsModule } from './settings/settings.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PublicModule } from './public/public.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(process.cwd(), '.env'),
    }),

    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      // Safety: never sync schema unless you explicitly opt in.
      synchronize: process.env.TYPEORM_SYNC === 'true',
      ssl: process.env.DATABASE_SSL === 'false'
        ? false
        : { rejectUnauthorized: false },
    }),

    AuthModule,
    UsersModule,
    TenantsModule,
    SettingsModule,

    LeadsModule,
    MessagingModule,
    SequencesModule,

    BillingModule,
    IntegrationsModule,
    WebhooksModule,

    // Public (marketing) endpoints
    PublicModule,
  ],
})
export class AppModule {}
