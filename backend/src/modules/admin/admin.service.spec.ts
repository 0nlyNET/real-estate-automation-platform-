import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';

describe('AdminService client onboarding', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalStaffEmails = process.env.PLATFORM_STAFF_EMAILS;
  const originalAdminEmails = process.env.PLATFORM_ADMIN_EMAILS;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
    if (originalStaffEmails === undefined) delete process.env.PLATFORM_STAFF_EMAILS;
    else process.env.PLATFORM_STAFF_EMAILS = originalStaffEmails;
    if (originalAdminEmails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = originalAdminEmails;
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
    const usagePolicyRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'usage-policy-1', ...value })),
    };
    const invitationRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'invitation-1', ...value })),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      })),
    };
    const manager = {
      getRepository: jest.fn((entity: { name: string }) => {
        if (entity.name === 'Tenant') return tenantRepository;
        if (entity.name === 'UsagePolicy') return usagePolicyRepository;
        if (entity.name === 'AccountInvitation') return invitationRepository;
        return userRepository;
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
      getRepository: jest.fn(() => invitationRepository),
    };
    const mail = {
      sendAccountInvitation: options.mailFails
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
      usagePolicyRepository,
    };
  }

  it('creates an inactive onboarding workspace and owner in one transaction', async () => {
    process.env.FRONTEND_URL = 'https://www.realtytechai.app/';
    const {
      service,
      dataSource,
      mail,
      tenantRepository,
      userRepository,
      usagePolicyRepository,
    } = setup();

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
        mustChangePassword: false,
        passwordHash: null,
      }),
    );
    expect(usagePolicyRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: 'tenant',
        scopeId: 'tenant-1',
        warningPercentage: 80,
        enabled: true,
      }),
    );
    expect(result).not.toHaveProperty('temporaryPassword');
    expect(result).not.toHaveProperty('invitationLink');
    expect(result.invitationEmailSent).toBe(true);
    expect(mail.sendAccountInvitation).toHaveBeenCalledWith({
      to: 'broker@example.com',
      invitationLink: expect.stringMatching(
        /^https:\/\/www\.realtytechai\.app\/accept-invitation\?token=[A-Za-z0-9_-]{40,}$/,
      ),
    });
  });

  it('keeps the created account available when email delivery is not configured', async () => {
    const { service } = setup({ mailFails: true });

    await expect(
      service.createClient({
        businessName: 'Manual Setup Realty',
        ownerEmail: 'owner@example.com',
      }),
    ).resolves.toMatchObject({ invitationEmailSent: false });
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

  it('unassigns operational records when database-managed staff access is removed', async () => {
    process.env.PLATFORM_STAFF_EMAILS = '';
    const staff = {
      id: 'staff-1',
      tenantId: 'platform-tenant',
      email: 'staff@example.com',
      isActive: true,
      isEmailVerified: true,
      platformRole: 'staff',
    };
    const usersRepo = { findOne: jest.fn().mockResolvedValue(staff) };
    const managedRepositories = new Map<string, any>();
    const manager = {
      getRepository: jest.fn((entity: { name: string }) => {
        if (!managedRepositories.has(entity.name)) {
          managedRepositories.set(entity.name, {
            save: jest.fn().mockResolvedValue(undefined),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
          });
        }
        return managedRepositories.get(entity.name);
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const service = new AdminService(
      {} as never,
      usersRepo as never,
      {} as never,
      {} as never,
      {} as never,
      dataSource as never,
      {} as never,
    );

    await expect(
      service.setPlatformStaff('platform-tenant', 'staff-1', false),
    ).resolves.toMatchObject({ platformRole: null });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    for (const [entityName, assignmentField] of Object.entries({
      Tenant: 'assignedOperatorId',
      ProspectApplication: 'assignedOperatorId',
      OperationsTask: 'assignedOperatorId',
      SupportTicket: 'assignedOperatorId',
      OnboardingRecord: 'assignedOnboardingOwnerId',
    })) {
      expect(managedRepositories.get(entityName).update).toHaveBeenCalledWith(
        expect.objectContaining({ [assignmentField]: 'staff-1' }),
        expect.objectContaining({ [assignmentField]: null }),
      );
    }
    expect(managedRepositories.get('User').save).toHaveBeenCalledWith(
      expect.objectContaining({ platformRole: null }),
    );
  });

  it('surfaces new and urgent client leads in priority order without contact details', async () => {
    process.env.PLATFORM_ADMIN_EMAILS = '';
    const rows = [
      {
        id: 'new-lead',
        tenantId: 'tenant-1',
        fullName: 'New Lead',
        stage: 'new',
        temperature: 'warm',
        readinessLevel: 'exploring',
        recommendedNextAction: 'Review',
        createdAt: new Date('2026-07-23T02:00:00Z'),
        tenant: { id: 'tenant-1', name: 'Example Realty' },
        email: 'private@example.com',
      },
      {
        id: 'urgent-lead',
        tenantId: 'tenant-1',
        fullName: 'Urgent Lead',
        stage: 'qualified',
        temperature: 'hot',
        readinessLevel: 'urgent',
        recommendedNextAction: 'Call now',
        createdAt: new Date('2026-07-23T01:00:00Z'),
        tenant: { id: 'tenant-1', name: 'Example Realty' },
        phone: '+15555550100',
      },
    ];
    const query = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
    const service = new AdminService(
      {} as never,
      {} as never,
      { createQueryBuilder: jest.fn().mockReturnValue(query) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.leadAttention(50);

    expect(result.map((lead) => lead.id)).toEqual(['urgent-lead', 'new-lead']);
    expect(result[0]).toMatchObject({
      fullName: 'Urgent Lead',
      tenant: { id: 'tenant-1', name: 'Example Realty' },
    });
    expect(result[0]).not.toHaveProperty('phone');
    expect(result[1]).not.toHaveProperty('email');
  });
});
