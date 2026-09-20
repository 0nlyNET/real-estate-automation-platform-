const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { DataSource } = require('../backend/node_modules/typeorm');
const bcrypt = require('../backend/node_modules/bcryptjs');
const {
  buildDatabaseOptions,
} = require('../backend/dist/database/database-options');
const { Tenant } = require('../backend/dist/modules/tenants/tenant.entity');
const { User } = require('../backend/dist/modules/users/user.entity');
const { Lead } = require('../backend/dist/modules/leads/lead.entity');
const { Message } = require('../backend/dist/modules/messaging/message.entity');
const { ConversationAiState } = require('../backend/dist/modules/ai/conversation-ai-state.entity');

async function seed() {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(
    process.env.NODE_ENV,
    'test',
    'Browser fixtures require NODE_ENV=test',
  );
  assert(
    ['localhost', '127.0.0.1'].includes(url.hostname),
    'Use an isolated local database',
  );
  assert.equal(
    url.pathname,
    '/realtytechai_browser',
    'Use the disposable browser-test database',
  );
  const source = new DataSource({
    ...buildDatabaseOptions(url.href),
    migrationsRun: false,
  });
  await source.initialize();
  try {
    const applied = await source.runMigrations();
    console.log(`Fresh database: ${applied.length} migrations applied`);
    assert.equal(await source.showMigrations(), false);
    await source.undoLastMigration();
    assert.equal(await source.showMigrations(), true);
    await source.runMigrations();
    assert.equal(await source.showMigrations(), false);
    console.log('Latest migration rollback/reapply passed');

    const tenants = source.getRepository(Tenant);
    const users = source.getRepository(User);
    const operatorTenant = await tenants.save(
      tenants.create({
        name: 'Browser operators',
        plan: 'managed',
        status: 'active',
        lifecycleStatus: 'ONBOARDING',
      }),
    );
    const pendingTenant = await tenants.save(
      tenants.create({
        name: 'Browser pending workspace',
        plan: 'managed',
        status: 'active',
        lifecycleStatus: 'ONBOARDING',
        paymentConfirmedAt: new Date(),
        stripeSubscriptionId: 'sub_browser_fixture',
        paidSubscriptionId: 'sub_browser_fixture',
      }),
    );
    const clientTenant = await tenants.save(
      tenants.create({
        name: 'Browser client workspace',
        plan: 'managed',
        status: 'active',
        lifecycleStatus: 'ONBOARDING',
      }),
    );
    const password = `Browser-fixture-${randomBytes(16).toString('hex')}`;
    const passwordHash = await bcrypt.hash(password, 12);
    for (const [email, role, tenantId] of [
      ['browser-owner@example.test', 'owner', operatorTenant.id],
      ['browser-staff@example.test', 'admin', operatorTenant.id],
      ['browser-client@example.test', 'owner', clientTenant.id],
    ]) {
      await users.save(
        users.create({
          email,
          role,
          tenantId,
          passwordHash,
          isActive: true,
          isEmailVerified: true,
          mustChangePassword: false,
        }),
      );
    }
    await users.save(
      users.create({
        email: 'browser-pending@example.test',
        role: 'owner',
        tenantId: pendingTenant.id,
        passwordHash: null,
        isActive: true,
        isEmailVerified: false,
        mustChangePassword: true,
      }),
    );
    const conversationTenant = await tenants.save(tenants.create({
      name: 'Browser Conversations', plan: 'service', status: 'active', lifecycleStatus: 'ACTIVE',
      paymentConfirmedAt: new Date(), stripeSubscriptionId: 'sub_browser_conversations',
      paidSubscriptionId: 'sub_browser_conversations',
    }));
    for (const email of ['browser-conversations@example.test', 'browser-peer@example.test']) {
      await users.save(users.create({ email, role: 'owner', tenantId: conversationTenant.id,
        passwordHash, isActive: true, isEmailVerified: true, mustChangePassword: false }));
    }
    const leads = source.getRepository(Lead);
    const conversationLead = await leads.save(leads.create({ tenantId: conversationTenant.id,
      fullName: '', email: 'conversation-lead@example.test', phone: '+15555550199', source: 'Website form',
    }));
    const foreignLead = await leads.save(leads.create({ tenantId: clientTenant.id,
      fullName: 'Another workspace lead', email: 'foreign-lead@example.test',
    }));
    const messages = source.getRepository(Message);
    for (let i = 0; i < 65; i += 1) {
      await messages.save(messages.create({ leadId: conversationLead.id, channel: 'email',
        direction: 'inbound', body: `Synthetic conversation message ${i + 1}`, status: 'received',
        createdAt: new Date(Date.now() - (65 - i) * 1000),
      }));
    }
    // Keep the fixture pause explicit; this suite must never call live providers.
    await source.getRepository(ConversationAiState).save({ tenantId: conversationTenant.id,
      leadId: conversationLead.id, ownershipStatus: 'paused', aiPausedReason: 'Synthetic browser test',
    });
    const fixtureDirectory = join(__dirname, '../frontend/.e2e');
    mkdirSync(fixtureDirectory, { recursive: true });
    writeFileSync(
      join(fixtureDirectory, 'accounts.json'),
      JSON.stringify({ password, tenantId: pendingTenant.id, conversationLeadId: conversationLead.id,
        conversationTenantId: conversationTenant.id, foreignLeadId: foreignLead.id }),
      { mode: 0o600 },
    );
    console.log(
      'Synthetic browser accounts prepared; no provider credentials are configured',
    );
  } finally {
    await source.destroy();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
