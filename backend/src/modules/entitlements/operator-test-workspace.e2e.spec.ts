import { CanActivate, Controller, ExecutionContext, INestApplication, Post, Req, UseGuards } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { EntitlementService } from './entitlement.service';
import { AllowOperatorTestEmailAccess, WorkspaceAccessInterceptor } from './workspace-access.interceptor';
import { OperatorTestGuard } from '../messaging/operator-test.guard';

class FixtureSession implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.user = { tenantId: req.headers['x-tenant'] || 'fixture' };
    if (req.headers['x-operator'] === '1') Object.assign(req.user, {
      platformOperator: true, platformAdmin: true, operatorMode: { tenantId: req.user.tenantId },
    });
    // A client-supplied flag does not confer authorization.
    req.isOperatorTest = req.body?.isOperatorTest;
    return true;
  }
}
@Controller('fixture') @UseGuards(FixtureSession)
class FixtureController {
  @AllowOperatorTestEmailAccess() @Post('email') email(@Req() req: any) {
    return { reached: true, isOperatorTest: req.isOperatorTest === true, grantId: req.operatorTestAuthorizationId || null };
  }
  @Post('ordinary') ordinary() { return { reached: true }; }
}

describe('operator test exception at the HTTP workspace boundary', () => {
  let app: INestApplication;
  const grants = { checkTenantAuthorization: jest.fn(async (tenantId) => tenantId === 'fixture' ? { id: 'grant' } : null) };
  beforeAll(async () => {
    const service = new EntitlementService({ findOne: async ({ where }: any) => ({ status: 'incomplete',
      lifecycleStatus: where.id === 'suspended' ? 'SUSPENDED' : 'TESTING' }) } as any, {} as any);
    const module = await Test.createTestingModule({ controllers: [FixtureController], providers: [FixtureSession,
      { provide: EntitlementService, useValue: service }, { provide: OperatorTestGuard, useValue: grants },
      { provide: APP_INTERCEPTOR, useClass: WorkspaceAccessInterceptor }] }).compile();
    app = module.createNestApplication(); await app.init();
  });
  afterAll(async () => { await app?.close(); });
  it('allows only the explicitly marked email operation', async () => {
    await request(app.getHttpServer()).post('/fixture/email').send({ channel: 'email' }).expect(201);
    await request(app.getHttpServer()).post('/fixture/ordinary').send({ isOperatorTest: true }).expect(403);
    await request(app.getHttpServer()).post('/fixture/email').send({ channel: 'sms', isOperatorTest: true }).expect(403);
  });
  it('fails closed for another tenant, revocation, and suspension', async () => {
    await request(app.getHttpServer()).post('/fixture/email').set('x-tenant', 'stranger').send({ isOperatorTest: true }).expect(403);
    await request(app.getHttpServer()).post('/fixture/email').set('x-tenant', 'suspended').send({}).expect(403);
    grants.checkTenantAuthorization.mockResolvedValueOnce(null);
    await request(app.getHttpServer()).post('/fixture/email').send({ isOperatorTest: true }).expect(403);
  });

  it('carries the server grant into an unpaid operator email send without authorizing SMS', async () => {
    const result = await request(app.getHttpServer()).post('/fixture/email').set('x-operator', '1')
      .send({ leadId: 'owned-lead', channel: 'email' }).expect(201);
    expect(result.body).toMatchObject({ isOperatorTest: true, grantId: 'grant' });
    await request(app.getHttpServer()).post('/fixture/email').set('x-operator', '1')
      .send({ leadId: 'owned-lead', channel: 'sms', isOperatorTest: true }).expect(403);
    await request(app.getHttpServer()).post('/fixture/email').set('x-operator', '1').set('x-tenant', 'stranger')
      .send({ leadId: 'owned-lead', channel: 'email', isOperatorTest: true }).expect(403);
    await request(app.getHttpServer()).post('/fixture/email').set('x-operator', '1').set('x-tenant', 'suspended')
      .send({ leadId: 'owned-lead', channel: 'email' }).expect(403);
  });
});
