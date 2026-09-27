import { ForbiddenException } from '@nestjs/common';
import { of } from 'rxjs';
import {
  OperatorTenantInterceptor,
  OPERATOR_TENANT_REQUIRED_CODE,
} from './operator-tenant.interceptor';

function contextFor(user: Record<string, unknown> | undefined, url: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, url, originalUrl: url, method: 'GET' }),
    }),
  } as any;
}

describe('OperatorTenantInterceptor', () => {
  const interceptor = new OperatorTenantInterceptor();
  const next: any = { handle: () => of('ok') };

  function run(user: Record<string, unknown> | undefined, url: string) {
    let threw: unknown = null;
    let value: unknown = null;
    try {
      interceptor.intercept(contextFor(user, url), next).subscribe((v) => {
        value = v;
      });
    } catch (error) {
      threw = error;
    }
    return { threw, value };
  }

  it('allows unauthenticated requests through (other guards decide)', () => {
    const { threw, value } = run(undefined, '/onboarding');
    expect(threw).toBeNull();
    expect(value).toBe('ok');
  });

  it('allows normal tenant owners on tenant routes with their own tenant', () => {
    const user = { sub: 'u1', email: 'owner@example.com', tenantId: 'tenant-a' };
    const { threw, value } = run(user, '/onboarding');
    expect(threw).toBeNull();
    expect(value).toBe('ok');
  });

  it('fail-closes: super admin without explicit tenant cannot hit tenant routes', () => {
    const user = {
      sub: 'admin1',
      email: 'admin@example.com',
      tenantId: 'operator-own-tenant',
      platformAdmin: true,
      platformRole: 'super_admin',
      platformOperator: true,
    };
    const { threw } = run(user, '/onboarding');
    expect(threw).toBeInstanceOf(ForbiddenException);
    const response = (threw as ForbiddenException).getResponse() as any;
    expect(response.code).toBe(OPERATOR_TENANT_REQUIRED_CODE);
  });

  it('fail-closes: staff operator without explicit tenant cannot hit tenant routes', () => {
    const user = {
      sub: 'staff1',
      email: 'staff@example.com',
      tenantId: 'operator-own-tenant',
      platformAdmin: false,
      platformRole: 'staff',
      platformOperator: true,
    };
    const { threw } = run(user, '/leads');
    expect(threw).toBeInstanceOf(ForbiddenException);
  });

  it('allows super admin without tenant context on /admin routes', () => {
    const user = {
      sub: 'admin1',
      email: 'admin@example.com',
      tenantId: 'operator-own-tenant',
      platformAdmin: true,
      platformRole: 'super_admin',
      platformOperator: true,
    };
    for (const url of ['/admin/overview', '/admin/operator-mode', '/admin/tenants/x/readiness']) {
      const { threw, value } = run(user, url);
      expect(threw).toBeNull();
      expect(value).toBe('ok');
    }
  });

  it('allows super admin without tenant context on /support/admin/* platform routes', () => {
    const user = {
      sub: 'admin1',
      email: 'admin@example.com',
      tenantId: 'operator-own-tenant',
      platformAdmin: true,
      platformRole: 'super_admin',
      platformOperator: true,
    };
    for (const url of [
      '/support/admin/tickets',
      '/support/admin/tickets/abc-123',
      '/support/admin/tickets?status=open',
    ]) {
      const { threw, value } = run(user, url);
      expect(threw).toBeNull();
      expect(value).toBe('ok');
    }
  });

  it('fail-closes: tenant-facing /support/* routes stay blocked without tenant context', () => {
    const user = {
      sub: 'admin1',
      email: 'admin@example.com',
      tenantId: 'operator-own-tenant',
      platformAdmin: true,
      platformRole: 'super_admin',
      platformOperator: true,
    };
    for (const url of [
      '/support/contact',
      '/support/cancellation-request',
      '/support/deletion-request',
    ]) {
      const { threw } = run(user, url);
      expect(threw).toBeInstanceOf(ForbiddenException);
      const response = (threw as ForbiddenException).getResponse() as any;
      expect(response.code).toBe(OPERATOR_TENANT_REQUIRED_CODE);
    }
  });

  it('allows normal tenant users on /support/* tenant routes (unaffected)', () => {
    const user = { sub: 'u1', email: 'owner@example.com', tenantId: 'tenant-a' };
    for (const url of [
      '/support/contact',
      '/support/cancellation-request',
      '/support/deletion-request',
      '/support/admin/tickets',
    ]) {
      const { threw, value } = run(user, url);
      expect(threw).toBeNull();
      expect(value).toBe('ok');
    }
  });

  it('allows super admin without tenant context on /auth and /me', () => {
    const user = {
      sub: 'admin1',
      email: 'admin@example.com',
      tenantId: 'operator-own-tenant',
      platformAdmin: true,
      platformRole: 'super_admin',
      platformOperator: true,
    };
    for (const url of ['/auth/session', '/me', '/me/plan']) {
      const { threw, value } = run(user, url);
      expect(threw).toBeNull();
      expect(value).toBe('ok');
    }
  });

  it('allows operator-mode sessions on tenant routes for the selected tenant', () => {
    const user = {
      sub: 'admin1',
      email: 'admin@example.com',
      // Effective tenant is the explicitly selected one, pinned by the JWT strategy.
      tenantId: 'tenant-b',
      platformAdmin: true,
      platformRole: 'super_admin',
      platformOperator: true,
      operatorMode: {
        tenantId: 'tenant-b',
        tenantName: 'Client B',
        startedByUserId: 'admin1',
        startedByEmail: 'admin@example.com',
        startedAt: new Date().toISOString(),
      },
    };
    const { threw, value } = run(user, '/onboarding');
    expect(threw).toBeNull();
    expect(value).toBe('ok');
  });

  it('allows impersonating sessions on tenant routes (existing flow)', () => {
    const user = {
      sub: 'user9',
      email: 'owner-b@example.com',
      tenantId: 'tenant-b',
      platformAdmin: false,
      platformRole: null,
      platformOperator: false,
      impersonatedBy: { userId: 'admin1', email: 'admin@example.com' },
    };
    const { threw, value } = run(user, '/onboarding');
    expect(threw).toBeNull();
    expect(value).toBe('ok');
  });

  it('never trusts client-supplied tenant IDs: effective tenant comes from the session', () => {
    // The interceptor does not read tenant IDs from params/body/query at all.
    // This test pins the contract: a request carrying a forged tenant id in the
    // URL still resolves tenantId from request.user (set by the JWT strategy).
    const user = {
      sub: 'admin1',
      email: 'admin@example.com',
      tenantId: 'tenant-b',
      platformAdmin: true,
      platformRole: 'super_admin',
      platformOperator: true,
      operatorMode: {
        tenantId: 'tenant-b',
        tenantName: 'Client B',
        startedByUserId: 'admin1',
        startedByEmail: 'admin@example.com',
        startedAt: new Date().toISOString(),
      },
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          url: '/admin/tenants/tenant-evil/readiness',
          originalUrl: '/admin/tenants/tenant-evil/readiness',
          method: 'GET',
          params: { tenantId: 'tenant-evil' },
          body: { tenantId: 'tenant-evil' },
          query: { tenantId: 'tenant-evil' },
        }),
      }),
    } as any;
    let threw: unknown = null;
    let value: unknown = null;
    try {
      interceptor.intercept(ctx, next).subscribe((v) => {
        value = v;
      });
    } catch (error) {
      threw = error;
    }
    expect(threw).toBeNull();
    expect(value).toBe('ok');
    // The session tenant is untouched by the forged IDs.
    expect(user.tenantId).toBe('tenant-b');
  });
});
