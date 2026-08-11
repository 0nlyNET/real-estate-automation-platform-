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
