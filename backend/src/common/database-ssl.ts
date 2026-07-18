export type DatabaseSslConfig = false | { rejectUnauthorized: boolean };

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
 * trusted by Node's default CA bundle. Keep verification strict elsewhere and
 * allow an explicit environment override in either direction.
 */
export function buildDatabaseSslConfig(
  defaultEnabled: boolean,
  env: NodeJS.ProcessEnv = process.env,
): DatabaseSslConfig {
  const enabled = parseBoolean(env.DATABASE_SSL) ?? defaultEnabled;
  if (!enabled) return false;

  const explicitVerification = parseBoolean(
    env.DATABASE_SSL_REJECT_UNAUTHORIZED,
  );

  return {
    rejectUnauthorized:
      explicitVerification === undefined
        ? !isRailwayRuntime(env)
        : explicitVerification,
  };
}
