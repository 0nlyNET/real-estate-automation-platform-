import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PublicController } from './public.controller';
import { PublicInquiryDto } from './public.dto';
import { PublicService } from './public.service';

describe('public client applications', () => {
  const originalInbox = process.env.SALES_INBOX_EMAIL;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalInbox === undefined) delete process.env.SALES_INBOX_EMAIL;
    else process.env.SALES_INBOX_EMAIL = originalInbox;
  });

  it('persists before notification and returns success when both emails fail', async () => {
    process.env.SALES_INBOX_EMAIL = 'operations@example.com';
    const saves: any[] = [];
    const applications = {
      create: jest.fn((value) => ({ id: 'application-1', ...value })),
      save: jest.fn(async (value) => {
        saves.push({ ...value });
        return value;
      }),
    };
    const mail = { sendEmail: jest.fn().mockRejectedValue(new Error('provider unavailable')) };
    const operations = { createTask: jest.fn().mockResolvedValue({ id: 'task-1' }) };
    const notifications = { createForPlatform: jest.fn().mockResolvedValue([]) };
    const service = new PublicService(
      applications as any,
      mail as any,
      operations as any,
      notifications as any,
    );

    await expect(
      service.submitInquiry({
        name: 'Jordan Client',
        email: 'JORDAN@example.com',
        message: 'We need a supervised pilot.',
      }),
    ).resolves.toEqual({
      ok: true,
      received: true,
      applicationId: 'application-1',
      message:
        'Your application was received. Our team will review it and contact you using the information provided.',
    });

    expect(saves[0]).toMatchObject({ email: 'jordan@example.com', notificationStatus: 'pending' });
    expect(saves[saves.length - 1]).toMatchObject({ notificationStatus: 'failed' });
    expect(operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'application_notification_failure', priority: 'high' }),
    );
    expect(notifications.createForPlatform).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'lead.application_received',
        deduplicationKey: 'application:application-1',
      }),
    );
  });

  it('rejects malformed email, phone, website, lead volume, and blank message', async () => {
    const dto = plainToInstance(PublicInquiryDto, {
      email: 'not-an-email',
      phone: 'abc',
      website: 'javascript:alert(1)',
      estimatedMonthlyLeadVolume: -1,
      message: '   ',
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['email', 'phone', 'website', 'estimatedMonthlyLeadVolume', 'message']),
    );
  });

  it('silently absorbs the honeypot without creating an application', async () => {
    const pub = { submitInquiry: jest.fn() };
    const controller = new PublicController(pub as any);
    await expect(
      controller.inquiry({
        email: 'bot@example.com',
        message: 'spam',
        websiteConfirmation: 'filled-by-bot',
      }),
    ).resolves.toEqual({ ok: true, received: true });
    expect(pub.submitInquiry).not.toHaveBeenCalled();
  });
});
