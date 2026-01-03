import { DataSourceOptions } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Tenants } from './modules/tenants/tenant.entity';
import { User } from './modules/users/user.entity';
import { Lead } from './modules/leads/lead.entity';
import { LeadEvent } from './modules/leads/lead-event.entity';
import { Message } from './modules/messaging/message.entity';
import { Sequence } from './modules/sequences/sequence.entity';
import { SequenceStep } from './modules/sequences/sequence-step.entity';
import { SequenceEnrollment } from './modules/sequences/sequence-enrollment.entity';
import { Credential } from './modules/settings/credential.entity';
import { AuditLog } from './modules/audit/audit-log.entity';

const ormconfig = (configService: ConfigService): DataSourceOptions => ({
  type: 'postgres',
  host: configService.get<string>('DB_HOST', 'localhost'),
  port: parseInt(configService.get<string>('DB_PORT', '5432'), 10),
  username: configService.get<string>('DB_USER', 'postgres'),
  password: configService.get<string>('DB_PASSWORD', 'postgres'),
  database: configService.get<string>('DB_NAME', 'real_estate'),
  entities: [
      Tenants,
    User,
    Lead,
    LeadEvent,
    Message,
    Sequence,
    SequenceStep,
    SequenceEnrollment,
    Credential,
    AuditLog,
  ],
  synchronize: configService.get<string>('NODE_ENV') === 'development',
  migrations: ['dist/migrations/*.js'],
  migrationsRun: false,
  logging: configService.get<string>('NODE_ENV') === 'development',
});

export default ormconfig;
