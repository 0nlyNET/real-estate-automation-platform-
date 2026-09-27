import { NotFoundException } from '@nestjs/common';
import { ComplianceService } from './compliance.service';

function createService(overrides: {
  lead?: any;
  consent?: any;
  optedOut?: any;
  suppressed?: any;
}) {
  const consentRepo = {
    findOne: jest.fn(async () => overrides.consent ?? null),
  };
  const leadRepo = {
    findOne: jest.fn(async (opts: any) => {
      if (opts?.where?.id === overrides.lead?.id) {
        return opts?.where?.tenantId === overrides.lead?.tenantId
          ? overrides.lead
          : null;
      }
      return null;
    }),
  };
  const optRepo = {
    findOne: jest.fn(async () => overrides.optedOut ?? null),
  };
  const suppressionRepo = {
    findOne: jest.fn(async () => overrides.suppressed ?? null),
  };
  const service = new ComplianceService(
    optRepo as any,
    { create: jest.fn((v) => v), save: jest.fn(async (v) => v) } as any,
    {} as any,
    {} as any,
    consentRepo as any,
    leadRepo as any,
    {} as any,
    suppressionRepo as any,
  );
  return { service, consentRepo, leadRepo, optRepo, suppressionRepo };
}

const providerLead = {
  id: 'lead-1',
  tenantId: 'tenant-1',
  phone: '15555550100',
  email: 'lead@example.com',
};

describe('ComplianceService.leadEligibility', () => {
  it('reports MISSING_AFFIRMATIVE_CONSENT for a provider lead with no consent record', async () => {
    const { service } = createService({ lead: providerLead });
    const result = await service.leadEligibility('tenant-1', 'lead-1');
    expect(result.leadId).toBe('lead-1');
    expect(result.sms).toMatchObject({
      allowed: false,
      code: 'MISSING_AFFIRMATIVE_CONSENT',
    });
    expect(result.email).toMatchObject({
      allowed: false,
      code: 'MISSING_AFFIRMATIVE_CONSENT',
    });
  });

  it('reports allowed after an affirmative consent record is saved', async () => {
    const { service } = createService({
      lead: providerLead,
      consent: {
        status: 'affirmative',
        consentedAt: new Date('2026-09-01T00:00:00Z'),
        source: 'web-form',
        disclosureText: 'I agree to receive automated messages.',
        revokedAt: null,
      },
    });
    const result = await service.leadEligibility('tenant-1', 'lead-1');
    expect(result.sms).toMatchObject({ allowed: true });
    expect(result.email).toMatchObject({ allowed: true });
  });

  it('rejects an unknown lead', async () => {
    const { service } = createService({ lead: providerLead });
    await expect(service.leadEligibility('tenant-1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a lead that belongs to another tenant', async () => {
    const { service, leadRepo } = createService({ lead: providerLead });
    await expect(service.leadEligibility('tenant-2', 'lead-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(leadRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lead-1', tenantId: 'tenant-2' } }),
    );
  });

  it('allows communicationEligibility for a controlled UAT lead with synthetic consent', async () => {
    // Regression for PR #99: the synthetic controlled_uat consent must be
    // well-formed enough that communicationEligibility() returns allowed.
    // A malformed synthetic consent (missing affirmative/source/consentedAt/
    // disclosure) would block the controlled UAT outbound.
    const { service } = createService({
      lead: providerLead,
      consent: {
        status: 'affirmative',
        consentedAt: new Date('2026-09-27T00:00:00Z'),
        source: 'controlled_uat',
        disclosureText:
          'Synthetic controlled UAT recipient explicitly authorized test messages.',
        sourceIdentifier: 'run-1',
        clientAttested: true,
        revokedAt: null,
      },
    });
    const sms = await service.communicationEligibility(
      'tenant-1',
      providerLead,
      'sms',
    );
    const email = await service.communicationEligibility(
      'tenant-1',
      providerLead,
      'email',
    );
    expect(sms).toMatchObject({ allowed: true });
    expect(email).toMatchObject({ allowed: true });
  });

  it('blocks communicationEligibility when synthetic consent is malformed', async () => {
    // Guards the PR #99 fix: if the synthetic consent ever regresses to the
    // malformed shape (e.g. missing disclosure or consentedAt), eligibility
    // must fail closed rather than silently allowing.
    const { service } = createService({
      lead: providerLead,
      consent: {
        status: 'unknown',
        consentedAt: null,
        source: 'controlled_uat',
        disclosureText: null,
        revokedAt: null,
      },
    });
    const sms = await service.communicationEligibility(
      'tenant-1',
      providerLead,
      'sms',
    );
    expect(sms.allowed).toBe(false);
    expect(sms.code).toBe('MISSING_AFFIRMATIVE_CONSENT');
  });

  it('scopes the lead lookup to the requester tenant', async () => {
    const { service, leadRepo } = createService({ lead: providerLead });
    await service.leadEligibility('tenant-1', 'lead-1');
    expect(leadRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lead-1', tenantId: 'tenant-1' } }),
    );
  });
});
