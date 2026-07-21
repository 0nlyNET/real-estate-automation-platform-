import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Message } from '../messaging/message.entity';
import { Appointment } from './appointment.entity';
import {
  AdminClientOperationsController,
  ClientOperationsController,
} from './client-operations.controller';
import { ClientOperationsService } from './client-operations.service';
import { LeadHandoff } from './lead-handoff.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([LeadHandoff, Appointment, Lead, Message, LeadEvent]),
  ],
  controllers: [ClientOperationsController, AdminClientOperationsController],
  providers: [ClientOperationsService],
  exports: [ClientOperationsService],
})
export class ClientOperationsModule {}
