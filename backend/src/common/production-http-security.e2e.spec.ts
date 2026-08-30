import { Controller, Get, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request = require('supertest');
import { apiSecurityHeaders, cookieCsrfProtection } from './http-security';

@Controller('security-fixture')
class SecurityFixtureController {
  @Get('ok')
  ok() {
    return { ok: true };
  }

  @Post('state')
  state() {
    return { changed: true };
  }

  @Get('failure')
  failure() {
    throw new Error('sensitive-internal-detail /private/server/path');
  }

  @Get('limited')
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  limited() {
    return { ok: true };
  }
}

describe('production-like HTTP security boundary', () => {
  const original = { ...process.env };
  let app: any;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://app.example.com';
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [SecurityFixtureController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.use(apiSecurityHeaders);
    app.use(cookieCsrfProtection);
    app.enableCors({
      origin: ['https://app.example.com'],
      credentials: true,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = { ...original };
  });

  it('returns the configured security headers from a real response', async () => {
    const response = await request(app.getHttpServer())
      .get('/security-fixture/ok')
      .expect(200);
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    expect(response.headers['strict-transport-security']).toContain(
      'max-age=31536000',
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects cookie CSRF while preserving the legitimate mutation', async () => {
    await request(app.getHttpServer())
      .post('/security-fixture/state')
      .set('Cookie', 'rtai_session=session-value')
      .set('Origin', 'https://attacker.example')
      .expect(403)
      .expect(({ body }) => {
        expect(body).not.toHaveProperty('changed');
      });

    await request(app.getHttpServer())
      .post('/security-fixture/state')
      .set('Cookie', 'rtai_session=session-value')
      .set('Origin', 'https://app.example.com')
      .expect(201)
      .expect({ changed: true });
  });

  it('does not grant CORS access to an attacker-controlled origin', async () => {
    const attacker = await request(app.getHttpServer())
      .options('/security-fixture/state')
      .set('Origin', 'https://attacker.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(attacker.headers['access-control-allow-origin']).toBeUndefined();

    const trusted = await request(app.getHttpServer())
      .options('/security-fixture/state')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(trusted.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );
    expect(trusted.headers['access-control-allow-credentials']).toBe('true');
  });

  it('sanitizes unhandled errors at the external HTTP boundary', async () => {
    const response = await request(app.getHttpServer())
      .get('/security-fixture/failure')
      .expect(500);
    expect(response.body).toMatchObject({
      statusCode: 500,
      message: 'Internal server error',
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'sensitive-internal-detail',
    );
    expect(JSON.stringify(response.body)).not.toContain('/private/server/path');
  });

  it('actually rejects requests after the endpoint rate limit', async () => {
    await request(app.getHttpServer()).get('/security-fixture/limited').expect(200);
    await request(app.getHttpServer()).get('/security-fixture/limited').expect(200);
    await request(app.getHttpServer()).get('/security-fixture/limited').expect(429);
  });
});
