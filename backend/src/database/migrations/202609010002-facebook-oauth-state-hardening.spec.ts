import { FacebookOauthStateHardening1788220800002 } from './202609010002-facebook-oauth-state-hardening';

describe('Facebook OAuth state hardening migration', () => {
  it('adds Facebook to the server-side OAuth-state provider constraint', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new FacebookOauthStateHardening1788220800002().up({ query } as any);

    expect(query.mock.calls.map(([sql]) => String(sql)).join('\n')).toContain(
      "'facebook'",
    );
  });
});
