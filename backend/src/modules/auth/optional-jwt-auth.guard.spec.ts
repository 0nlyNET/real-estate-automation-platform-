import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard();

  it('keeps a valid user so logout can revoke the server-side session', () => {
    const user = { sub: 'user-1' };
    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('allows missing, expired, or revoked sessions through so logout can clear cookies', () => {
    expect(guard.handleRequest(new Error('expired'), false)).toBeNull();
    expect(guard.handleRequest(null, undefined)).toBeNull();
  });
});
