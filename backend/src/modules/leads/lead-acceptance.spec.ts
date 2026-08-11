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
