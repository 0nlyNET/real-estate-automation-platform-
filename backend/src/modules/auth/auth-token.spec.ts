import { JwtService } from '@nestjs/jwt';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SIGN_OPTIONS,
  JWT_VERIFY_OPTIONS,
} from './auth-token';

describe('JWT cryptographic policy', () => {
  const secret = 'test-only-secret-that-is-long-enough';
  const service = new JwtService({ secret, signOptions: JWT_SIGN_OPTIONS });

  it('pins algorithm, issuer, audience, and expiration', async () => {
    const token = service.sign({ sub: 'user-1', sessionVersion: 1 });
    await expect(
      service.verifyAsync(token, { secret, ...JWT_VERIFY_OPTIONS }),
    ).resolves.toMatchObject({
      sub: 'user-1',
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
    });
  });

  it('rejects alg:none, an incorrect signature, and an expired token', async () => {
    const noneToken = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'user-1', iss: JWT_ISSUER, aud: JWT_AUDIENCE })).toString('base64url')}.`;
    await expect(
      service.verifyAsync(noneToken, { secret, ...JWT_VERIFY_OPTIONS }),
    ).rejects.toThrow();

    const signed = service.sign({ sub: 'user-1' });
    await expect(
      service.verifyAsync(signed, {
        secret: 'different-test-secret-that-is-long-enough',
        ...JWT_VERIFY_OPTIONS,
      }),
    ).rejects.toThrow();

    const expired = service.sign({ sub: 'user-1' }, { expiresIn: -1 });
    await expect(
      service.verifyAsync(expired, { secret, ...JWT_VERIFY_OPTIONS }),
    ).rejects.toThrow();
  });
});
