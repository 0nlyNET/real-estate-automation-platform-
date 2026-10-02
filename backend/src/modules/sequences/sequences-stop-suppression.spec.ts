import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { SequenceEnrollment } from './sequence-enrollment.entity';
import {
  SequencesService,
  sequenceEnrollmentIdFromIdempotencyKey,
} from './sequences.service';

/**
 * Regression: a stopped sequence enrollment must never deliver follow-ups.
 *
 * Scenario: queue a sequence follow-up -> inbound reply stops the enrollment
 * -> the queued follow-up is canceled (never submitted), while AI/manual
 * replies and approved one-off reminders for the same lead are preserved.
 */
function buildService(options: {
  enrollmentRepo?: any;
  leadEventRepo?: any;
  manager?: any;
} = {}) {
  const enrollmentRepo = options.enrollmentRepo || {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const leadEventRepo = options.leadEventRepo || {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const manager = options.manager || {
    getRepository: jest.fn(() => enrollmentRepo),
    query: jest.fn().mockResolvedValue([]),
  };
  const dataSource = {
    transaction: jest.fn(async (callback: any) => callback(manager)),
  };
  const service = new SequencesService(
    dataSource as any,
    {} as any,
    enrollmentRepo,
    {} as any,
    {} as any,
    leadEventRepo,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { assertAllowed: jest.fn() } as any,
    { createTask: jest.fn() } as any,
  );
  return { service, enrollmentRepo, leadEventRepo, manager, dataSource };
}

describe('sequenceEnrollmentIdFromIdempotencyKey', () => {
  it('parses the owning enrollment id from a sequence key', () => {
    const enrollmentId = '12345678-1234-1234-1234-1234567890ab';
    expect(
      sequenceEnrollmentIdFromIdempotencyKey(
        `sequence:${enrollmentId}:0:sms:v3`,
      ),
    ).toBe(enrollmentId);
  });

  it('returns null for non-sequence keys and malformed input', () => {
    expect(sequenceEnrollmentIdFromIdempotencyKey('ai:run-1')).toBeNull();
    expect(sequenceEnrollmentIdFromIdempotencyKey('sequence:not-a-uuid:0:sms:v1')).toBeNull();
    expect(sequenceEnrollmentIdFromIdempotencyKey(null)).toBeNull();
    expect(sequenceEnrollmentIdFromIdempotencyKey(undefined)).toBeNull();
    expect(sequenceEnrollmentIdFromIdempotencyKey('')).toBeNull();
  });
});

describe('stopForLead suppresses queued sequence follow-ups', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stops enrollments and cancels queued sequence messages atomically', async () => {
    const manager = {
      getRepository: jest.fn((entity: any) => ({
        update: jest.fn().mockResolvedValue({ affected: 2 }),
      })),
      query: jest.fn().mockResolvedValue([{ id: 'msg-seq-1' }, { id: 'msg-seq-2' }]),
    };
    const leadEventRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const { service, dataSource } = buildService({ manager, leadEventRepo });

    await service.stopForLead('tenant-1', 'lead-1', 'reply');

    // Enrollment stop ran inside the transaction.
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    const enrollmentRepoUpdate = (manager.getRepository as jest.Mock).mock.results[0].value.update;
    expect(enrollmentRepoUpdate).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', leadId: 'lead-1', status: expect.anything() },
      expect.objectContaining({ status: 'stopped', stoppedReason: 'reply' }),
    );

    // Exactly one raw cancel query ran, scoped to sequence-owned messages.
    expect(manager.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (manager.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("SET status = 'canceled'");
    expect(sql).toContain("message.communication_type = 'sequence'");
    expect(sql).toContain("'CANCELLED_BY_ENROLLMENT_STOP'");
    // Tenant isolation: only messages of leads in this workspace.
    expect(sql).toContain('leads.tenant_id = $2');
    // Terminal states are never touched; already-submitted messages are left
    // for the reconciliation path (no double-send, no retroactive failure).
    expect(sql).toContain(
      "AND message.status IN ('created', 'queued', 'pending', 'scheduled', 'sending')",
    );
    expect(sql).toContain(
      "(message.status <> 'sending' OR message.provider_submission_started_at IS NULL)",
    );
    // Only messages whose owning enrollment is no longer active are canceled;
    // a concurrently-enrolled active sequence keeps its queued messages.
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain("enrollment.status = 'active'");
    expect(sql).toContain("message.idempotency_key LIKE 'sequence:' || enrollment.id || ':%'");
    // AI/manual replies and approved reminders have communication_type !=
    // 'sequence', so they can never match this filter.
    expect(sql).not.toContain("communication_type = 'ai'");
    expect(params[0]).toBe('lead-1');
    expect(params[1]).toBe('tenant-1');
    expect(String(params[3])).toContain('enrollment_stop:reply');

    // Cancellation was audited as a lead event.
    expect(leadEventRepo.save).toHaveBeenCalledTimes(1);
    expect(leadEventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-1',
        eventType: 'sequence_queued_messages_canceled',
      }),
    );
  });

  it('does not audit when no queued sequence messages existed', async () => {
    const manager = {
      getRepository: jest.fn(() => ({
        update: jest.fn().mockResolvedValue({ affected: 0 }),
      })),
      query: jest.fn().mockResolvedValue([]),
    };
    const leadEventRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const { service } = buildService({ manager, leadEventRepo });

    await service.stopForLead('tenant-1', 'lead-1', 'reply');

    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(leadEventRepo.save).not.toHaveBeenCalled();
  });

  it('stopEnrollment (operator path) also cancels queued sequence messages', async () => {
    const enrollment = Object.assign(new SequenceEnrollment(), {
      id: 'enrollment-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      status: 'active',
    });
    const enrollmentRepo = {
      findOne: jest.fn().mockResolvedValue(enrollment),
      update: jest.fn(),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn(() => enrollmentRepo),
      query: jest.fn().mockResolvedValue([{ id: 'msg-seq-9' }]),
    };
    const { service } = buildService({ enrollmentRepo, manager });
    (service as any).requireLeadAccess = jest.fn().mockResolvedValue(undefined);

    const result = await service.stopEnrollment('tenant-1', 'lead-1', 'enrollment-1', 'manual');

    expect(result).toEqual({ ok: true });
    expect(enrollment.status).toBe('stopped');
    expect(manager.query).toHaveBeenCalledTimes(1);
    const [sql] = (manager.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("message.communication_type = 'sequence'");
    expect(sql).toContain("'CANCELLED_BY_ENROLLMENT_STOP'");
  });
});

describe('getSequenceEnrollmentStatus', () => {
  it('returns the enrollment status for the owning tenant and lead', async () => {
    const enrollment = Object.assign(new SequenceEnrollment(), { status: 'stopped' });
    const enrollmentRepo = {
      findOne: jest.fn().mockResolvedValue(enrollment),
    };
    const { service } = buildService({ enrollmentRepo });

    await expect(
      service.getSequenceEnrollmentStatus('tenant-1', 'lead-1', 'enrollment-1'),
    ).resolves.toBe('stopped');
    expect(enrollmentRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'enrollment-1', tenantId: 'tenant-1', leadId: 'lead-1' },
    });
  });

  it('returns null when the enrollment does not exist', async () => {
    const { service } = buildService({
      enrollmentRepo: { findOne: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      service.getSequenceEnrollmentStatus('tenant-1', 'lead-1', 'missing'),
    ).resolves.toBeNull();
  });
});
