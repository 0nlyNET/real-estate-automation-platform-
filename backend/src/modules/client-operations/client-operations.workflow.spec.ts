import { randomUUID } from 'crypto';
import { DataType, newDb } from 'pg-mem';
import { DataSource, Repository } from 'typeorm';
import { databaseEntities } from '../../database/entities';
import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Message } from '../messaging/message.entity';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Appointment } from './appointment.entity';
import { ClientOperationsService } from './client-operations.service';
import { LeadHandoff } from './lead-handoff.entity';

describe('client operations workflow integration', () => {
  let dataSource: DataSource;
  let tenants: Repository<Tenant>;
  let users: Repository<User>;
  let leads: Repository<Lead>;
  let messages: Repository<Message>;
  let handoffs: Repository<LeadHandoff>;
  let appointments: Repository<Appointment>;
  let service: ClientOperationsService;
  const notifications = {
    createForTenant: jest.fn().mockResolvedValue([]),
    createForPlatform: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const db = newDb({ autoCreateForeignKeyIndices: true });
    db.public.registerFunction({
      name: 'current_database',
      returns: DataType.text,
      implementation: () => 'client_operations_test',
    });
    db.public.registerFunction({
      name: 'version',
      returns: DataType.text,
      implementation: () => 'PostgreSQL 16.0',
    });
    db.public.registerFunction({
      name: 'uuid_generate_v4',
      returns: DataType.uuid,
      impure: true,
      implementation: randomUUID,
    });
    db.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      impure: true,
      implementation: randomUUID,
    });
    dataSource = db.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [...databaseEntities],
      synchronize: true,
    });
    await dataSource.initialize();
    tenants = dataSource.getRepository(Tenant);
    users = dataSource.getRepository(User);
    leads = dataSource.getRepository(Lead);
    messages = dataSource.getRepository(Message);
    handoffs = dataSource.getRepository(LeadHandoff);
    appointments = dataSource.getRepository(Appointment);
    service = new ClientOperationsService(
      handoffs,
      appointments,
      leads,
      messages,
      dataSource.getRepository(LeadEvent),
      notifications as any,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function createTenant(name: string, email: string) {
    const tenant = await tenants.save(
      tenants.create({
        name,
        plan: 'trial',
        status: 'trialing',
        lifecycleStatus: 'ACTIVE',
        billingInterval: 'month',
        cancelAtPeriodEnd: false,
        timezone: 'America/New_York',
      }),
    );
    const owner = await users.save(
      users.create({
        tenantId: tenant.id,
        tenant,
        email,
        passwordHash: 'not-used',
        role: 'owner',
        teamId: null,
        team: null,
        isEmailVerified: true,
        emailVerifyToken: null,
        emailVerifyTokenExpiresAt: null,
        isActive: true,
      }),
    );
    return { tenant, owner };
  }

  it('moves a qualified reply through Today, appointment, admin visibility, and completion without leaking tenants', async () => {
    const clientA = await createTenant('Pilot Realty', 'pilot-owner@example.com');
    const clientB = await createTenant('Other Realty', 'other-owner@example.com');
    const lead = await leads.save(
      leads.create({
        tenantId: clientA.tenant.id,
        tenant: clientA.tenant,
        fullName: 'Morgan Qualified',
        email: 'morgan@example.com',
        phone: '15550002001',
        source: 'Website',
        leadType: 'buyer',
        temperature: 'warm',
        temperatureReason: 'Qualification is still in progress.',
        readinessLevel: 'exploring',
        qualificationData: {},
        stage: 'contacted',
        score: 50,
        assignedToUserId: clientA.owner.id,
        assignedTo: clientA.owner.email,
        sequenceStatus: 'stopped',
        firstContactSentAt: new Date(Date.now() - 60_000),
        lastActivityAt: new Date(),
      }),
    );
    const reply = await messages.save(
      messages.create({
        lead,
        leadId: lead.id,
        channel: 'sms',
        direction: 'inbound',
        body: "I'm pre-approved for $350k and buying within 60 days. Please call me.",
        status: 'received',
        providerStatus: 'received',
        idempotencyKey: `workflow:${randomUUID()}`,
      }),
    );

    const qualified = await service.processInboundReply(lead, reply.body, reply.id);
    const today = await service.getToday(
      clientA.tenant.id,
      { userId: clientA.owner.id, role: 'owner' },
      8,
    );
    const otherTenantToday = await service.getToday(
      clientB.tenant.id,
      { userId: clientB.owner.id, role: 'owner' },
      8,
    );

    expect(qualified.lead.temperature).toBe('hot');
    expect(today.actions[0]).toMatchObject({
      resourceType: 'handoff',
      lead: { id: lead.id, fullName: 'Morgan Qualified' },
    });
    expect(otherTenantToday.actions).toEqual([]);

    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const appointment = await service.createAppointment(
      clientA.tenant.id,
      { leadId: lead.id, startsAt: startsAt.toISOString(), notes: 'Pilot consultation' },
      { userId: clientA.owner.id, role: 'owner' },
      'conversation',
    );
    await service.updateAppointment(
      appointment.id,
      clientA.tenant.id,
      { status: 'confirmed', confirmationStatus: 'confirmed' },
      { userId: clientA.owner.id, role: 'owner' },
    );
    await service.updateHandoff(
      qualified.handoff!.id,
      clientA.tenant.id,
      { action: 'completed', note: 'Call completed' },
      { userId: clientA.owner.id, role: 'owner' },
    );

    await expect(
      service.listAppointments(clientA.tenant.id, { userId: clientA.owner.id, role: 'owner' }),
    ).resolves.toEqual([
      expect.objectContaining({ id: appointment.id, status: 'confirmed' }),
    ]);
    await expect(service.listHandoffsForAdmin({ tenantId: clientA.tenant.id })).resolves.toEqual([
      expect.objectContaining({ id: qualified.handoff!.id, status: 'completed' }),
    ]);
  });

  it('keeps a credit-blocked buyer out of the urgent queue until the future follow-up', async () => {
    const tenant = await tenants.findOneByOrFail({ name: 'Pilot Realty' });
    const owner = await users.findOneByOrFail({ tenantId: tenant.id, role: 'owner' });
    const lead = await leads.save(
      leads.create({
        tenantId: tenant.id,
        tenant,
        fullName: 'Casey Nurture',
        email: 'casey@example.com',
        phone: '15550002002',
        source: 'Social form',
        leadType: 'buyer',
        temperature: 'warm',
        temperatureReason: 'Qualification is still in progress.',
        readinessLevel: 'exploring',
        qualificationData: {},
        stage: 'contacted',
        score: 50,
        assignedToUserId: owner.id,
        sequenceStatus: 'stopped',
        firstContactSentAt: new Date(),
        lastActivityAt: new Date(),
      }),
    );
    const result = await service.processInboundReply(
      lead,
      'I want to buy but need to work on my credit score first.',
      randomUUID(),
    );
    const today = await service.getToday(
      tenant.id,
      { userId: owner.id, role: 'owner' },
      8,
    );
    expect(result.lead).toMatchObject({
      temperature: 'warm',
      mainBlocker: 'Credit improvement',
      stage: 'nurture',
    });
    expect(today.actions.some((item) => item.lead.id === lead.id)).toBe(false);
  });
});
