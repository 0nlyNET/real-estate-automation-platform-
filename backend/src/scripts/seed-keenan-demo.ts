import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { Appointment } from '../modules/client-operations/appointment.entity';
import { ClientOperationsService } from '../modules/client-operations/client-operations.service';
import { Lead } from '../modules/leads/lead.entity';
import { Message } from '../modules/messaging/message.entity';
import { Tenant } from '../modules/tenants/tenant.entity';
import { User } from '../modules/users/user.entity';

async function seedKeenanDemo() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The Keenan demo seed is disabled in production');
  }
  const tenantId = String(process.env.DEMO_TENANT_ID || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
    throw new Error('DEMO_TENANT_ID must be the development client workspace UUID');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const tenants = app.get<Repository<Tenant>>(getRepositoryToken(Tenant));
    const users = app.get<Repository<User>>(getRepositoryToken(User));
    const leads = app.get<Repository<Lead>>(getRepositoryToken(Lead));
    const messages = app.get<Repository<Message>>(getRepositoryToken(Message));
    const appointments = app.get<Repository<Appointment>>(getRepositoryToken(Appointment));
    const workflow = app.get(ClientOperationsService);

    const tenant = await tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new Error('Demo tenant was not found');
    const owner = await users.findOne({
      where: { tenantId, role: 'owner', isActive: true },
      order: { createdAt: 'ASC' },
    });
    if (!owner) throw new Error('Demo tenant needs an active owner');

    const existing = await leads.findOne({
      where: { tenantId, email: 'demo.hot@realtytechai.local' },
    });
    if (existing) {
      process.stdout.write(
        `Demo already exists for ${tenant.name}. Open /app/dashboard and /admin/dashboard?view=handoffs.\n`,
      );
      return;
    }

    const hot = await leads.save(
      leads.create({
        tenant,
        tenantId,
        fullName: 'Maya Thompson',
        email: 'demo.hot@realtytechai.local',
        phone: '15550001001',
        source: 'Website demo form',
        location: 'Buffalo, NY',
        propertyInterest: 'Single-family home',
        leadType: 'buyer',
        temperature: 'warm',
        temperatureReason: 'New buyer lead; qualification is still in progress.',
        readinessLevel: 'exploring',
        qualificationData: {},
        stage: 'contacted',
        score: 50,
        assignedToUserId: owner.id,
        assignedTo: owner.email,
        sequenceStatus: 'stopped',
        firstContactSentAt: new Date(Date.now() - 90_000),
        lastContactedAt: new Date(Date.now() - 90_000),
        lastActivityAt: new Date(),
      }),
    );
    await messages.save(
      messages.create({
        lead: hot,
        leadId: hot.id,
        channel: 'sms',
        direction: 'outbound',
        body: 'Hi Maya—thanks for reaching out. Are you buying or selling, and what timing are you considering?',
        status: 'delivered',
        providerStatus: 'delivered',
        deliveredAt: new Date(Date.now() - 90_000),
        idempotencyKey: `keenan-demo:hot:outbound:${tenantId}`,
      }),
    );
    const hotReply = await messages.save(
      messages.create({
        lead: hot,
        leadId: hot.id,
        channel: 'sms',
        direction: 'inbound',
        body: "I'm pre-approved up to $350,000 and want to buy within 60 days. Can we talk tomorrow evening?",
        status: 'received',
        providerStatus: 'received',
        idempotencyKey: `keenan-demo:hot:inbound:${tenantId}`,
      }),
    );
    await workflow.processInboundReply(hot, hotReply.body, hotReply.id);
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(18, 0, 0, 0);
    await workflow.createAppointment(
      tenantId,
      {
        leadId: hot.id,
        startsAt: tomorrow.toISOString(),
        notes: 'Buyer requested an evening consultation.',
        calendarSource: 'Keenan demo',
        externalEventId: `keenan-demo-hot-${tenantId}`,
      },
      { userId: owner.id, role: 'owner' },
      'conversation',
    );

    const warm = await leads.save(
      leads.create({
        tenant,
        tenantId,
        fullName: 'Andre Lewis',
        email: 'demo.warm@realtytechai.local',
        phone: '15550001002',
        source: 'Social profile demo link',
        location: 'Amherst, NY',
        leadType: 'buyer',
        temperature: 'warm',
        temperatureReason: 'New buyer lead; qualification is still in progress.',
        readinessLevel: 'exploring',
        qualificationData: {},
        stage: 'contacted',
        score: 50,
        assignedToUserId: owner.id,
        assignedTo: owner.email,
        sequenceStatus: 'stopped',
        firstContactSentAt: new Date(Date.now() - 60_000),
        lastContactedAt: new Date(Date.now() - 60_000),
        lastActivityAt: new Date(),
      }),
    );
    await messages.save(
      messages.create({
        lead: warm,
        leadId: warm.id,
        channel: 'sms',
        direction: 'outbound',
        body: 'Hi Andre—what would need to happen before you feel ready to buy?',
        status: 'delivered',
        providerStatus: 'delivered',
        deliveredAt: new Date(Date.now() - 60_000),
        idempotencyKey: `keenan-demo:warm:outbound:${tenantId}`,
      }),
    );
    const warmReply = await messages.save(
      messages.create({
        lead: warm,
        leadId: warm.id,
        channel: 'sms',
        direction: 'inbound',
        body: 'I want to purchase, but I need to improve my credit score first.',
        status: 'received',
        providerStatus: 'received',
        idempotencyKey: `keenan-demo:warm:inbound:${tenantId}`,
      }),
    );
    await workflow.processInboundReply(warm, warmReply.body, warmReply.id);

    const appointmentCount = await appointments.count({ where: { tenantId } });
    process.stdout.write(
      `Created the Keenan demo for ${tenant.name}: hot buyer handoff, appointment, and warm credit follow-up. Workspace appointments: ${appointmentCount}.\n`,
    );
  } finally {
    await app.close();
  }
}

seedKeenanDemo().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Demo seed failed'}\n`);
  process.exitCode = 1;
});
