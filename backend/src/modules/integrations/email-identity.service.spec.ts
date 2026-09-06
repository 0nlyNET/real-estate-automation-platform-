import { EmailIdentityService } from './email-identity.service';

describe('EmailIdentityService sender isolation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SENDGRID_SENDING_DOMAIN = 'send.example.com';
    process.env.SENDGRID_REPLY_DOMAIN = 'reply.example.com';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('keeps a verified identity unchanged across service instances and requires testing after an edit', async () => {
    const identity: any = { tenantId: 'tenant-1', fromEmail: 'owner@client.example', fromName: 'Client',
      inboundAddress: 'token@reply.example.com', signature: null, emailStatus: 'ready', lastVerifiedAt: new Date() };
    const repository = { findOne: jest.fn(async () => identity), save: jest.fn(async (row) => row),
      update: jest.fn(async (_where, patch) => Object.assign(identity, patch)) };
    const service = new EmailIdentityService(repository as any, {} as any);
    const verified = identity.lastVerifiedAt;
    await service.provisionTenant('tenant-1', { fromEmail: identity.fromEmail, fromName: identity.fromName });
    await new EmailIdentityService(repository as any, {} as any).provisionTenant('tenant-1');
    expect(repository.save).not.toHaveBeenCalled();
    expect(identity.lastVerifiedAt).toBe(verified);
    await service.provisionTenant('tenant-1', { fromEmail: 'new@client.example' });
    expect(identity).toMatchObject({ fromEmail: 'new@client.example', emailStatus: 'testing', lastVerifiedAt: null });
    await service.markFailed('tenant-1', new Error('SendGrid rejected the sender'));
    expect(identity).toMatchObject({ emailStatus: 'failed', lastError: 'SendGrid rejected the sender' });
    await service.markVerified('tenant-1');
    expect(identity).toMatchObject({ emailStatus: 'ready', lastError: null });
  });

  it('rejects reply routing to an unrelated email domain', async () => {
    const service = new EmailIdentityService({ findOne: async () => null } as any, {} as any);
    await expect(service.provisionTenant('tenant-1', { inboundAddress: 'other@attacker.example' })).rejects.toThrow('configured inbound email domain');
  });

  it('creates collision-safe identities for tenants with the same name', async () => {
    const rows: any[] = [];
    const identities = {
      findOne: jest.fn(async ({ where }) =>
        rows.find((row) => row.tenantId === where.tenantId) || null,
      ),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        const saved = { id: `identity-${rows.length + 1}`, ...value };
        rows.push(saved);
        return saved;
      }),
    };
    const tenants: Record<string, any> = {
      '11111111-1111-4111-8111-111111111111': {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Sunset Realty',
      },
      '22222222-2222-4222-8222-222222222222': {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Sunset Realty',
      },
    };
    const service = new EmailIdentityService(
      identities as any,
      {
        findOne: jest.fn(async ({ where }) => tenants[where.id] || null),
      } as any,
    );

    const first = await service.provisionTenant(
      '11111111-1111-4111-8111-111111111111',
    );
    const second = await service.provisionTenant(
      '22222222-2222-4222-8222-222222222222',
    );

    expect(first.fromEmail).toBe('sunset-realty-11111111@send.example.com');
    expect(second.fromEmail).toBe('sunset-realty-22222222@send.example.com');
    expect(first.fromEmail).not.toBe(second.fromEmail);
    expect(first.inboundAddress).not.toBe(second.inboundAddress);
  });
});
