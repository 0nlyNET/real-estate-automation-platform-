import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadsModule } from '../leads/leads.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { TestRun } from './test-run.entity';
import { TestingService } from './testing.service';
import { Sequence } from '../sequences/sequence.entity';
import { AiRun } from '../ai/ai-run.entity';
import { Message } from '../messaging/message.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TestRun, Sequence, AiRun, Message]),
    LeadsModule,
    OnboardingModule,
  ],
  providers: [TestingService],
  exports: [TestingService],
})
export class TestingModule {}
