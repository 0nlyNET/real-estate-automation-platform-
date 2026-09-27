import { AuthController } from './auth.controller';

describe('AuthController GET /auth/session operator context', () => {
  // The AuthService is not used by the session() method, so we pass a stub.
  const controller = new AuthController({} as any);

  function sessionFor(user: any) {
    return controller.session({ user });
  }

  it('returns null operatorMode and false operatorTenantRequired for a normal tenant user', () => {
    const result = sessionFor({
      sub: 'user-1',
      tenantId: 'tenant-1',
      role: 'owner',
      email: 'owner@example.com',
      platformAdmin: false,
      platformOperator: false,
    });
    expect(result.operatorMode).toBeNull();
    expect(result.operatorTenantRequired).toBe(false);
  });

  it('requires tenant selection for a platform operator with no selected tenant', () => {
    const result = sessionFor({
      sub: 'op-1',
      tenantId: null,
      role: 'admin',
      email: 'op@example.com',
      platformAdmin: true,
      platformRole: 'owner',
    });
    expect(result.operatorMode).toBeNull();
    expect(result.operatorTenantRequired).toBe(true);
  });

  it('returns the exact signed operator tenant context and does not require selection', () => {
    const operatorMode = {
      tenantId: 'tenant-abc',
      tenantName: 'Acme Realty',
      enteredAt: '2026-09-27T00:00:00.000Z',
    };
    const result = sessionFor({
      sub: 'op-1',
      tenantId: 'tenant-abc',
      role: 'admin',
      email: 'op@example.com',
      platformAdmin: true,
      platformRole: 'owner',
      operatorMode,
    });
    expect(result.operatorMode).toEqual(operatorMode);
    expect(result.operatorTenantRequired).toBe(false);
  });

  it('does not demand another tenant selection for an impersonated tenant session', () => {
    const result = sessionFor({
      sub: 'op-1',
      tenantId: 'tenant-xyz',
      role: 'admin',
      email: 'op@example.com',
      platformAdmin: true,
      impersonatedBy: 'platform-owner-1',
    });
    expect(result.operatorMode).toBeNull();
    // Impersonation is an explicit tenant context, so no further selection is required.
    expect(result.operatorTenantRequired).toBe(false);
    expect(result.impersonated).toBe(true);
  });

  it('never accepts tenant context from client-supplied values — only req.user is used', () => {
    // Even if a malicious client smuggles tenant fields onto the request object
    // outside of req.user (query/body), session() must ignore them.
    const req: any = {
      user: {
        sub: 'op-1',
        tenantId: null,
        role: 'admin',
        email: 'op@example.com',
        platformAdmin: true,
      },
      query: { tenantId: 'attacker-tenant', operatorMode: { tenantId: 'attacker-tenant' } },
      body: { tenantId: 'attacker-tenant', operatorMode: { tenantId: 'attacker-tenant' } },
    };
    const result = controller.session(req);
    expect(result.operatorMode).toBeNull();
    expect(result.tenantId).toBeNull();
    expect(result.operatorTenantRequired).toBe(true);
  });
});
