import { Controller, Get, INestApplication, Req, UseGuards } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request = require('supertest');
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';
import { JwtStrategy } from '../modules/auth/jwt.strategy';
import { JWT_SIGN_OPTIONS } from '../modules/auth/auth-token';
import { UsersService } from '../modules/users/users.service';
import { sessionSecurityThrottleTracker } from './security-throttle';

@Controller('auth')
class SessionFixtureController {
  @Get('session')
  @UseGuards(JwtAuthGuard)
  session(@Req() req: any) { return { userId: req.user.sub }; }
}

describe('session throttling over HTTP', () => {
  const originalEnv = { ...process.env };
  const secret = 'test-only-session-http-signing-key-not-for-production';
  let app: INestApplication;
  let version: number;
  beforeEach(async () => {
    process.env.JWT_SECRET = secret;
    version = 0;
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), ThrottlerModule.forRoot([
        { name: 'default', ttl: 60_000, limit: 120, getTracker: sessionSecurityThrottleTracker },
      ])],
      controllers: [SessionFixtureController],
      providers: [JwtStrategy, { provide: APP_GUARD, useClass: ThrottlerGuard }, {
        provide: UsersService, useValue: { findById: async (id: string) => ({
          id, email: `${id}@example.test`, isActive: true, isEmailVerified: true,
          tenantId: 'test-tenant', role: 'owner', sessionVersion: version,
        }) },
      }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => { await app.close(); process.env = { ...originalEnv }; });
  function token(sub: string) {
    return new JwtService().sign({ sub, sessionVersion: 0 }, { secret, ...JWT_SIGN_OPTIONS });
  }
  it('enforces 120 checks for one user while another user at the same peer stays available', async () => {
    const first = token('first-user');
    for (let count = 0; count < 120; count++) {
      await request(app.getHttpServer()).get('/auth/session').set('Cookie', `rtai_session=${first}`).expect(200);
    }
    await request(app.getHttpServer()).get('/auth/session').set('Cookie', `rtai_session=${first}`).expect(429);
    await request(app.getHttpServer()).get('/auth/session').set('Cookie', `rtai_session=${token('other-user')}`).expect(200).expect({ userId: 'other-user' });
  });
  it('still rejects a signed session immediately after database revocation', async () => {
    const signed = token('revoked-user');
    await request(app.getHttpServer()).get('/auth/session').set('Cookie', `rtai_session=${signed}`).expect(200);
    version = 1;
    await request(app.getHttpServer()).get('/auth/session').set('Cookie', `rtai_session=${signed}`).expect(401);
  });
  it('retains the shared anonymous limit for forged tokens that rotate their claimed user', async () => {
    for (let count = 0; count < 120; count++) {
      const forged = new JwtService().sign({ sub: `forged-${count}` }, { secret: 'wrong-test-key', ...JWT_SIGN_OPTIONS });
      await request(app.getHttpServer()).get('/auth/session').set('Cookie', `rtai_session=${forged}`).expect(401);
    }
    await request(app.getHttpServer()).get('/auth/session').set('Cookie', 'rtai_session=invalid').expect(429);
  });
});
