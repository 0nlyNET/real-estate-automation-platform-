import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { MeModule } from './modules/me/me.module';
import { BillingModule } from './modules/billing/billing.module';
import { AppController } from './app.controller';
import { AgencyApplicationsModule } from './modules/agency-applications/agency-applications.module';
import { AgencyApplication } from './modules/agency-applications/agency-application.entity';
import { AgencyModule } from './modules/agency/agency.module';

function buildDatabaseConfig() {
  const url = process.env.DATABASE_URL;
  if (url) {
    // Railway/Postgres style
    const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
    return {
      type: 'postgres' as const,
      url,
      entities: [AgencyApplication],
      autoLoadEntities: true,
      synchronize: true,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    };
  }

  // Local docker-compose style
  return {
    type: 'postgres' as const,
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'real_estate',
    entities: [AgencyApplication],
    autoLoadEntities: true,
    synchronize: true,
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        // Prefer backend/.env, but allow root .env
        'backend/.env',
        '.env',
      ],
    }),

    TypeOrmModule.forRoot(buildDatabaseConfig()),

    TenantsModule,
    UsersModule,
    AuthModule,
    MeModule,
    BillingModule,
    AgencyApplicationsModule,
    AgencyModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
