import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { Tenant } from '../modules/tenants/tenant.entity';
import { User } from '../modules/users/user.entity';

async function seed() {
  const email = String(process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.SEED_ADMIN_PASSWORD || '');
  const tenantName = String(process.env.SEED_TENANT_NAME || 'RealtyTechAI Workspace').trim();

  if (!email || !email.includes('@')) throw new Error('SEED_ADMIN_EMAIL is required');
  if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const tenants = app.get<Repository<Tenant>>(getRepositoryToken(Tenant));
    const users = app.get<Repository<User>>(getRepositoryToken(User));

    const existing = await users.findOne({ where: { email } });
    if (existing) {
      console.log(`Seed skipped: ${email} already exists`);
      return;
    }

    const tenant = await tenants.save(tenants.create({
      name: tenantName,
      plan: 'trial',
      status: 'trialing',
      billingInterval: 'month',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    }));

    await users.save(users.create({
      tenantId: tenant.id,
      tenant,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'owner',
      teamId: null,
      team: null,
      isEmailVerified: true,
      emailVerifyToken: null,
      emailVerifyTokenExpiresAt: null,
      isActive: true,
    }));

    console.log(`Created verified owner ${email} for tenant ${tenant.id}`);
  } finally {
    await app.close();
  }
}

seed().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
});
