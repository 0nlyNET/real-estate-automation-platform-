import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { DataType, newDb } from 'pg-mem';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { databaseEntities } from '../../database/entities';
import { cookieCsrfProtection } from '../../common/http-security';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { JWT_SIGN_OPTIONS } from '../auth/auth-token';
import { JwtStrategy } from '../auth/jwt.strategy';
import { EntitlementService } from '../entitlements/entitlement.service';
import { WorkspaceAccessInterceptor } from '../entitlements/workspace-access.interceptor';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { ClientNotificationsController } from './client-notifications.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AdminNotification } from './notification.entity';
import { AdminNotificationPreference } from './notification-preference.entity';
import { AdminPushSubscription } from './push-subscription.entity';

describe('cookie sessions and notification HTTP/database regression', () => {
  const original = { ...process.env };
  let ds: DataSource;
  let app: INestApplication;
  let jwt: JwtService;
  const users: User[] = [];
  const cookies: string[] = [];
  const password = 'Local-notification-test-123!';
  const workspaceAccess = jest.fn().mockRejectedValue(new Error('Billing unavailable'));

  beforeAll(async () => {
    process.env.JWT_SECRET = 'isolated-notification-session-test-secret';
    process.env.PLATFORM_ADMIN_EMAILS = 'operator@example.test';
    process.env.FRONTEND_URL = 'https://app.example.test';
    delete process.env.PLATFORM_STAFF_EMAILS;
    const db = newDb({ autoCreateForeignKeyIndices: true });
    for (const [name, value] of [['current_database', 'notifications'], ['version', 'PostgreSQL 16.0']]) {
      db.public.registerFunction({ name, returns: DataType.text, implementation: () => value });
    }
    for (const name of ['uuid_generate_v4', 'gen_random_uuid']) {
      db.public.registerFunction({ name, returns: DataType.uuid, impure: true, implementation: randomUUID });
    }
    ds = db.adapters.createTypeormDataSource({ type: 'postgres', entities: [...databaseEntities], synchronize: true });
    await ds.initialize();
    const repo = ds.getRepository(User);
    const userService = new UsersService(repo, {} as any);
    jwt = new JwtService({ secret: process.env.JWT_SECRET, signOptions: JWT_SIGN_OPTIONS });
    const auth = new AuthService(userService, jwt, {} as any, {} as any, {} as any);
    const notifications = new NotificationsService(ds.getRepository(AdminNotification), ds.getRepository(AdminPushSubscription), ds.getRepository(AdminNotificationPreference), repo);
    for (const email of ['client-a@example.test', 'client-b@example.test', 'operator@example.test']) {
      const tenant = await ds.getRepository(Tenant).save({ name: email, status: 'incomplete', lifecycleStatus: 'ONBOARDING' });
      users.push(await repo.save({ email, tenantId: tenant.id, role: 'owner', passwordHash: await bcrypt.hash(password, 4), isActive: true, isEmailVerified: true, sessionVersion: 0 }));
    }
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: JWT_SIGN_OPTIONS })],
      controllers: [AuthController, ClientNotificationsController, NotificationsController],
      providers: [JwtStrategy,
        { provide: UsersService, useValue: userService },
        { provide: AuthService, useValue: auth },
        { provide: NotificationsService, useValue: notifications },
        { provide: EntitlementService, useValue: { workspaceAccess } },
        { provide: APP_INTERCEPTOR, useClass: WorkspaceAccessInterceptor },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieCsrfProtection);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    for (const user of users) {
      const response = await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password }).expect(200);
      const setCookies = response.headers['set-cookie'] as unknown as string[];
      const session = setCookies.find((value) => value.startsWith('rtai_session='))!;
      expect(session).toContain('HttpOnly');
      expect(session).toContain('SameSite=Lax');
      cookies.push(session.split(';')[0]);
    }
  });
  afterAll(async () => { await app?.close(); await ds?.destroy(); process.env = original; });

  async function notification(recipient: User) {
    return ds.getRepository(AdminNotification).save({ recipientUserId: recipient.id, eventType: 'test', category: 'leads', severity: 'info', title: 'Test notification', message: 'Local fixture', deduplicationKey: randomUUID() });
  }
  const authenticated = (call: request.Test, user = 0) => call.set('Cookie', cookies[user]).set('Origin', process.env.FRONTEND_URL!);

  it('keeps the same cookie valid across repeated refresh/session checks without billing', async () => {
    for (let i = 0; i < 3; i++) {
      await authenticated(request(app.getHttpServer()).get('/auth/session')).expect(200)
        .expect(({ body }) => { expect(body.userId).toBe(users[0].id); expect(body.platformRole).toBeNull(); });
    }
    await authenticated(request(app.getHttpServer()).get('/auth/session'), 2).expect(200)
      .expect(({ body }) => expect(body.platformRole).toBe('super_admin'));
    expect(workspaceAccess).not.toHaveBeenCalled();
  });

  it('persists one read, updates the count, and rejects another user in another workspace', async () => {
    const own = await notification(users[0]);
    const foreign = await notification(users[1]);
    await authenticated(request(app.getHttpServer()).patch(`/notifications/${foreign.id}/read`)).expect(404);
    await authenticated(request(app.getHttpServer()).patch(`/notifications/${own.id}/read`)).expect(200, { ok: true });
    await authenticated(request(app.getHttpServer()).get('/notifications?read=read')).expect(200)
      .expect(({ body }) => expect(body.map((row: any) => row.id)).toContain(own.id));
    await authenticated(request(app.getHttpServer()).get('/notifications/summary')).expect(200)
      .expect(({ body }) => expect(body.unread).toBe(0));
    expect((await ds.getRepository(AdminNotification).findOneByOrFail({ id: foreign.id })).readAt).toBeNull();
  });

  it('marks all owned notifications and leaves all other recipients unread', async () => {
    const own = await notification(users[0]);
    const foreign = await notification(users[1]);
    await authenticated(request(app.getHttpServer()).post('/notifications/read-all')).expect(201, { ok: true });
    const repo = ds.getRepository(AdminNotification);
    expect((await repo.findOneByOrFail({ id: own.id })).readAt).toBeInstanceOf(Date);
    expect((await repo.findOneByOrFail({ id: foreign.id })).readAt).toBeNull();
    await authenticated(request(app.getHttpServer()).get('/notifications?unread=true')).expect(200, []);
  });

  it('preserves admin RBAC and cookie CSRF on mark-read mutations', async () => {
    await authenticated(request(app.getHttpServer()).get('/admin/notifications')).expect(403);
    const own = await notification(users[2]);
    await authenticated(request(app.getHttpServer()).patch(`/admin/notifications/${own.id}/read`), 2).expect(200);
    await request(app.getHttpServer()).post('/notifications/read-all').set('Cookie', cookies[0]).set('Origin', 'https://attacker.example').expect(403);
    await request(app.getHttpServer()).post('/notifications/read-all').expect(401);
  });

  it('rejects an expired or revoked session without weakening current database checks', async () => {
    const expired = jwt.sign({ sub: users[1].id, sessionVersion: 0 }, { expiresIn: -1 });
    await request(app.getHttpServer()).get('/auth/session').set('Cookie', `rtai_session=${expired}`).expect(401);
    await ds.getRepository(User).update(users[1].id, { sessionVersion: 1 });
    await authenticated(request(app.getHttpServer()).get('/auth/session'), 1).expect(401);
  });
});
