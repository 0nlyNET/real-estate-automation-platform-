import { SupportService } from './support.service';

describe('SupportService notifications', () => {
  const originalInbox = process.env.SALES_INBOX_EMAIL;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalInbox === undefined) delete process.env.SALES_INBOX_EMAIL;
    else process.env.SALES_INBOX_EMAIL = originalInbox;
  });

  it('persists the ticket and notifies the operator inbox', async () => {
    process.env.SALES_INBOX_EMAIL = 'ops@realtytechai.app';
    const repo = repository();
    const mail = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const notifications = { createForPlatform: jest.fn().mockResolvedValue([]) };
    const service = new SupportService(
      repo as any,
      mail as any,
      { createTask: jest.fn().mockResolvedValue({ id: 'task-1' }) } as any,
      notifications as any,
    );

    await expect(service.createTicket(ticketInput())).resolves.toEqual({
      ok: true,
      ticketId: 'ticket-1',
      notificationSent: true,
    });
    expect(mail.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ops@realtytechai.app',
        subject: '[RealtyTechAI support] Workspace deletion request',
      }),
    );
    expect(notifications.createForPlatform).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'support.ticket_created',
        entityId: 'ticket-1',
      }),
    );
  });

  it('keeps the ticket when email delivery is unavailable', async () => {
    process.env.SALES_INBOX_EMAIL = 'ops@realtytechai.app';
    const repo = repository();
    const service = new SupportService(
      repo as any,
      {
        sendEmail: jest
          .fn()
          .mockRejectedValue(new Error('provider unavailable')),
      } as any,
      { createTask: jest.fn().mockResolvedValue({ id: 'task-1' }) } as any,
    );

    await expect(service.createTicket(ticketInput())).resolves.toEqual({
      ok: true,
      ticketId: 'ticket-1',
      notificationSent: false,
    });
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it.each(['cancellation', 'deletion'] as const)(
    'creates durable operations work for a %s request',
    async (kind) => {
      const operations = {
        createTask: jest
          .fn()
          .mockResolvedValueOnce({ id: 'primary-task', title: `${kind} request`, description: 'saved' })
          .mockResolvedValue({ id: 'follow-up' }),
      };
      const service = new SupportService(
        repository() as any,
        { sendEmail: jest.fn().mockRejectedValue(new Error('mail unavailable')) } as any,
        operations as any,
      );
      await expect(
        service.createAccountRequest({
          tenantId: 'tenant-1',
          userId: 'user-1',
          email: 'owner@example.com',
          kind,
        }),
      ).resolves.toMatchObject({ ok: true, requestId: 'primary-task' });
      expect(operations.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          category: kind === 'cancellation' ? 'cancellation_request' : 'deletion_request',
          priority: 'high',
        }),
      );
      expect(operations.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'provider_disable_follow_up' }),
      );
    },
  );

  function repository() {
    return {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'ticket-1', ...value })),
    };
  }

  function ticketInput() {
    return {
      tenantId: 'tenant-1',
      userId: 'user-1',
      email: 'owner@example.com',
      subject: 'Workspace deletion request',
      message: 'Please delete this workspace after verification.',
    };
  }
});
