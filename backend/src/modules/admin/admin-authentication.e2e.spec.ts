import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { UsersService } from '../users/users.service';
import { JWT_SIGN_OPTIONS } from '../auth/auth-token';
import { JwtStrategy } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClientSuspensionController } from './client-suspension.controller';
import { ServiceControlService } from '../service-control/service-control.service';

describe('production admin authentication and authorization boundary', () => {
  const original = { ...process.env };
  const secret = 'admin-boundary-test-secret-is-long-enough';
  let app: INestApplication;
  let jwt: JwtService;
  const suspend = jest.fn().mockResolvedValue({ changed: true });

  const users = new Map([
    [
      'admin-1',
      {
        id: 'admin-1',
        email: 'owner@example.com',
        role: 'owner',
        tenantId: '00000000-0000-4000-8000-000000000001',
        isActive: true,
        isEmailVerified: true,
        mustChangePassword: false,
        sessionVersion: 1,
      },
    ],
    [
      'staff-1',
      {
        id: 'staff-1',
        email: 'staff@example.com',
        role: 'admin',
        platformRole: 'staff',
        tenantId: '00000000-0000-4000-8000-000000000001',
        isActive: true,
        isEmailVerified: true,
        mustChangePassword: false,
        sessionVersion: 1,
      },
    ],
    [
      'client-1',
      {
        id: 'client-1',
        email: 'client@example.com',
        role: 'owner',
        tenantId: '00000000-0000-4000-8000-000000000002',
        isActive: true,
        isEmailVerified: true,
        mustChangePassword: false,
        sessionVersion: 1,
      },
    ],
  ]);

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    process.env.PLATFORM_ADMIN_EMAILS = 'owner@example.com';
    process.env.PLATFORM_STAFF_EMAILS = 'staff@example.com';
    const module = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret, signOptions: JWT_SIGN_OPTIONS }),
      ],
      controllers: [ClientSuspensionController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        PlatformAdminGuard,
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn(async (id: string) => users.get(id) || null),
          },
        },
        {
          provide: ServiceControlService,
          useValue: { suspend },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    jwt = module.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
    process.env = { ...original };
  });

  beforeEach(() => {
    suspend.mockClear();
  });

  function token(sub: string, options: Record<string, unknown> = {}) {
    return jwt.sign({ sub, sessionVersion: 1 }, options as any);
  }

  const path =
    '/api/v1/admin/clients/00000000-0000-4000-8000-000000000099/suspend';

  it.each([
    ['logged out', undefined],
    ['malformed token', 'Bearer malformed.token.value'],
    ['incorrect signature', `Bearer ${new JwtService({ secret: 'wrong-signature-secret-is-long-enough', signOptions: JWT_SIGN_OPTIONS }).sign({ sub: 'admin-1', sessionVersion: 1 })}`],
  ])('rejects %s access', async (_label, authorization) => {
    const call = request(app.getHttpServer()).post(path).send({
      reason: 'Security boundary test',
    });
    if (authorization) call.set('Authorization', authorization);
    await call.expect(401);
    expect(suspend).not.toHaveBeenCalled();
  });

  it('rejects an expired administrator token', async () => {
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token('admin-1', { expiresIn: -1 })}`)
      .send({ reason: 'Security boundary test' })
      .expect(401);
    expect(suspend).not.toHaveBeenCalled();
  });

  it.each([
    ['normal client', 'client-1'],
    ['low-privilege platform staff', 'staff-1'],
  ])('rejects vertical privilege escalation by a %s', async (_label, sub) => {
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token(sub)}`)
      .send({ reason: 'Security boundary test' })
      .expect(403);
    expect(suspend).not.toHaveBeenCalled();
  });

  it('allows only the current database-backed configured platform admin', async () => {
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token('admin-1')}`)
      .set('x-request-id', 'admin-security-request')
      .send({ reason: 'Security boundary test' })
      .expect(201)
      .expect({ changed: true });
    expect(suspend).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '00000000-0000-4000-8000-000000000099',
        actor: expect.objectContaining({ email: 'owner@example.com' }),
      }),
    );
  });
});
