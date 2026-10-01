import { ForbiddenException } from '@nestjs/common';
import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Message } from '../messaging/message.entity';
import { Tenant } from '../tenants/tenant.entity';
import { TestRun } from '../testing/test-run.entity';
import { WebhooksService } from './webhooks.service';

/**
 * Controlled test-reply correlation for SendGrid inbound email.
 *
 * Regression coverage for the real-world failure where a Gmail reply arrives
 * from the account's base address (kingjs2026@gmail.com) while the outbound
 * was delivered to a plus-addressed variant (kingjs2026+rehearsal3@gmail.com).
 * The exact lead lookup missed, and persistEmailInbound fell into
 * assertLeadAcceptance -> 403 LEAD_INTAKE_NOT_ACTIVE on the TESTING tenant.
 */
describe('SendGrid inbound controlled test-reply correlation', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.SENDGRID_INBOUND_USERNAME = 'sendgrid-inbound';
    process.env.SENDGRID_INBOUND_PASSWORD = 'strong-test-password';
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T12:00:00Z'));
  });

  afterEach(() => {
    process.env = { ...original };
    jest.useRealTimers();
  });

  const TENANT_ID = '00000000-0000-4000-8000-000000000001';
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000002';

  function build(options?: {
    run?: Partial<TestRun> | null;
    runTenantId?: string;
    testLead?: Partial<Lead> | null;
    exactLead?: boolean;
  }) {
    const runSpecified = options && 'run' in options;
    const activeRun = runSpecified
      ? (options?.run as TestRun | null)
      : Object.assign(new TestRun(), {
          id: '11111111-1111-4000-8000-000000000001',
          tenantId: options?.runTenantId || TENANT_ID,
          status: 'running',
          emailRecipient: 'kingjs2026+rehearsal3@gmail.com',
          testLeadId: '00000000-0000-4000-8000-000000000020',
          expiresAt: new Date('2026-10-02T12:00:00Z'),
          createdAt: new Date('2026-10-01T07:00:00Z'),
        });
    const testLead =
      options && 'testLead' in options
        ? (options?.testLead as Lead | null)
        : Object.assign(new Lead(), {
            id: '00000000-0000-4000-8000-000000000020',
            tenantId: TENANT_ID,
            fullName: 'Controlled Test Lead',
            email: 'kingjs2026+rehearsal3@gmail.com',
            sequenceStatus: 'active',
          });
    const exactLead = options?.exactLead
      ? Object.assign(new Lead(), {
          id: '00000000-0000-4000-8000-000000000021',
          tenantId: TENANT_ID,
          fullName: 'Base Address Lead',
          email: 'kingjs2026@gmail.com',
          sequenceStatus: 'active',
        })
      : null;

    const messageRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => Object.assign(new Message(), value)),
      save: jest.fn(async (value) =>
        Object.assign(value, { id: '00000000-0000-4000-8000-000000000030' }),
      ),
    };
    const leadRepo = {
      // Exact lookup misses unless exactLead is set; id lookup serves the
      // correlation path.
      findOne: jest.fn(async (filter: any) => {
        if (filter?.where?.email) return exactLead;
        if (filter?.where?.id)
          return testLead && filter.where.id === testLead.id ? testLead : null;
        return null;
      }),
      create: jest.fn((value) => Object.assign(new Lead(), value)),
      save: jest.fn(async (value) => value),
    };
    const eventRepo = {
      create: jest.fn((value) => Object.assign(new LeadEvent(), value)),
      save: jest.fn(async (value) => value),
    };
    const testRunRepo = {
      findOne: jest.fn(async (filter: any) => {
        if (!activeRun) return null;
        if (filter?.where?.tenantId && filter.where.tenantId !== activeRun.tenantId)
          return null;
        if (filter?.where?.status && filter.where.status !== activeRun.status)
          return null;
        return activeRun;
      }),
    };
    const tenantRepo = {
      findOne: jest.fn(async () =>
        Object.assign(new Tenant(), {
          id: TENANT_ID,
          lifecycleStatus: 'TESTING',
        }),
      ),
    };
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity) => {
        if (entity === Message) return messageRepo;
        if (entity === Lead) return leadRepo;
        if (entity === LeadEvent) return eventRepo;
        if (entity === TestRun) return testRunRepo;
        if (entity === Tenant) return tenantRepo;
        throw new Error(`Unexpected repository: ${entity?.name}`);
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
      getRepository: jest.fn((entity) => {
        if (entity === Lead) return leadRepo;
        throw new Error(`Unexpected repository: ${entity?.name}`);
      }),
    };
    const credentials = {
      findOne: jest.fn().mockResolvedValue({
        provider: 'sendgrid',
        routingKey: 'replies@staging-reply.realtytechai.app',
        encryptedValue: JSON.stringify({
          connected: true,
          error: null,
          inboundAddress:
            '6od8vbpgevoeczfado8hzkaf@staging-reply.realtytechai.app',
        }),
        tenant: { id: TENANT_ID },
      }),
      find: jest.fn(),
    };
    const compliance = {
      isStopKeyword: jest.fn().mockReturnValue(false),
      addOptOut: jest.fn().mockResolvedValue({ id: 'opt-out-1' }),
    };
    const sequences = { stopForLead: jest.fn().mockResolvedValue(undefined) };
    const ai = { acceptInbound: jest.fn().mockResolvedValue({ status: 'queued' }) };
    const service = new WebhooksService(
      dataSource as any,
      credentials as any,
      compliance as any,
      sequences as any,
      { intake: jest.fn() } as any,
      ai as any,
      undefined,
      { createTask: jest.fn() } as any,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    return { service, messageRepo, leadRepo, testRunRepo, testLead, activeRun };
  }

  function authorization() {
    return `Basic ${Buffer.from('sendgrid-inbound:strong-test-password').toString('base64')}`;
  }

  function body(from: string) {
    return {
      from,
      envelope: JSON.stringify({
        to: ['6od8vbpgevoeczfado8hzkaf@staging-reply.realtytechai.app'],
      }),
      subject: 'Re: Follow-up',
      text: 'Still interested in Elmwood Village.',
      headers: 'Message-ID: <reply-456@gmail.com>\r\n',
    };
  }

  async function responseCode(promise: Promise<unknown>) {
    try {
      await promise;
      return null;
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      return (error as ForbiddenException).getResponse();
    }
  }

  it('correlates a base-address reply to the active run plus-addressed lead', async () => {
    const item = build();
    await expect(
      item.service.handleSendGridInbound(
        body('kingjs2026@gmail.com'),
        authorization(),
      ),
    ).resolves.toEqual({ status: 'ok' });
    // No new lead created from the unmatched sender.
    expect(item.leadRepo.create).not.toHaveBeenCalled();
    // The inbound message is stored against the run's test lead.
    expect(item.messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: '00000000-0000-4000-8000-000000000020',
        direction: 'inbound',
      }),
    );
    expect(item.testRunRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT_ID, status: 'running' }),
      }),
    );
  });

  it('correlates when the sender carries the plus tag and the recipient is the base address', async () => {
    const run = Object.assign(new TestRun(), {
      id: '11111111-1111-4000-8000-000000000001',
      tenantId: TENANT_ID,
      status: 'running',
      emailRecipient: 'kingjs2026@gmail.com',
      testLeadId: '00000000-0000-4000-8000-000000000020',
      expiresAt: new Date('2026-10-02T12:00:00Z'),
      createdAt: new Date('2026-10-01T07:00:00Z'),
    });
    const item = build({ run });
    await expect(
      item.service.handleSendGridInbound(
        body('kingjs2026+rehearsal3@gmail.com'),
        authorization(),
      ),
    ).resolves.toEqual({ status: 'ok' });
    expect(item.messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: '00000000-0000-4000-8000-000000000020',
      }),
    );
  });

  it('keeps the exact-match path untouched when a lead already exists', async () => {
    const item = build({ exactLead: true });
    await expect(
      item.service.handleSendGridInbound(
        body('kingjs2026@gmail.com'),
        authorization(),
      ),
    ).resolves.toEqual({ status: 'ok' });
    expect(item.testRunRepo.findOne).not.toHaveBeenCalled();
    expect(item.messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: '00000000-0000-4000-8000-000000000021',
      }),
    );
  });

  it('still returns 403 LEAD_INTAKE_NOT_ACTIVE when the run has expired', async () => {
    const run = Object.assign(new TestRun(), {
      id: '11111111-1111-4000-8000-000000000001',
      tenantId: TENANT_ID,
      status: 'running',
      emailRecipient: 'kingjs2026+rehearsal3@gmail.com',
      testLeadId: '00000000-0000-4000-8000-000000000020',
      expiresAt: new Date('2026-10-01T11:00:00Z'),
      createdAt: new Date('2026-09-30T07:00:00Z'),
    });
    const item = build({ run });
    const response = await responseCode(
      item.service.handleSendGridInbound(
        body('kingjs2026@gmail.com'),
        authorization(),
      ),
    );
    expect(response).toEqual(
      expect.objectContaining({ code: 'LEAD_INTAKE_NOT_ACTIVE' }),
    );
    expect(item.messageRepo.save).not.toHaveBeenCalled();
  });

  it('still returns 403 LEAD_INTAKE_NOT_ACTIVE with no active run', async () => {
    const item = build({ run: null });
    const response = await responseCode(
      item.service.handleSendGridInbound(
        body('kingjs2026@gmail.com'),
        authorization(),
      ),
    );
    expect(response).toEqual(
      expect.objectContaining({ code: 'LEAD_INTAKE_NOT_ACTIVE' }),
    );
  });

  it('still returns 403 for an unrelated sender while a run is active', async () => {
    const item = build();
    const response = await responseCode(
      item.service.handleSendGridInbound(
        body('attacker@example.com'),
        authorization(),
      ),
    );
    expect(response).toEqual(
      expect.objectContaining({ code: 'LEAD_INTAKE_NOT_ACTIVE' }),
    );
    expect(item.messageRepo.save).not.toHaveBeenCalled();
  });

  it('still returns 403 when the same local part uses a different domain', async () => {
    const item = build();
    const response = await responseCode(
      item.service.handleSendGridInbound(
        body('kingjs2026@otherdomain.com'),
        authorization(),
      ),
    );
    expect(response).toEqual(
      expect.objectContaining({ code: 'LEAD_INTAKE_NOT_ACTIVE' }),
    );
  });

  it('still returns 403 for a cross-tenant inbound when the run belongs to another tenant', async () => {
    const item = build({ runTenantId: OTHER_TENANT_ID });
    const response = await responseCode(
      item.service.handleSendGridInbound(
        body('kingjs2026@gmail.com'),
        authorization(),
      ),
    );
    expect(response).toEqual(
      expect.objectContaining({ code: 'LEAD_INTAKE_NOT_ACTIVE' }),
    );
    expect(item.messageRepo.save).not.toHaveBeenCalled();
  });

  it('still returns 403 when the run lead belongs to a different tenant', async () => {
    const foreignLead = Object.assign(new Lead(), {
      id: '00000000-0000-4000-8000-000000000020',
      tenantId: OTHER_TENANT_ID,
      email: 'kingjs2026+rehearsal3@gmail.com',
    });
    const item = build({ testLead: foreignLead });
    const response = await responseCode(
      item.service.handleSendGridInbound(
        body('kingjs2026@gmail.com'),
        authorization(),
      ),
    );
    expect(response).toEqual(
      expect.objectContaining({ code: 'LEAD_INTAKE_NOT_ACTIVE' }),
    );
    expect(item.messageRepo.save).not.toHaveBeenCalled();
  });

  it('does not correlate a bare plus tag with an empty base', async () => {
    const run = Object.assign(new TestRun(), {
      id: '11111111-1111-4000-8000-000000000001',
      tenantId: TENANT_ID,
      status: 'running',
      emailRecipient: '+rehearsal3@gmail.com',
      testLeadId: '00000000-0000-4000-8000-000000000020',
      expiresAt: new Date('2026-10-02T12:00:00Z'),
      createdAt: new Date('2026-10-01T07:00:00Z'),
    });
    const item = build({ run });
    const response = await responseCode(
      item.service.handleSendGridInbound(
        body('kingjs2026@gmail.com'),
        authorization(),
      ),
    );
    expect(response).toEqual(
      expect.objectContaining({ code: 'LEAD_INTAKE_NOT_ACTIVE' }),
    );
  });
});
