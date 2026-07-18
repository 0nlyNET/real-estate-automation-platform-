import { buildDatabaseSslConfig } from './database-ssl';

describe('database SSL configuration', () => {
  it('verifies certificates by default outside Railway', () => {
    expect(buildDatabaseSslConfig(true, {})).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('accepts Railway managed database certificates by default', () => {
    expect(
      buildDatabaseSslConfig(true, {
        RAILWAY_ENVIRONMENT_ID: 'production',
      }),
    ).toEqual({ rejectUnauthorized: false });
  });

  it('honors an explicit verification override on Railway', () => {
    expect(
      buildDatabaseSslConfig(true, {
        RAILWAY_PROJECT_ID: 'project',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
      }),
    ).toEqual({ rejectUnauthorized: true });
  });

  it('allows SSL to be disabled explicitly', () => {
    expect(
      buildDatabaseSslConfig(true, {
        RAILWAY_SERVICE_ID: 'service',
        DATABASE_SSL: 'false',
      }),
    ).toBe(false);
  });

  it('keeps host-based connections non-TLS unless explicitly enabled', () => {
    expect(buildDatabaseSslConfig(false, {})).toBe(false);
    expect(
      buildDatabaseSslConfig(false, {
        DATABASE_SSL: 'true',
      }),
    ).toEqual({ rejectUnauthorized: true });
  });
});
