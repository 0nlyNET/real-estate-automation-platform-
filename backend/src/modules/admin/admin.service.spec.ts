import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';

describe('AdminService client onboarding', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
  });

  function setup(
    options: { existingOwner?: boolean; mailFails?: boolean } = {},
  ) {
    const tenantRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'tenant-1', ...value })),
    };
    const userRepository = {
      findOne: jest.fn(async () =>
        options.existingOwner ? { id: 'existing-user' } : null,
      ),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'owner-1', ...value })),
    };
    const manager = {
      getRepository: jest.fn((entity: { name: string }) =>
        entity.name === 'Tenant' ? tenantRepository : userRepository,
      ),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const mail = {
      sendVerificationEmail: options.mailFails
        ? jest.fn(async () => {
            throw new Error('provider unavailable');
          })
        : jest.fn(async () => undefined),
    };

    const service = new AdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      dataSource as never,
      mail as never,
    );

    return {
      service,
      dataSource,
      mail,
      tenantRepository,
      userRepository,
    };
  }

  it('creates an inactive onboarding workspace and owner in one transaction', async () => {
    process.env.FRONTEND_URL = 'https://www.realtytechai.app/';
    const { service, dataSource, mail, tenantRepository, userRepository } =
      setup();

    const result = await service.createClient({
      businessName: ' Lakeview Realty ',
      ownerEmail: ' Broker@Example.com ',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(tenantRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Lakeview Realty',
        plan: 'trial',
        status: 'incomplete',
        lifecycleStatus: 'ONBOARDING',
      }),
    );
    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        email: 'broker@example.com',
        role: 'owner',
        isEmailVerified: false,
        mustChangePassword: true,
        passwordHash: expect.not.stringContaining('Temp-'),
      }),
    );
    expect(result.temporaryPassword).toMatch(/^Temp-[A-Za-z0-9_-]{20,}$/);
    expect(result.verifyLink).toMatch(
      /^https:\/\/www\.realtytechai\.app\/verify-email\?token=[a-f0-9]{64}$/,
    );
    expect(result.verificationEmailSent).toBe(true);
    expect(mail.sendVerificationEmail).toHaveBeenCalledWith({
      to: 'broker@example.com',
      verifyLink: result.verifyLink,
    });
  });

  it('keeps the created account available when email delivery is not configured', async () => {
    const { service } = setup({ mailFails: true });

    await expect(
      service.createClient({
        businessName: 'Manual Setup Realty',
        ownerEmail: 'owner@example.com',
      }),
    ).resolves.toMatchObject({ verificationEmailSent: false });
  });

  it('rejects an owner email that already belongs to an account', async () => {
    const { service, tenantRepository } = setup({ existingOwner: true });

    await expect(
      service.createClient({
        businessName: 'Duplicate Realty',
        ownerEmail: 'owner@example.com',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tenantRepository.save).not.toHaveBeenCalled();
  });
});
