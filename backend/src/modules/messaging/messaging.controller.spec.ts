import { ForbiddenException } from '@nestjs/common';
import { MessagingController } from './messaging.controller';

describe('MessagingController shared conversation replies', () => {
  const messagingService = {} as any;
  const inboxSendService = {
    sendSmsToLead: jest.fn(),
    queueEmailToLead: jest.fn(),
  } as any;
  const complianceService = {
    isOptedOut: jest.fn(),
  } as any;
  const settingsService = {} as any;
  const leadRepository = {
    findOne: jest.fn(),
  } as any;

  const controller = new MessagingController(
    messagingService,
    inboxSendService,
    complianceService,
    settingsService,
    leadRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    complianceService.isOptedOut.mockResolvedValue(false);
    inboxSendService.sendSmsToLead.mockResolvedValue({ id: 'message-1' });
  });

  it('allows an unassigned tenant member to reply to a shared conversation', async () => {
    leadRepository.findOne.mockResolvedValue({
      id: 'lead-1',
      tenantId: 'tenant-a',
      assignedToUserId: 'different-user',
      phone: '+15555550100',
      email: 'lead@example.com',
    });

    const req = {
      user: {
        sub: 'agent-1',
        email: 'agent@example.com',
        role: 'agent',
        tenantId: 'tenant-a',
      },
    };

    await expect(
      controller.send(req, {
        leadId: 'lead-1',
        body: 'I can help with that.',
        channel: 'sms',
      }),
    ).resolves.toEqual({ id: 'message-1' });

    expect(leadRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'lead-1', tenantId: 'tenant-a' },
    });
    expect(inboxSendService.sendSmsToLead).toHaveBeenCalledWith(
      'tenant-a',
      'lead-1',
      'I can help with that.',
      expect.objectContaining({ userId: 'agent-1', role: 'agent' }),
    );
  });

  it('refuses a reply when the lead is not found inside the authenticated tenant', async () => {
    leadRepository.findOne.mockResolvedValue(null);

    const req = {
      user: {
        sub: 'agent-1',
        email: 'agent@example.com',
        role: 'agent',
        tenantId: 'tenant-a',
      },
    };

    await expect(
      controller.send(req, {
        leadId: 'lead-from-another-tenant',
        body: 'Hello',
        channel: 'sms',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(leadRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'lead-from-another-tenant', tenantId: 'tenant-a' },
    });
    expect(inboxSendService.sendSmsToLead).not.toHaveBeenCalled();
    expect(inboxSendService.queueEmailToLead).not.toHaveBeenCalled();
  });
});
