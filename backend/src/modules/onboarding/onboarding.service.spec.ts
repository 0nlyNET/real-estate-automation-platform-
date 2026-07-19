import { BadRequestException } from '@nestjs/common';
import { OnboardingRecord } from './onboarding-record.entity';
import { OnboardingService } from './onboarding.service';

describe('operator-controlled workspace activation', () => {
  it('returns explicit blockers and cannot be completed by client-entered fields alone', async () => {
    const record = Object.assign(new OnboardingRecord(), {
      id: 'onboarding-1',
      tenantId: 'tenant-1',
      businessIdentity: {},
      contacts: {},
      serviceScope: {},
      leadHandling: {},
      brandCommunication: {},
      consentConfiguration: {},
      integrationConfiguration: {},
      providerTests: {},
      verifiedItems: {},
      smsEnabled: false,
      emailEnabled: false,
      bookingEnabled: false,
      activationStatus: 'incomplete',
    });
    const records = {
      findOne: jest.fn().mockResolvedValue(record),
      create: jest.fn((value) => Object.assign(new OnboardingRecord(), value)),
      save: jest.fn(async (value) => value),
    };
    const tenants = {
      findOne: jest.fn().mockResolvedValue({
        id: 'tenant-1',
        name: 'Lakeview Realty',
        status: 'active',
        lifecycleStatus: 'ONBOARDING',
      }),
      manager: { transaction: jest.fn() },
    };
    const settings = { findOne: jest.fn().mockResolvedValue({ tenantId: 'tenant-1', automationsEnabled: false }) };
    const stepsBuilder: any = {};
    for (const method of ['innerJoin', 'where', 'andWhere', 'select', 'addSelect', 'groupBy']) {
      stepsBuilder[method] = jest.fn(() => stepsBuilder);
    }
    stepsBuilder.getRawMany = jest.fn().mockResolvedValue([]);
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
    const service = new OnboardingService(
      records as any,
      tenants as any,
      settings as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      { createQueryBuilder: jest.fn(() => stepsBuilder) } as any,
      operations as any,
    );

    const readiness = await service.readiness('tenant-1');
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        'business_identity',
        'contacts',
        'consent_policy',
        'test_lead',
        'provider_rejection',
        'client_approval',
        'operator_approval',
        'billing_evidence',
      ]),
    );
    await expect(service.activate('tenant-1', 'operator-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tenants.manager.transaction).not.toHaveBeenCalled();
    expect(record.activationStatus).toBe('blocked');
    expect(operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'missing_client_information' }),
    );

    await service.recordOperatorEvidence(
      'tenant-1',
      {
        clientApprovedAt: '2026-07-19T12:00:00Z',
        clientApprovalEvidence: 'signed approval record',
      },
      'operator-1',
    );
    expect(operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'launch_approval' }),
    );
  });
});
