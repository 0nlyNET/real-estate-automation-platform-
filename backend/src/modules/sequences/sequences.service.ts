import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sequence } from './sequence.entity';
import { SequenceEnrollment } from './sequence-enrollment.entity';
import { Lead } from '../leads/lead.entity';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class SequencesService {
  private readonly logger = new Logger(SequencesService.name);

  constructor(
    @InjectRepository(Sequence)
    private readonly sequenceRepository: Repository<Sequence>,
    @InjectRepository(SequenceEnrollment)
    private readonly enrollmentRepository: Repository<SequenceEnrollment>,
    private readonly queueService: QueueService,
  ) {}

  async startForLead(lead: Lead) {
    // Important: ensure lead.tenant is loaded. If not, this will still be safe.
    const tenantId = lead.tenant?.id;

    if (!tenantId) {
      this.logger.warn(`startForLead called without tenant loaded (leadId=${lead.id})`);
      return;
    }

    const sequence = await this.sequenceRepository.findOne({
      where: {
       tenantId: tenantId,
        leadType: lead.leadType,
        temperature: lead.temperature,
      },
      relations: ['steps', 'tenant'],
      order: { steps: { offsetMinutes: 'ASC' } },
    });

    if (!sequence) {
      this.logger.warn(`No sequence found for tenant ${tenantId}`);
      return;
    }

    const enrollment = this.enrollmentRepository.create({ sequence, lead });
    await this.enrollmentRepository.save(enrollment);

    for (const step of sequence.steps) {
      await this.queueService.enqueueSequenceStep(lead, step);
    }
  }

  async stopForLead(leadId: string) {
    const enrollments = await this.enrollmentRepository.find({
      where: { lead: { id: leadId }, status: 'active' },
    });

    for (const enrollment of enrollments) {
      enrollment.status = 'stopped';
      await this.enrollmentRepository.save(enrollment);
    }
  }
}
