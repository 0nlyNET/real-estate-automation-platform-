import { BadRequestException } from '@nestjs/common';
import { Lead } from '../leads/lead.entity';
import { ComplianceService } from './compliance.service';

function queryBuilder() {
  const builder: any = {
    update: jest.fn(() => builder),
    set: jest.fn(() => builder),
    where: jest.fn(() => builder),
    andWhere: jest.fn(() => builder),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  return builder;
}

describe('channel consent and durable opt-outs', () => {
  const originalSecret = process.env.UNSUBSCRIBE_TOKEN_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
    else process.env.UNSUBSCRIBE_TOKEN_SECRET = originalSecret;
  });

  function setup() {
    const optOuts: any[] = [];
    const consentRows: any[] = [];
    const lead = Object.assign(new Lead(), {
      id: 'lead-1',
      tenantId: 'tenant-1',
      phone: '15555550100',
      email: 'lead@example.com',
    });
    const optRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        optOuts.push(value);
        return { id: `opt-${optOuts.length}`, ...value };
      }),
      findOne: jest.fn(async ({ where }) =>
        optOuts.find(
          (row) =>
            row.tenantId === where.tenantId && row.channel === where.channel && row.value === where.value,
        ) || null,
      ),
    };
    const eventRepo = { create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
    const consentRepo = {
      findOne: jest.fn(async ({ where }) =>
        consentRows.find(
          (row) =>
            row.tenantId === where.tenantId && row.leadId === where.leadId && row.channel === where.channel,
        ) || null,
      ),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        consentRows.push(value);
        return value;
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const leadRepo = {
      find: jest.fn().mockResolvedValue([lead]),
      findOne: jest.fn().mockResolvedValue(lead),
    };
    const messageBuilder = queryBuilder();
    const messageRepo = { createQueryBuilder: jest.fn(() => messageBuilder) };
    const service = new ComplianceService(
      optRepo as any,
      eventRepo as any,
      {} as any,
      {} as any,
      consentRepo as any,
      leadRepo as any,
      messageRepo as any,
    );
    return { service, lead, optOuts, consentRows, consentRepo, messageBuilder };
  }

  it('stores a lead but blocks each channel until sufficient affirmative evidence exists', async () => {
    const { service, lead, consentRows } = setup();
    await expect(service.communicationEligibility('tenant-1', lead, 'sms')).resolves.toMatchObject({
      allowed: false,
      code: 'MISSING_AFFIRMATIVE_CONSENT',
    });

    await service.recordLeadConsent('tenant-1', lead.id, {
      sms: {
        affirmative: true,
        source: 'website form',
        consentedAt: '2026-07-19T12:00:00Z',
        disclosureVersion: 'sms-v1',
      },
    });
    expect(consentRows[0]).toMatchObject({ status: 'affirmative', channel: 'sms' });
    await expect(service.communicationEligibility('tenant-1', lead, 'sms')).resolves.toEqual({
      allowed: true,
    });
    await expect(service.communicationEligibility('tenant-1', lead, 'email')).resolves.toMatchObject({
      allowed: false,
      code: 'MISSING_AFFIRMATIVE_CONSENT',
    });
  });

  it('makes SMS STOP durable, revokes consent, and cancels queued outbound messages', async () => {
    const { service, lead, consentRepo, messageBuilder } = setup();
    await service.addOptOut('tenant-1', 'sms', '+1 (555) 555-0100', 'stop_keyword', 'twilio_webhook');
    await expect(service.communicationEligibility('tenant-1', lead, 'sms')).resolves.toMatchObject({
      allowed: false,
      code: 'RECIPIENT_OPTED_OUT',
    });
    expect(consentRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', channel: 'sms' }),
      expect.objectContaining({ status: 'revoked', revocationSource: 'twilio_webhook' }),
    );
    expect(messageBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled', errorCode: 'RECIPIENT_OPTED_OUT' }),
    );
  });

  it('uses a signed email link and rejects tampering', async () => {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'unsubscribe-secret-for-tests';
    const { service, optOuts } = setup();
    const token = service.createUnsubscribeToken('tenant-1', 'lead-1', 'lead@example.com');
    await expect(service.unsubscribeEmail(token)).resolves.toMatchObject({ ok: true });
    expect(optOuts).toEqual(
      expect.arrayContaining([expect.objectContaining({ channel: 'email', value: 'lead@example.com' })]),
    );
    await expect(service.unsubscribeEmail(`${token}x`)).rejects.toBeInstanceOf(BadRequestException);
  });
});
