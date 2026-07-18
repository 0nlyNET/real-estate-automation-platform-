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
    const service = new SupportService(repo as any, mail as any);

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
    );

    await expect(service.createTicket(ticketInput())).resolves.toEqual({
      ok: true,
      ticketId: 'ticket-1',
      notificationSent: false,
    });
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

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
