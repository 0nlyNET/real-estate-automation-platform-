import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';

import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { Credential } from '../settings/credential.entity';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { MailModule } from '../../mail/mail.module';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([Tenant, User, Lead, Message, Credential]),
    CommonModule,
    AuditModule,
    MailModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
