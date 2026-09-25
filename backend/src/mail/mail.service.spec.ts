import { MailService } from './mail.service';

describe('MailService email provider status', () => {
  const originalApiKey = process.env.SENDGRID_API_KEY;
  const originalFrom = process.env.SENDGRID_FROM_EMAIL;

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = originalApiKey;
    if (originalFrom === undefined) delete process.env.SENDGRID_FROM_EMAIL;
    else process.env.SENDGRID_FROM_EMAIL = originalFrom;
  });

  it('reports not configured when the API key is missing', async () => {
    delete process.env.SENDGRID_API_KEY;
    const service = new MailService();
    await expect(service.emailProviderStatus()).resolves.toEqual({
      configured: false,
      reason: 'SENDGRID_API_KEY missing',
    });
  });

  it('reports not configured when the from address is missing', async () => {
    process.env.SENDGRID_API_KEY = 'test-key';
    delete process.env.SENDGRID_FROM_EMAIL;
    const service = new MailService();
    await expect(service.emailProviderStatus()).resolves.toEqual({
      configured: false,
      reason: 'SENDGRID_FROM_EMAIL missing',
    });
  });

  it('reports configured when key and from address are set', async () => {
    process.env.SENDGRID_API_KEY = 'test-key';
    process.env.SENDGRID_FROM_EMAIL = 'ops@example.com';
    const service = new MailService();
    await expect(service.emailProviderStatus()).resolves.toEqual({
      configured: true,
      apiKey: 'test-key',
    });
  });

  it('sendEmail surfaces the missing-config reason without attempting a send', async () => {
    delete process.env.SENDGRID_API_KEY;
    const service = new MailService();
    await expect(
      service.sendEmail({ to: 'a@example.com', subject: 's', text: 't' }),
    ).rejects.toThrow('SENDGRID_API_KEY missing');
  });
});
