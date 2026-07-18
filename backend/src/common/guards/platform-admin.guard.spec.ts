import { ForbiddenException } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';

function contextFor(user: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('PlatformAdminGuard', () => {
  const original = process.env.PLATFORM_ADMIN_EMAILS;

  afterEach(() => {
    if (original === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = original;
  });

  it('requires both a signed claim and a current allow-list match', () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'admin@example.com';
    const guard = new PlatformAdminGuard();
    expect(guard.canActivate(contextFor({ platformAdmin: true, email: 'ADMIN@example.com' }))).toBe(true);
    expect(() => guard.canActivate(contextFor({ platformAdmin: false, email: 'admin@example.com' })))
      .toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor({ platformAdmin: true, email: 'other@example.com' })))
      .toThrow(ForbiddenException);
  });
});
