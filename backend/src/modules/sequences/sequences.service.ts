import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sequence } from './sequence.entity';
import { SequenceEnrollment } from './sequence-enrollment.entity';
import { Lead } from '../leads/lead.entity';

@Injectable()
export class SequencesService {
  private readonly logger = new Logger(SequencesService.name);

  constructor(
    @InjectRepository(Sequence)
    private readonly sequenceRepository: Repository<Sequence>,
    @InjectRepository(SequenceEnrollment)
    private readonly enrollmentRepository: Repository<SequenceEnrollment>,
  ) {}

  async startForLead(lead: Lead) {
    // Important: ensure lead.tenant is loaded. If not, this will still be safe.
    const tenantId = lead.tenant?.id;

    if (!tenantId) {
      this.logger.warn(
        `startForLead called without tenant loaded (leadId=${lead.id})`,
      );
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

    // TODO: Re-enable queued sequence step scheduling when Redis/BullMQ is added back on Railway.
    // For demo stability, we are not enqueueing follow-up steps in production yet.
    this.logger.log(
      `Sequence enrollment created (enrollmentId=${enrollment.id}) steps=${sequence.steps?.length ?? 0}`,
    );
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