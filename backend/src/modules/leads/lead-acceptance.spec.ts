import { ForbiddenException } from '@nestjs/common';
import { assertLeadAcceptance } from './lead-acceptance';

describe('assertLeadAcceptance', () => {
  it.each(['DRAFT', 'ONBOARDING', 'TESTING', 'PAUSED', 'SUSPENDED', 'CANCELED'])(
    'rejects a real lead while the tenant is %s',
    (lifecycleStatus) => {
      expect(() =>
        assertLeadAcceptance(
          { id: 'tenant-1', lifecycleStatus } as any,
          { source: 'public_webhook' },
        ),
      ).toThrow(ForbiddenException);
    },
  );

  it('allows a real lead only while ACTIVE', () => {
    expect(() =>
      assertLeadAcceptance(
        { id: 'tenant-1', lifecycleStatus: 'ACTIVE' } as any,
        { source: 'manual' },
      ),
    ).not.toThrow();
  });

  it('allows only a run-bound controlled lead while TESTING', () => {
    expect(() =>
      assertLeadAcceptance(
        { id: 'tenant-1', lifecycleStatus: 'TESTING' } as any,
        {
          source: 'controlled_uat',
          controlledTest: true,
          testRunId: 'run-1',
        },
      ),
    ).not.toThrow();
    expect(() =>
      assertLeadAcceptance(
        { id: 'tenant-1', lifecycleStatus: 'TESTING' } as any,
        { source: 'controlled_uat', controlledTest: true },
      ),
    ).toThrow(ForbiddenException);
  });
});


describe('retained external intake', () => {
  it.each(['PAUSED', 'SUSPENDED'])('retains launched %s intake without permitting manual creation', (lifecycleStatus) => {
    const tenant = { id: 'tenant-1', lifecycleStatus, serviceActivatedAt: new Date() } as any;
    expect(() => assertLeadAcceptance(tenant, { source: 'external', retainDuringPause: true })).not.toThrow();
    expect(() => assertLeadAcceptance(tenant, { source: 'manual' })).toThrow(ForbiddenException);
  });
  it.each([
    { lifecycleStatus: 'PAUSED' },
    { lifecycleStatus: 'SUSPENDED', servicePreviousLifecycleStatus: 'TESTING' },
    { lifecycleStatus: 'SUSPENDED', serviceActivatedAt: new Date(), serviceSuspensionSource: 'offboarding' },
    { lifecycleStatus: 'CANCELED', serviceActivatedAt: new Date() },
  ])('does not admit unlaunched/offboarded/canceled workspaces', (tenant) => {
    expect(() => assertLeadAcceptance({ id: 'tenant-1', ...tenant } as any,
      { source: 'external', retainDuringPause: true })).toThrow(ForbiddenException);
  });
  it('never treats controlled test requests as live retained intake', () => {
    expect(() => assertLeadAcceptance({ id: 'tenant-1', lifecycleStatus: 'PAUSED', serviceActivatedAt: new Date() } as any,
      { source: 'external', controlledTest: true, testRunId: 'run', retainDuringPause: true })).toThrow(ForbiddenException);
  });
});
