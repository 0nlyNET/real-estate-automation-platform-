import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SequenceEnrollment } from '../sequences/sequence-enrollment.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { MessageSafetyResult } from './message-safety.service';
import { Message } from './message.entity';
import { SendDecision } from './send-decision.entity';

@Injectable()
export class SendDecisionService {
  constructor(
    @InjectRepository(SendDecision)
    private readonly decisions: Repository<SendDecision>,
    @InjectRepository(SequenceEnrollment)
    private readonly enrollments: Repository<SequenceEnrollment>,
    @InjectRepository(TenantSettings)
    private readonly settings: Repository<TenantSettings>,
  ) {}

  async record(input: {
    message: Message;
    safety: MessageSafetyResult;
    usage?: Record<string, unknown> | null;
    providerIdentity?: Record<string, unknown>;
    decision: SendDecision['decision'];
  }) {
    const message = input.message;
    const lead = message.lead;
    if (!lead) return null;
    let row = await this.decisions.findOne({ where: { messageId: message.id } });
    const sequence = /^sequence:([0-9a-f-]+):(\d+):[^:]+:v(\d+)$/i.exec(
      String(message.idempotencyKey || ''),
    );
    const enrollment = sequence
      ? await this.enrollments.findOne({
          where: { id: sequence[1], tenantId: lead.tenantId },
        })
      : null;
    const settings = await this.settings.findOne({
      where: { tenantId: lead.tenantId },
    });
    row ||= this.decisions.create({
      tenantId: lead.tenantId,
      leadId: lead.id,
      messageId: message.id,
      createdAt: message.createdAt,
    } as SendDecision);
    row.automationId = enrollment?.sequenceId || null;
    row.enrollmentId = enrollment?.id || null;
    row.stepIndex = sequence ? Number(sequence[2]) : null;
    row.templateVersion = sequence ? Number(sequence[3]) : null;
    row.usageReservationId = String(input.usage?.reservationId || '') || null;
    row.leadSnapshot = {
      stage: lead.stage,
      temperature: lead.temperature,
      communicationStatus: lead.communicationStatus,
      smsEligible: lead.smsEligible,
      emailEligible: lead.emailEligible,
      optedOutAt: lead.optedOutAt || null,
      testRunId: lead.testRunId || null,
    };
    row.configurationSnapshot = {
      messageCreatedAt: message.createdAt,
      idempotencyKey: message.idempotencyKey,
      channel: message.channel,
      authorship: message.authorship,
      communicationType: message.communicationType,
      requiresBookingLink: message.requiresBookingLink,
      automationId: row.automationId,
      enrollmentId: row.enrollmentId,
      stepIndex: row.stepIndex,
      templateVersion: row.templateVersion,
      timeZone: settings?.timeZone || null,
      automationsEnabled: settings?.automationsEnabled === true,
    };
    row.safetyDecision = {
      allowed: input.safety.allowed,
      reasons: input.safety.reasons,
      ruleIds: input.safety.ruleIds,
    };
    row.usageDecision = input.usage || {};
    row.providerIdentity = input.providerIdentity || row.providerIdentity || {};
    row.decision = input.decision;
    try {
      return await this.decisions.save(row);
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      const current = await this.decisions.findOneOrFail({
        where: { messageId: message.id },
      });
      Object.assign(current, row, { id: current.id });
      return this.decisions.save(current);
    }
  }
}
