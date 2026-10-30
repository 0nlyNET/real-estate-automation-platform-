import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { OperatorTestAdminController } from './operator-test-admin.controller';
import { OperatorTestAdminService } from './operator-test-admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformOperatorGuard } from '../../common/guards/platform-operator.guard';

// Exercise the actual operator guard and the controller's stricter super-admin
// check; only authentication is stubbed, no real account/session is used.
describe('operator test grant administration', () => {
  let app: INestApplication;
  const original = process.env.PLATFORM_ADMIN_EMAILS;
  const service = { createGrant: jest.fn().mockResolvedValue({ id: 'grant' }),
    revokeGrant: jest.fn(), listGrants: jest.fn().mockResolvedValue([]) };
  beforeAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'operator@example.test';
    const module = await Test.createTestingModule({ controllers: [OperatorTestAdminController],
      providers: [PlatformOperatorGuard, { provide: OperatorTestAdminService, useValue: service }] })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: (ctx: any) => {
        const req = ctx.switchToHttp().getRequest();
        req.user = { sub: '00000000-0000-4000-8000-000000000001', email: 'operator@example.test',
          platformOperator: req.headers['x-role'] !== 'client', platformRole: req.headers['x-role'],
          impersonatedBy: req.headers['x-impersonated'] ? {} : undefined };
        return true;
      } }).compile();
    app = module.createNestApplication(); await app.init();
  });
  afterAll(async () => { await app?.close();
    if (original === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = original;
  });
  it.each(['client', 'staff'])('denies %s on every grant endpoint', async (role) => {
    await request(app.getHttpServer()).post('/admin/operator-test/grants').set('x-role', role).send({}).expect(403);
    await request(app.getHttpServer()).get('/admin/operator-test/grants/tenant').set('x-role', role).expect(403);
    await request(app.getHttpServer()).delete('/admin/operator-test/grants/grant').set('x-role', role).expect(403);
  });
  it('denies an impersonating super administrator', async () => {
    await request(app.getHttpServer()).post('/admin/operator-test/grants').set('x-role', 'super_admin')
      .set('x-impersonated', 'true').send({}).expect(403);
  });
  it('registers the intended routes for an unimpersonated super administrator', async () => {
    await request(app.getHttpServer()).post('/admin/operator-test/grants').set('x-role', 'super_admin')
      .send({ tenantId: 'tenant', recipientAllowlist: ['owned@example.test'], expiresAt: '2026-10-05' }).expect(201);
    expect(service.createGrant).toHaveBeenCalledWith(expect.objectContaining({
      createdBy: '00000000-0000-4000-8000-000000000001' }));
    await request(app.getHttpServer()).get('/admin/operator-test/grants/tenant').set('x-role', 'super_admin').expect(200);
    await request(app.getHttpServer()).delete('/admin/operator-test/grants/grant').set('x-role', 'super_admin').expect(200);
  });
});
