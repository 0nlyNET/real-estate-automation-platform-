import { CanActivate, Controller, ExecutionContext, Get, INestApplication, Injectable, Post, UseGuards } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { EntitlementService } from './entitlement.service';
import { AllowSetupAccess, WorkspaceAccessInterceptor } from './workspace-access.interceptor';

// Authentication is supplied by this fixture guard so the HTTP test exercises
// the actual post-guard interceptor, current tenant lookup and handler blocking.
@Injectable()
class SessionFixture implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    req.user = { tenantId: req.headers['x-test-tenant'] || 'unpaid',
      platformOperator: req.headers['x-test-operator'] === 'true',
      impersonatedBy: req.headers['x-test-impersonated'] ? { userId: 'operator' } : undefined };
    return true;
  }
}

@Controller('workspace')
@UseGuards(SessionFixture)
class WorkspaceFixture {
  @Get('conversations') read() { return { reachedHandler: true }; }
  @Post('send') send() { return { reachedHandler: true }; }
  @AllowSetupAccess() @Get('billing') billing() { return { setup: true }; }
}

describe('all authenticated operations require paid workspace access', () => {
  let app: INestApplication;
  const paid = { status: 'active', lifecycleStatus: 'ACTIVE', stripeSubscriptionId: 'sub_paid', paidSubscriptionId: 'sub_paid', paymentConfirmedAt: new Date() };
  const tenants: Record<string, any> = { paid, unpaid: { status: 'incomplete', lifecycleStatus: 'ONBOARDING' },
    suspended: { ...paid, lifecycleStatus: 'SUSPENDED' }, stale: { status: 'active', lifecycleStatus: 'ACTIVE' } };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [WorkspaceFixture], providers: [
      SessionFixture,
      { provide: EntitlementService, useValue: new EntitlementService({ findOne: async ({ where }: any) => tenants[where.id] || null } as any, {} as any) },
      { provide: APP_INTERCEPTOR, useClass: WorkspaceAccessInterceptor },
    ] }).compile();
    app = module.createNestApplication(); await app.init();
  });
  afterAll(async () => { await app.close(); });

  it.each(['unpaid', 'stale', 'missing'])('denies reads and writes for %s', async (tenant) => {
    await request(app.getHttpServer()).get('/workspace/conversations').set('x-test-tenant', tenant).expect(403)
      .expect(({ body }) => expect(body.code).toBe('PAYMENT_REQUIRED'));
    await request(app.getHttpServer()).post('/workspace/send').set('x-test-tenant', tenant).expect(403);
  });
  it('allows billing before payment and normal operations after payment', async () => {
    await request(app.getHttpServer()).get('/workspace/billing').expect(200);
    await request(app.getHttpServer()).get('/workspace/conversations').set('x-test-tenant', 'paid').expect(200);
    await request(app.getHttpServer()).get('/workspace/conversations').set('x-test-tenant', 'suspended').expect(403);
  });
  it('allows an operator but never lets impersonation bypass client payment', async () => {
    await request(app.getHttpServer()).get('/workspace/conversations').set('x-test-operator', 'true').expect(200);
    await request(app.getHttpServer()).get('/workspace/conversations').set('x-test-operator', 'true').set('x-test-impersonated', 'true').expect(403);
  });
});
