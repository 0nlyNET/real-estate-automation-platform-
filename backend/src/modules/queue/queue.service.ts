import { Injectable, Logger } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { Lead } from '../leads/lead.entity';
import { SequenceStep } from '../sequences/sequence-step.entity';

export type JobType = 'instant_sms' | 'instant_email' | 'sequence_step';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly queue: Queue;
  private readonly worker: Worker;

  constructor(private readonly configService: ConfigService) {
    const connection = {
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: parseInt(this.configService.get('REDIS_PORT', '6379'), 10),
    };
    this.queue = new Queue('automation', { connection });
    this.worker = new Worker(
      'automation',
      async (job: Job) => {
        this.logger.log(`Processing job ${job.name}`);
      },
      { connection },
    );
  }

  async enqueueImmediateSms(lead: Lead) {
    await this.queue.add(
      'instant_sms',
      { leadId: lead.id },
      { delay: 1_000, removeOnComplete: true, removeOnFail: false },
    );
  }

  async enqueueImmediateEmail(lead: Lead) {
    await this.queue.add(
      'instant_email',
      { leadId: lead.id },
      { delay: 10_000, removeOnComplete: true, removeOnFail: false },
    );
  }

  async enqueueSequenceStep(lead: Lead, step: SequenceStep) {
    await this.queue.add(
      'sequence_step',
      { leadId: lead.id, stepId: step.id },
      { delay: step.offsetMinutes * 60_000, removeOnComplete: true, removeOnFail: false },
    );
  }
}
