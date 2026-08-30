import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { databaseEntities } from '../../database/entities';
import { Team } from '../teams/team.entity';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AccountInvitation } from './account-invitation.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { AuthService } from './auth.service';

const databaseUrl = String(process.env.TEST_POSTGRES_URL || '').trim();
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('password recovery over HTTP and real PostgreSQL', () => {
  const originalEnvironment = { ...process.env };
  const schema = `password_reset_${randomUUID().replace(/-/g, '')}`;
  const tenantId = randomUUID();
  const userId = randomUUID();
  const verificationUserId = randomUUID();
  const invitedUserId = randomUUID();
  const email = 'reset-owner@example.test';
  const verificationEmail = 'verify-owner@example.test';
  const verificationToken = 'verification-token-'.padEnd(64, 'a');
  const invitationToken = 'invitation-token-'.padEnd(64, 'b');
  let pool: any;
  let dataSource: DataSource;
  let app: INestApplication;
  let mail: { sendEmail: jest.Mock; sendWelcomeEmail: jest.Mock };
  let operations: { createTask: jest.Mock };

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://www.realtytechai.app';

    const { Pool } = require('pg');
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`
      CREATE TABLE "${schema}"."tenants" (
        "id" uuid PRIMARY KEY
      );
      CREATE TABLE "${schema}"."users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL REFERENCES "${schema}"."tenants"("id") ON DELETE CASCADE,
        "email" varchar(255) NOT NULL UNIQUE,
        "passwordHash" varchar(255),
        "role" varchar(50) NOT NULL DEFAULT 'agent',
        "teamId" uuid,
        "isEmailVerified" boolean NOT NULL DEFAULT false,
        "emailVerifyToken" varchar(255),
        "emailVerifyTokenExpiresAt" timestamptz,
        "isActive" boolean NOT NULL DEFAULT true,
        "session_version" integer NOT NULL DEFAULT 0,
        "must_change_password" boolean NOT NULL DEFAULT false,
        "password_changed_at" timestamptz,
        "welcome_email_sent_at" timestamptz,
        "last_login_at" timestamptz,
        "platform_role" varchar(30),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE "${schema}"."password_reset_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "userId" uuid REFERENCES "${schema}"."users"("id") ON DELETE CASCADE,
        "token_hash" varchar NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz
      );
      CREATE TABLE "${schema}"."account_invitations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL REFERENCES "${schema}"."tenants"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "${schema}"."users"("id") ON DELETE CASCADE,
        "token_hash" varchar(64) NOT NULL UNIQUE,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "revoked_at" timestamptz,
        "sent_at" timestamptz
      );
    `);
    await pool.query(
      `INSERT INTO "${schema}"."tenants" ("id") VALUES ($1)`,
      [tenantId],
    );

    dataSource = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      schema,
      entities: [...databaseEntities],
      synchronize: false,
      migrationsRun: false,
      logging: false,
    });
    await dataSource.initialize();

    const userRepository = dataSource.getRepository(User);
    await userRepository.save(
      userRepository.create({
        id: userId,
        tenantId,
        email,
        passwordHash: await bcrypt.hash('Original-password-123', 4),
        role: 'owner',
        teamId: null,
        isEmailVerified: true,
        emailVerifyToken: null,
        emailVerifyTokenExpiresAt: null,
        isActive: true,
        sessionVersion: 4,
        mustChangePassword: false,
        passwordChangedAt: null,
        welcomeEmailSentAt: null,
        lastLoginAt: null,
        platformRole: null,
      }),
    );
    await userRepository.save(
      userRepository.create({
        id: invitedUserId,
        tenantId,
        email: 'invited-user@example.test',
        passwordHash: null,
        role: 'agent',
        teamId: null,
        isEmailVerified: false,
        emailVerifyToken: null,
        emailVerifyTokenExpiresAt: null,
        isActive: true,
        sessionVersion: 0,
        mustChangePassword: false,
        passwordChangedAt: null,
        welcomeEmailSentAt: null,
        lastLoginAt: null,
        platformRole: null,
      }),
    );
    const invitationRepository = dataSource.getRepository(AccountInvitation);
    await invitationRepository.save(
      invitationRepository.create({
        tenantId,
        userId: invitedUserId,
        tokenHash: createHash('sha256').update(invitationToken).digest('hex'),
        expiresAt: new Date(Date.now() + 5 * 60_000),
        usedAt: null,
        revokedAt: null,
        sentAt: new Date(),
      }),
    );
    await userRepository.save(
      userRepository.create({
        id: verificationUserId,
        tenantId,
        email: verificationEmail,
        passwordHash: await bcrypt.hash('Verification-password-123', 4),
        role: 'owner',
        teamId: null,
        isEmailVerified: false,
        emailVerifyToken: createHash('sha256')
          .update(verificationToken)
          .digest('hex'),
        emailVerifyTokenExpiresAt: new Date(Date.now() + 60_000),
        isActive: true,
        sessionVersion: 0,
        mustChangePassword: false,
        passwordChangedAt: null,
        welcomeEmailSentAt: null,
        lastLoginAt: null,
        platformRole: null,
      }),
    );

    const users = new UsersService(
      userRepository,
      dataSource.getRepository(Team),
    );
    mail = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    };
    operations = { createTask: jest.fn().mockResolvedValue({}) };
    const audit = { recordSystemEvent: jest.fn().mockResolvedValue(undefined) };
    const auth = new AuthService(
      users,
      new JwtService({ secret: 'password-reset-e2e-secret' }),
      dataSource.getRepository(PasswordResetToken),
      mail as any,
      operations as any,
      undefined,
      dataSource,
      audit as any,
    );
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
    process.env = { ...originalEnvironment };
  });

  it('verifies the email through the browser contract and sends the welcome email once', async () => {
    const verified = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: verificationToken })
      .expect(200);
    expect(verified.body).toMatchObject({
      ok: true,
      userId: verificationUserId,
      email: verificationEmail,
      isEmailVerified: true,
    });
    expect(mail.sendWelcomeEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendWelcomeEmail).toHaveBeenCalledWith({
      to: verificationEmail,
    });

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: verificationToken })
      .expect(400);
    expect(mail.sendWelcomeEmail).toHaveBeenCalledTimes(1);

    const rows = await dataSource.query(
      `SELECT "isEmailVerified", "emailVerifyToken", welcome_email_sent_at
       FROM "${schema}"."users"
       WHERE id = $1`,
      [verificationUserId],
    );
    expect(rows[0]).toEqual({
      isEmailVerified: true,
      emailVerifyToken: null,
      welcome_email_sent_at: expect.any(Date),
    });
  }, 30_000);

  it('accepts an invitation once under a PostgreSQL row lock', async () => {
    const accepted = await request(app.getHttpServer())
      .post('/auth/accept-invitation')
      .send({ token: invitationToken, password: 'Invited-password-123' })
      .expect(200);
    expect(accepted.body).toEqual({
      user: expect.objectContaining({ id: invitedUserId, tenantId }),
    });
    expect(accepted.body).not.toHaveProperty('invitationToken');

    await request(app.getHttpServer())
      .post('/auth/accept-invitation')
      .send({ token: invitationToken, password: 'Different-password-123' })
      .expect(400);

    const rows = await dataSource.query(
      `SELECT u."passwordHash", u."isEmailVerified", u.session_version, i.used_at
       FROM "${schema}"."users" u
       JOIN "${schema}"."account_invitations" i ON i.user_id = u.id
       WHERE u.id = $1`,
      [invitedUserId],
    );
    expect(rows[0]).toEqual({
      passwordHash: expect.any(String),
      isEmailVerified: true,
      session_version: 1,
      used_at: expect.any(Date),
    });
    expect(
      await bcrypt.compare('Invited-password-123', rows[0].passwordHash),
    ).toBe(true);
  }, 30_000);

  it('delivers, invalidates, consumes once, changes credentials, and preserves enumeration resistance', async () => {
    const first = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);
    expect(first.body).toEqual({
      ok: true,
      message: 'If that email exists, a reset link has been created.',
    });
    expect(first.body).not.toHaveProperty('resetLink');
    const firstMessage = mail.sendEmail.mock.calls[0][0];
    const firstToken = String(firstMessage.text).match(/token=([a-f0-9]{64})/)?.[1];
    expect(firstToken).toMatch(/^[a-f0-9]{64}$/);

    const storedAfterFirst = await dataSource.query(
      `SELECT token_hash, used_at FROM "${schema}"."password_reset_tokens"`,
    );
    expect(storedAfterFirst).toHaveLength(1);
    expect(storedAfterFirst[0]).toEqual({
      token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      used_at: null,
    });
    expect(storedAfterFirst[0].token_hash).not.toBe(firstToken);

    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: email.toUpperCase() })
      .expect(200);
    const secondMessage = mail.sendEmail.mock.calls[1][0];
    const secondToken = String(secondMessage.text).match(/token=([a-f0-9]{64})/)?.[1];
    expect(secondToken).toMatch(/^[a-f0-9]{64}$/);

    const tokenRows = await dataSource.query(
      `SELECT used_at FROM "${schema}"."password_reset_tokens" ORDER BY created_at ASC`,
    );
    expect(tokenRows).toHaveLength(2);
    expect(tokenRows[0].used_at).toBeInstanceOf(Date);
    expect(tokenRows[1].used_at).toBeNull();

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: firstToken, password: 'Replacement-password-456' })
      .expect(400);

    const concurrentResults = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: secondToken, password: 'Replacement-password-456' }),
      request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: secondToken, password: 'Replacement-password-456' }),
    ]);
    expect(concurrentResults.map((result) => result.status).sort()).toEqual([
      200,
      400,
    ]);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'Original-password-123' })
      .expect(401);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'Replacement-password-456' })
      .expect(200);
    expect(login.body).toEqual({
      user: expect.objectContaining({ id: userId, email, tenantId }),
    });
    expect(login.headers['set-cookie']?.join(';')).toContain('rtai_session=');
    expect(login.body).not.toHaveProperty('accessToken');

    mail.sendEmail.mockRejectedValueOnce(new Error('provider rejected request'));
    const providerFailure = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);
    const nonexistent = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'missing@example.test' })
      .expect(200);
    expect(providerFailure.body).toEqual(nonexistent.body);
    expect(operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'notification_failure',
        relatedEntityId: userId,
      }),
    );
    const activeTokens = await dataSource.query(
      `SELECT count(*)::int AS count
       FROM "${schema}"."password_reset_tokens"
       WHERE used_at IS NULL`,
    );
    expect(activeTokens[0].count).toBe(0);
  }, 30_000);
});
