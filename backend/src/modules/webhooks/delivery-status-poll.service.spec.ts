import { Message } from '../messaging/message.entity';
import { DeliveryStatusPollService } from './delivery-status-poll.service';

describe('DeliveryStatusPollService', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  function makeMessage(
    overrides: Partial<Message> = {},
  ): Message {
    return Object.assign(new Message(), {
      id: 'message-1',
      providerMessageId: 'sendgrid:sg-msg-id-1',
      status: 'provider_accepted',
      channel: 'email',
      direction: 'outbound',
      providerStatus: 'processed',
      ...overrides,
    });
  }

  function setup(pendingMessages: Message[] = []) {
    const getMany = jest.fn().mockResolvedValue(pendingMessages);
    const take = jest.fn().mockReturnValue({ getMany });
    const orderBy = jest.fn().mockReturnValue({ take });
    const andWhere: jest.Mock = jest.fn();
    andWhere.mockReturnValue({ andWhere, orderBy });
    const where = jest.fn().mockReturnValue({ andWhere });
    const createQueryBuilder = jest.fn().mockReturnValue({ where });
    const save = jest.fn(async (value: Message) => value);
    const repository = { createQueryBuilder, save } as any;
    const service = new DeliveryStatusPollService(repository);
    return { service, repository, getMany, save, where, andWhere, orderBy, take };
  }

  function enablePoll(env: Record<string, string | undefined> = {}) {
    process.env.DELIVERY_POLL_ENABLED = 'true';
    process.env.SENDGRID_API_KEY = 'sg-test-key';
    delete process.env.NODE_ENV;
    delete process.env.DELIVERY_POLL_ALLOW_PROD;
    Object.assign(process.env, env);
  }

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('does not run when DELIVERY_POLL_ENABLED is not true', async () => {
    delete process.env.DELIVERY_POLL_ENABLED;
    process.env.SENDGRID_API_KEY = 'sg-test-key';
    const message = makeMessage();
    const { service, getMany } = setup([message]);

    await service.pollDeliveryStatus();

    expect(getMany).not.toHaveBeenCalled();
    expect(message.status).toBe('provider_accepted');
  });

  it('does not run when SENDGRID_API_KEY is missing', async () => {
    process.env.DELIVERY_POLL_ENABLED = 'true';
    delete process.env.SENDGRID_API_KEY;
    const message = makeMessage();
    const { service, getMany } = setup([message]);

    await service.pollDeliveryStatus();

    expect(getMany).not.toHaveBeenCalled();
    expect(message.status).toBe('provider_accepted');
  });

  it('does not run in production without explicit allow', async () => {
    enablePoll({ NODE_ENV: 'production' });
    const message = makeMessage();
    const { service, getMany } = setup([message]);

    await service.pollDeliveryStatus();

    expect(getMany).not.toHaveBeenCalled();
    expect(message.status).toBe('provider_accepted');
  });

  it('runs in production when DELIVERY_POLL_ALLOW_PROD is true', async () => {
    enablePoll({ NODE_ENV: 'production', DELIVERY_POLL_ALLOW_PROD: 'true' });
    const message = makeMessage();
    const { service, getMany } = setup([message]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [] }),
    } as any);

    await service.pollDeliveryStatus();

    expect(getMany).toHaveBeenCalled();
  });

  it('updates message to delivered when SendGrid returns a delivered event', async () => {
    enablePoll();
    const message = makeMessage();
    const { service, save } = setup([message]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [{ msg_id: 'sg-msg-id-1', status: 'delivered' }],
      }),
    } as any);

    await service.pollDeliveryStatus();

    expect(save).toHaveBeenCalled();
    expect(message.status).toBe('delivered');
    expect(message.providerStatus).toBe('delivered');
    expect(message.deliveredAt).toBeInstanceOf(Date);
  });

  it('updates message to failed on bounce with lastError', async () => {
    enablePoll();
    const message = makeMessage();
    const { service, save } = setup([message]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [
          {
            msg_id: 'sg-msg-id-1',
            status: 'bounce',
            reason: '550 5.1.1 The email account does not exist',
          },
        ],
      }),
    } as any);

    await service.pollDeliveryStatus();

    expect(save).toHaveBeenCalled();
    expect(message.status).toBe('failed');
    expect(message.providerStatus).toBe('bounce');
    expect(message.failedAt).toBeInstanceOf(Date);
    expect(message.lastError).toContain('bounce');
  });

  it('keeps provider_accepted on deferred and persists latest provider status', async () => {
    enablePoll();
    const message = makeMessage({ providerStatus: 'processed' });
    const { service, save } = setup([message]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [{ msg_id: 'sg-msg-id-1', status: 'deferred' }],
      }),
    } as any);

    await service.pollDeliveryStatus();

    expect(save).toHaveBeenCalled();
    expect(message.status).toBe('provider_accepted');
    expect(message.providerStatus).toBe('deferred');
    expect(message.deliveredAt).toBeFalsy();
    expect(message.failedAt).toBeFalsy();
  });

  it('handles API errors gracefully and continues', async () => {
    enablePoll();
    const message = makeMessage();
    const { service, save } = setup([message]);
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    await expect(service.pollDeliveryStatus()).resolves.toBeUndefined();
    expect(message.status).toBe('provider_accepted');
    expect(save).not.toHaveBeenCalled();
  });

  it('handles non-OK API responses gracefully', async () => {
    enablePoll();
    const message = makeMessage();
    const { service, save } = setup([message]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    } as any);

    await expect(service.pollDeliveryStatus()).resolves.toBeUndefined();
    expect(message.status).toBe('provider_accepted');
    expect(save).not.toHaveBeenCalled();
  });

  it('queries only provider_accepted outbound sendgrid emails, oldest first, limited', async () => {
    enablePoll();
    const { service, where, andWhere, orderBy, take } = setup([]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [] }),
    } as any);

    await service.pollDeliveryStatus();

    expect(where).toHaveBeenCalledWith("message.status = 'provider_accepted'");
    const andWhereCalls = andWhere.mock.calls.map((c: any[]) => c[0]);
    expect(
      andWhereCalls.some((c: string) => c.includes("channel = 'email'")),
    ).toBe(true);
    expect(
      andWhereCalls.some((c: string) => c.includes("direction = 'outbound'")),
    ).toBe(true);
    expect(
      andWhereCalls.some((c: string) => c.includes('sendgrid:%')),
    ).toBe(true);
    expect(orderBy).toHaveBeenCalledWith('message.created_at', 'ASC');
    expect(take).toHaveBeenCalledWith(50);
  });
});
