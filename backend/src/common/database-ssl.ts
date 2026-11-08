export type DatabaseSslConfig = false | { rejectUnauthorized: boolean; ca?: string };

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === '') return undefined;

  switch (value.trim().toLowerCase()) {
    case 'true':
      return true;
    case 'false':
      return false;
    default:
      return undefined;
  }
}

function isRailwayRuntime(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.RAILWAY_ENVIRONMENT_ID ||
    env.RAILWAY_PROJECT_ID ||
    env.RAILWAY_SERVICE_ID,
  );
}

/**
 * Railway Postgres presents a platform-managed certificate chain that is not
 * trusted by Node's default CA bundle. Preserve Railway's required behavior
 * even when a stale strict-verification variable remains configured, while
 * keeping verification strict by default everywhere else.
 */
export function buildDatabaseSslConfig(
  defaultEnabled: boolean,
  env: NodeJS.ProcessEnv = process.env,
): DatabaseSslConfig {
  const enabled = parseBoolean(env.DATABASE_SSL) ?? defaultEnabled;
  if (!enabled) return false;

  // Explicitly trusted provider CA enables verified Railway TLS without
  // changing existing installations that use platform-managed certificates.
  const ca = env.DATABASE_SSL_CA_CERT?.trim().replace(/\\n/g, '\n');
  if (ca) return { rejectUnauthorized: true, ca };

  if (isRailwayRuntime(env)) {
    return { rejectUnauthorized: false };
  }

  const explicitVerification = parseBoolean(
    env.DATABASE_SSL_REJECT_UNAUTHORIZED,
  );

  return {
    rejectUnauthorized: explicitVerification ?? true,
  };
}
