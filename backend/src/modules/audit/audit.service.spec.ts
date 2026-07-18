import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('stores sanitized metadata and a normalized actor email', async () => {
    const repository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'audit-1', ...value })),
    };
    const service = new AuditService(repository as any);

    await service.record({
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      actorEmail: ' Admin@Example.com ',
      action: 'PATCH /leads/lead-1',
      method: 'PATCH',
      path: '/leads/lead-1',
      statusCode: 200,
      metadata: { leadId: 'lead-1', access_token: 'secret' },
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorEmail: 'admin@example.com',
        metadata: { leadId: 'lead-1', access_token: '[REDACTED]' },
      }),
    );
  });

  it('lists only the requested tenant with bounded pagination', async () => {
    const repository = { find: jest.fn().mockResolvedValue([]) };
    const service = new AuditService(repository as any);
    await service.listForTenant('tenant-1', 10_000, -10);
    expect(repository.find).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      order: { createdAt: 'DESC' },
      take: 250,
      skip: 0,
    });
  });
});
