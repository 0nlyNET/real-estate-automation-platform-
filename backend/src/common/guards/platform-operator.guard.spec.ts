import { ForbiddenException } from '@nestjs/common';
import { PlatformOperatorGuard } from './platform-operator.guard';

describe('PlatformOperatorGuard', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  function context(user: any) {
    return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as any;
  }

  it('allows configured staff and rejects a forged platform role', () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'owner@example.com';
    process.env.PLATFORM_STAFF_EMAILS = 'staff@example.com';
    const guard = new PlatformOperatorGuard();
    expect(guard.canActivate(context({ email: 'staff@example.com', platformRole: 'staff', platformOperator: true }))).toBe(true);
    expect(() => guard.canActivate(context({ email: 'client@example.com', platformRole: 'staff', platformOperator: false })))
      .toThrow(ForbiddenException);
  });
});
