import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MessagingController } from './messaging.controller';

function harness(lead: any = null) {
  const messaging = {
    listThreads: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    getThreadMessages: jest.fn().mockResolvedValue({ items: [] }),
  };
  const inbox = {
    queueEmailToLead: jest.fn().mockResolvedValue({ status: 'queued' }),
    sendSmsToLead: jest.fn().mockResolvedValue({ status: 'queued' }),
  };
  const compliance = {
    isOptedOut: jest.fn().mockResolvedValue(false),
  };
  const leads = {
    findOne: jest.fn().mockResolvedValue(lead),
  };
  const controller = new MessagingController(
    messaging as any,
    inbox as any,
    compliance as any,
    {} as any,
    leads as any,
  );
  return { controller, messaging, inbox, compliance, leads };
}

describe('MessagingController client inbox boundaries', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const leadId = '00000000-0000-4000-8000-000000000010';
  const requestId = '00000000-0000-4000-8000-000000000020';

  it('rejects malformed pagination instead of passing NaN to the database', async () => {
    const item = harness();
    await expect(
      item.controller.listThreads(
        { user: { tenantId, sub: 'user-1', role: 'owner' } },
        'shared',
        'not-a-number',
        '0',
        '1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(item.messaging.listThreads).not.toHaveBeenCalled();
  });

  it('passes only the authenticated tenant and bounded page options', async () => {
    const item = harness();
    await item.controller.getThreadMessages(
      { user: { tenantId, sub: 'user-1', role: 'owner' } },
      ` ${leadId} `,
      '25',
      'before-cursor',
      undefined,
      'true',
    );
    expect(item.messaging.getThreadMessages).toHaveBeenCalledWith(
      tenantId,
      leadId,
      { userId: 'user-1', role: 'owner' },
      {
        includeMeta: true,
        take: 25,
        before: 'before-cursor',
        changedAfter: undefined,
      },
    );
  });

  it('rejects a cross-tenant lead before checking recipients or providers', async () => {
    const item = harness(null);
    await expect(
      item.controller.send(
        { user: { tenantId, sub: 'user-1', role: 'owner' } },
        { leadId, body: 'Hello', channel: 'sms', requestId },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(item.leads.findOne).toHaveBeenCalledWith({
      where: { id: leadId, tenantId },
    });
    expect(item.compliance.isOptedOut).not.toHaveBeenCalled();
    expect(item.inbox.sendSmsToLead).not.toHaveBeenCalled();
  });

  it('prevents an unassigned client user from sending in a shared thread', async () => {
    const item = harness({
      id: leadId,
      tenantId,
      phone: '+15555550100',
      assignedToUserId: 'another-user',
    });
    await expect(
      item.controller.send(
        { user: { tenantId, sub: 'user-1', role: 'agent' } },
        { leadId, body: 'Hello', channel: 'sms', requestId },
      ),
    ).rejects.toThrow('Lead is not assigned to this user');
    expect(item.inbox.sendSmsToLead).not.toHaveBeenCalled();
  });

  it('queues one assigned reply through the selected channel with its request id', async () => {
    const lead = {
      id: leadId,
      tenantId,
      email: 'lead@example.com',
      assignedToUserId: 'user-1',
    };
    const item = harness(lead);
    await expect(
      item.controller.send(
        {
          user: {
            tenantId,
            sub: 'user-1',
            email: 'agent@example.com',
            role: 'agent',
          },
        },
        { leadId, body: '  Thanks for the reply.  ', channel: 'email', requestId },
      ),
    ).resolves.toEqual({ status: 'queued' });
    expect(item.inbox.queueEmailToLead).toHaveBeenCalledWith(
      tenantId,
      leadId,
      'Thanks for the reply.',
      {
        userId: 'user-1',
        email: 'agent@example.com',
        role: 'agent',
      },
      requestId,
    );
    expect(item.inbox.sendSmsToLead).not.toHaveBeenCalled();
  });
});
