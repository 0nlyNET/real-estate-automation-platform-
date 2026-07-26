const REQUIRED_PRODUCTION_VALUES = [
  'DATABASE_URL',
  'FRONTEND_URL',
  'PUBLIC_APP_URL',
  'PUBLIC_API_URL',
  'PLATFORM_ADMIN_EMAILS',
  'GLOBAL_AUTOMATIONS_DISABLED',
  'BILLING_GRACE_DAYS',
] as const;

const SYSTEM_EMAIL_VALUES = [
  'SENDGRID_API_KEY',
  'SENDGRID_FROM_EMAIL',
  'SENDGRID_FROM_NAME',
  'SALES_INBOX_EMAIL',
] as const;

const STRIPE_VALUES = [
  'STRIPE_WEBHOOK_SECRET',
] as const;

function present(name: string) {
  return Boolean(String(process.env[name] || '').trim());
}

function validHttpsUrl(name: string) {
  try {
    return new URL(String(process.env[name] || '')).protocol === 'https:';
  } catch {
    return false;
  }
}

function validEncryptionKey() {
  const raw = String(process.env.INTEGRATIONS_ENCRYPTION_KEY || '').trim();
  if (!raw) return false;
  try {
    return Buffer.from(raw, 'base64').length === 32;
  } catch {
    return false;
  }
}

export function environmentReadiness() {
  const production = process.env.NODE_ENV === 'production';
  const platformIssues: string[] = [];

  if (production) {
    for (const name of REQUIRED_PRODUCTION_VALUES) {
      if (!present(name)) platformIssues.push(`${name} is missing`);
    }
    if (!validHttpsUrl('FRONTEND_URL')) {
      platformIssues.push('FRONTEND_URL must be an absolute HTTPS URL');
    }
    if (!validHttpsUrl('PUBLIC_APP_URL')) {
      platformIssues.push('PUBLIC_APP_URL must be an absolute HTTPS URL');
    }
    if (!validHttpsUrl('PUBLIC_API_URL')) {
      platformIssues.push('PUBLIC_API_URL must be an absolute HTTPS URL');
    }
    if (process.env.TYPEORM_SYNC !== 'false') {
      platformIssues.push('TYPEORM_SYNC must be explicitly false');
    }
    if (!['true', 'false'].includes(String(process.env.GLOBAL_AUTOMATIONS_DISABLED))) {
      platformIssues.push('GLOBAL_AUTOMATIONS_DISABLED must be true or false');
    }
    const graceDays = Number(process.env.BILLING_GRACE_DAYS);
    if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 14) {
      platformIssues.push('BILLING_GRACE_DAYS must be an integer from 0 through 14');
    }
  }

  const jwtSecret = String(process.env.JWT_SECRET || '').trim();
  const secretIssues = [
    ...(production && jwtSecret.length < 32
      ? ['JWT_SECRET must contain at least 32 characters']
      : !jwtSecret
        ? ['JWT_SECRET is missing']
        : []),
    ...(!validEncryptionKey()
      ? ['INTEGRATIONS_ENCRYPTION_KEY must decode to exactly 32 bytes']
      : []),
  ];

  const emailMissing = SYSTEM_EMAIL_VALUES.filter((name) => !present(name));
  const emailConfigured = SYSTEM_EMAIL_VALUES.length - emailMissing.length;
  const stripeEnabled = present('STRIPE_SECRET_KEY');
  const stripeMissing: string[] = stripeEnabled
    ? STRIPE_VALUES.filter((name) => !present(name))
    : [];
  if (stripeEnabled && !present('STRIPE_PRICE_SERVICE_MONTH')) {
    stripeMissing.push('STRIPE_PRICE_SERVICE_MONTH');
  }

  return {
    environment: production ? 'production' : process.env.NODE_ENV || 'development',
    platform: {
      status: production && platformIssues.length ? 'down' : 'up',
      issues: platformIssues,
    },
    encryption: {
      status: secretIssues.length ? 'down' : 'up',
      issues: secretIssues,
    },
    systemEmail: {
      status:
        emailConfigured === 0
          ? 'not_configured'
          : emailMissing.length
            ? 'down'
            : 'up',
      missing: emailMissing,
    },
    billing: {
      enabled: stripeEnabled,
      status: !stripeEnabled
        ? 'not_configured'
        : stripeMissing.length
          ? 'down'
          : 'up',
      missing: stripeMissing,
    },
    devicePush: {
      status:
        present('VAPID_PUBLIC_KEY') && present('VAPID_PRIVATE_KEY') && present('VAPID_SUBJECT')
          ? 'up'
          : 'not_configured',
      missing: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'].filter(
        (name) => !present(name),
      ),
    },
    retention: {
      status: 'up',
      days: Number(process.env.OPERATIONAL_RETENTION_DAYS || 90),
      schedule: 'in_process_daily',
    },
    providerCallbacks: {
      twilioInbound: present('TWILIO_WEBHOOK_URL') ? 'configured' : 'tenant_unavailable',
      twilioStatus: present('TWILIO_STATUS_CALLBACK_URL')
        ? 'configured'
        : 'tenant_unavailable',
      sendgridInbound:
        present('SENDGRID_INBOUND_WEBHOOK_URL') &&
        present('SENDGRID_INBOUND_USERNAME') &&
        present('SENDGRID_INBOUND_PASSWORD')
          ? 'configured'
          : 'tenant_unavailable',
      meta: present('FACEBOOK_WEBHOOK_URL') ? 'configured' : 'tenant_unavailable',
    },
    aiProvider: {
      status: present('OPENAI_API_KEY') ? 'configured' : 'not_configured',
      model: present('OPENAI_API_KEY')
        ? String(process.env.OPENAI_MODEL || 'gpt-5.6')
        : null,
      defaultWorkspaceMode: 'human_only',
    },
    workers: {
      status: 'up',
      mode: 'in_process',
      message: { intervalMs: 5_000, claimLimit: 25, leaseSeconds: 120 },
      sequence: { intervalMs: 10_000, claimLimit: 25, leaseSeconds: 120 },
      ai: { intervalMs: 3_000, claimLimit: 10, leaseSeconds: 120 },
      globalAutomationPaused: process.env.GLOBAL_AUTOMATIONS_DISABLED === 'true',
    },
  };
}

export function assertProductionEnvironment() {
  if (process.env.NODE_ENV !== 'production') return;
  const report = environmentReadiness();
  const issues = [
    ...report.platform.issues,
    ...report.encryption.issues,
  ];
  if (issues.length) {
    throw new Error(`Unsafe production configuration: ${issues.join('; ')}`);
  }
}
