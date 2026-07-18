import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';

function contextFor(request: any, statusCode = 200) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode }),
    }),
  } as any;
}

describe('AuditInterceptor', () => {
  it('audits tenant mutations as the acting admin without storing the body', async () => {
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const interceptor = new AuditInterceptor(audit as any);
    const request = {
      method: 'PATCH',
      originalUrl: '/leads/lead-1?view=full',
      body: { password: 'never-store-this' },
      user: {
        sub: 'agent-1',
        tenantId: 'tenant-1',
        role: 'agent',
        email: 'agent@example.com',
        impersonatedBy: { userId: 'admin-1', email: 'admin@example.com' },
      },
    };

    await expect(
      lastValueFrom(
        interceptor.intercept(contextFor(request), { handle: () => of({ ok: true }) }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actorId: 'admin-1',
      actorEmail: 'admin@example.com',
      action: 'PATCH /leads/lead-1',
      method: 'PATCH',
      path: '/leads/lead-1',
      statusCode: 200,
      metadata: {
        subjectUserId: 'agent-1',
        subjectRole: 'agent',
        impersonated: true,
      },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('never-store-this');
  });

  it('does not create audit rows for reads or operational heartbeats', async () => {
    const audit = { record: jest.fn() };
    const interceptor = new AuditInterceptor(audit as any);
    await lastValueFrom(
      interceptor.intercept(
        contextFor({ method: 'GET', user: { tenantId: 'tenant-1', sub: 'user-1' } }),
        { handle: () => of('ok') },
      ),
    );
    await lastValueFrom(
      interceptor.intercept(
        contextFor({
          method: 'POST',
          originalUrl: '/presence/heartbeat',
          user: { tenantId: 'tenant-1', sub: 'user-1' },
        }),
        { handle: () => of('ok') },
      ),
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records an unexpected failed mutation as a server error', async () => {
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const interceptor = new AuditInterceptor(audit as any);
    const request = {
      method: 'POST',
      originalUrl: '/leads',
      user: { tenantId: 'tenant-1', sub: 'user-1', role: 'agent' },
    };

    await expect(
      lastValueFrom(
        interceptor.intercept(contextFor(request, 201), {
          handle: () => throwError(() => new Error('database unavailable')),
        }),
      ),
    ).rejects.toThrow('database unavailable');
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500 }),
    );
  });
});
