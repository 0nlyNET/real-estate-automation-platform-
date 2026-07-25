import { Lead } from '../leads/lead.entity';
import { InboxSendService } from './inbox-send.service';

describe('manual inbox channel handling', () => {
  it('queues an email through the existing worker and switches ownership first', async () => {
    const tenantId = '00000000-0000-4000-8000-000000000001';
    const lead = Object.assign(new Lead(), {
      id: '00000000-0000-4000-8000-000000000010',
      tenantId,
      email: 'lead@example.com',
      fullName: 'Jordan Lead',
    });
    const leads = {
      findOne: jest.fn().mockResolvedValue(lead),
    };
    const messages = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({
        id: '00000000-0000-4000-8000-000000000020',
        createdAt: new Date('2026-07-25T12:00:00.000Z'),
        ...value,
      })),
    };
    const credentials = {
      findOne: jest.fn().mockResolvedValue({
        provider: 'sendgrid',
        encryptedValue: JSON.stringify({
          connected: true,
          apiKey: 'server-side-test-key',
          fromEmail: 'team@example.com',
        }),
      }),
    };
    const compliance = {
      communicationEligibility: jest.fn().mockResolvedValue({ allowed: true }),
    };
    const entitlements = {
      assertAllowed: jest.fn().mockResolvedValue(undefined),
    };
    const runHumanSendExclusive = jest.fn(
      async (_tenantId, _leadId, _actor, callback) => callback(),
    );
    const service = new InboxSendService(
      leads as any,
      messages as any,
      credentials as any,
      compliance as any,
      entitlements as any,
      { createTask: jest.fn() } as any,
      { runHumanSendExclusive } as any,
    );

    await expect(
      service.queueEmailToLead(
        tenantId,
        lead.id,
        'Thanks for your message. I can help personally.',
        {
          userId: '00000000-0000-4000-8000-000000000030',
          role: 'agent',
        },
      ),
    ).resolves.toMatchObject({
      status: 'queued',
      message: {
        channel: 'email',
        authorship: 'human',
      },
    });
    expect(runHumanSendExclusive).toHaveBeenCalledTimes(1);
    expect(messages.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'queued',
        authorship: 'human',
        body: expect.stringContaining('{{unsubscribeUrl}}'),
      }),
    );
  });
});
