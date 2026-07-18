import { DataExportService } from './data-export.service';

describe('DataExportService', () => {
  it('exports client data without password hashes, provider secrets, or Stripe identifiers', async () => {
    const tenant = {
      id: 'tenant-1',
      name: 'Lakeview Realty',
      plan: 'pro',
      status: 'active',
      billingInterval: 'month',
      stripeCustomerId: 'cus_secret',
      stripeSubscriptionId: 'sub_secret',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };
    const user = {
      id: 'user-1',
      email: 'owner@example.com',
      role: 'owner',
      teamId: null,
      isActive: true,
      isEmailVerified: true,
      passwordHash: 'password-secret',
      emailVerifyToken: 'verify-secret',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };
    const settings = {
      timeZone: 'America/New_York',
      quietHoursStart: '21:00',
      quietHoursEnd: '08:00',
      bookingLink: 'https://calendly.com/lakeview',
      automationsEnabled: true,
      roundRobinEnabled: false,
      roundRobinTeamId: null,
      leadSource: 'website_form',
      sendgridApiKeyEnc: 'sendgrid-secret',
      twilioAuthTokenEnc: 'twilio-secret',
      intakeApiKeyHash: 'intake-secret',
    };

    const one = (value: unknown) => ({
      findOne: jest.fn().mockResolvedValue(value),
    });
    const many = (value: unknown[] = []) => ({
      find: jest.fn().mockResolvedValue(value),
    });
    const service = new DataExportService(
      one(tenant) as any,
      many([user]) as any,
      many() as any,
      many() as any,
      many() as any,
      many() as any,
      many() as any,
      many() as any,
      one(null) as any,
      one(settings) as any,
      many() as any,
      many() as any,
      {
        list: jest
          .fn()
          .mockResolvedValue([{ provider: 'twilio', connected: false }]),
      } as any,
    );

    const exported = await service.exportWorkspace('tenant-1');
    expect(exported.workspace).toMatchObject({
      name: 'Lakeview Realty',
      plan: 'pro',
    });
    expect(exported.users).toEqual([
      expect.objectContaining({ email: 'owner@example.com', role: 'owner' }),
    ]);
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain('password-secret');
    expect(serialized).not.toContain('verify-secret');
    expect(serialized).not.toContain('sendgrid-secret');
    expect(serialized).not.toContain('twilio-secret');
    expect(serialized).not.toContain('intake-secret');
    expect(serialized).not.toContain('cus_secret');
    expect(serialized).not.toContain('sub_secret');
  });
});
