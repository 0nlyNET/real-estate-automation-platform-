import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Sequence } from './sequence.entity';
import { SequenceEnrollment } from './sequence-enrollment.entity';
import { SequenceStep } from './sequence-step.entity';
import { SequencesService } from './sequences.service';

function createService(options: { step?: SequenceStep | null; sequence?: Sequence | null } = {}) {
  const sequenceRepo = {
    create: jest.fn((value) => Object.assign(new Sequence(), value)),
    save: jest.fn(async (value) => Object.assign(value, { id: value.id || 'sequence-1' })),
    findOne: jest.fn().mockResolvedValue(options.sequence ?? null),
  };
  const stepRepo = {
    create: jest.fn((value) => Object.assign(new SequenceStep(), value)),
    save: jest.fn(async (value) => Object.assign(value, { id: value.id || 'step-1' })),
    findOne: jest.fn().mockResolvedValue(options.step ?? null),
    find: jest.fn().mockResolvedValue(options.step ? [options.step] : []),
    remove: jest.fn(),
  };
  const service = new SequencesService(
    { transaction: jest.fn() } as any,
    sequenceRepo as any,
    {} as any,
    stepRepo as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { assertAllowed: jest.fn().mockResolvedValue({}) } as any,
    {} as any,
  );
  return { service, sequenceRepo, stepRepo };
}

describe('sequence template approval gates', () => {
  it('creates automations inactive', async () => {
    const { service, sequenceRepo } = createService();
    await expect(service.createSequence('tenant-1', { name: 'Follow up' })).resolves.toMatchObject({
      active: false,
    });
    expect(sequenceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', active: false }),
    );
  });

  it('blocks approval until SMS identity and STOP language are present', async () => {
    const sequence = Object.assign(new Sequence(), { id: 'sequence-1', tenantId: 'tenant-1', active: false });
    const step = Object.assign(new SequenceStep(), {
      id: 'step-1',
      sequence,
      channel: 'sms',
      template: 'Hello, can we help?',
      identityLabel: 'Lakeview Realty',
      approvalStatus: 'draft',
      templateVersion: 1,
      active: true,
    });
    const { service } = createService({ step, sequence });
    await expect(
      service.approveStep('tenant-1', 'sequence-1', 'step-1', 'operator-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    step.template = 'Lakeview Realty: Can we help? Reply STOP to opt out.';
    await expect(
      service.approveStep('tenant-1', 'sequence-1', 'step-1', 'operator-1'),
    ).resolves.toMatchObject({ approvalStatus: 'approved' });
  });

  it('invalidates approval and deactivates a sequence after content changes', async () => {
    const sequence = Object.assign(new Sequence(), { id: 'sequence-1', tenantId: 'tenant-1', active: true });
    const step = Object.assign(new SequenceStep(), {
      id: 'step-1',
      sequence,
      channel: 'email',
      template: 'Lakeview Realty update {{unsubscribeUrl}}',
      identityLabel: 'Lakeview Realty',
      approvalStatus: 'approved',
      approvedAt: new Date(),
      approvedByUserId: 'operator-1',
      templateVersion: 3,
      active: true,
    });
    const { service } = createService({ step, sequence });
    await expect(
      service.updateStep('tenant-1', 'sequence-1', 'step-1', {
        template: 'Lakeview Realty revised update {{unsubscribeUrl}}',
      }),
    ).resolves.toMatchObject({ approvalStatus: 'draft', templateVersion: 4 });
    expect(sequence.active).toBe(false);
    expect(step.approvedAt).toBeNull();
  });

  it('rejects sequence and enrollment IDs belonging to another tenant', async () => {
    const tenantA = '00000000-0000-4000-8000-00000000000a';
    const tenantB = '00000000-0000-4000-8000-00000000000b';
    const sequenceB = Object.assign(new Sequence(), {
      id: 'sequence-b',
      tenantId: tenantB,
      active: true,
      steps: [],
    });
    const sequenceRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        where.id === sequenceB.id && where.tenantId === sequenceB.tenantId
          ? sequenceB
          : null,
      ),
      save: jest.fn(),
    };
    const enrollmentRepo = { findOne: jest.fn(), save: jest.fn() };
    const leadRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        where.id === 'lead-b' && where.tenantId === tenantB
          ? { id: 'lead-b', tenantId: tenantB }
          : null,
      ),
    };
    const service = new SequencesService(
      {} as any,
      sequenceRepo as any,
      enrollmentRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      leadRepo as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.getSequence(tenantA, sequenceB.id)).resolves.toBeNull();
    await expect(
      service.pauseEnrollment(tenantA, 'lead-b', 'enrollment-b', {
        userId: 'user-a',
        role: 'owner',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(enrollmentRepo.findOne).not.toHaveBeenCalled();
    expect(sequenceRepo.save).not.toHaveBeenCalled();
  });

  it('skips an overdue sequence step with audit evidence and queues no send', async () => {
    const lead: any = { id: 'lead-1', tenantId: 'tenant-1', fullName: 'Jordan', communicationStatus: 'active', stage: 'new' };
    const step: any = { id: 'step-1', channel: 'sms', template: 'Lakeview Realty: Hi {{firstName}}. Reply STOP to opt out.', templateVersion: 1, approvalStatus: 'approved', active: true, offsetMinutes: 0 };
    const sequence: any = { id: 'sequence-1', tenantId: 'tenant-1', active: true, steps: [step] };
    const enrollment = Object.assign(new SequenceEnrollment(), {
      id: 'enrollment-1', tenantId: 'tenant-1', leadId: lead.id,
      sequenceId: sequence.id, status: 'active', currentStepIndex: 0,
      nextRunAt: new Date(Date.now() - 16 * 60_000), lockedBy: 'worker', createdAt: new Date(),
    });
    const enrollmentRepo = { findOne: jest.fn().mockResolvedValue(enrollment), save: jest.fn(async (value) => value) };
    const messageRepo = { create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
    const eventRepo = { create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
    const service = new SequencesService(
      {} as any,
      { findOne: jest.fn().mockResolvedValue(sequence) } as any,
      enrollmentRepo as any,
      {} as any,
      messageRepo as any,
      eventRepo as any,
      {} as any,
      {} as any,
      { findOne: jest.fn().mockResolvedValue(lead) } as any,
      {} as any,
      { evaluate: jest.fn().mockResolvedValue({ allowed: true, reasons: [] }) } as any,
      {} as any,
    );

    await (service as any).runOneEnrollment(enrollment.id);

    expect(messageRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      status: 'skipped', errorCode: 'STALE_AUTOMATION', leadId: lead.id,
    }));
    expect(eventRepo.save).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'sequence_step_skipped' }));
    expect(enrollment.status).toBe('completed');
    expect(messageRepo.save).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }));
  });
});
