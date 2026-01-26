import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Credential } from '../settings/credential.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';

import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [TypeOrmModule.forFeature([Credential, Lead, Message])],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
