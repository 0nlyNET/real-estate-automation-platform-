const REQUIRED_PRODUCTION_VALUES = [
  'DATABASE_URL',
  'FRONTEND_URL',
  'PUBLIC_APP_URL',
  'PUBLIC_API_URL',
  'PLATFORM_ADMIN_EMAILS',
  'GLOBAL_AUTOMATIONS_DISABLED',
  'BILLING_GRACE_DAYS',
  'TWILIO_WEBHOOK_URL',
  'TWILIO_STATUS_CALLBACK_URL',
  'SENDGRID_SENDING_DOMAIN',
  'SENDGRID_REPLY_DOMAIN',
  'SENDGRID_INBOUND_USERNAME',
  'SENDGRID_INBOUND_PASSWORD',
  'TWILIO_PRIMARY_CUSTOMER_PROFILE_SID',
  'TWILIO_SECONDARY_PROFILE_POLICY_SID',
  'TWILIO_A2P_TRUST_PRODUCT_POLICY_SID',
  'EXTERNAL_UPTIME_MONITOR_URL',
] as const;

// These values are required for the process to start safely. Provider
// approvals, authenticated domains, and external monitoring remain launch
// readiness requirements below, but must not create a deployment deadlock
// before the owner can finish configuring them.
const STARTUP_REQUIRED_PRODUCTION_VALUES = [
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
  'STRIPE_PRICE_SERVICE_MONTH',
  'STRIPE_PRICE_SETUP_ONCE',
] as const;

const VAPID_VALUES = [
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
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

function optionalProviderConfiguration(input: {
  required: readonly string[];
  redirectPath: string;
  webhookVariable: string;
  webhookPath: string;
}) {
  const missing = input.required.filter((name) => !present(name));
  const configuredCount = input.required.length - missing.length;
  const publicApi = String(process.env.PUBLIC_API_URL || '').replace(/\/+$/, '');
  const explicitWebhook = String(process.env[input.webhookVariable] || '').trim();
  const issues: string[] = [];
  if (configuredCount > 0 && !publicApi) missing.push('PUBLIC_API_URL');
  if (explicitWebhook && !validHttpsUrl(input.webhookVariable)) {
    issues.push(`${input.webhookVariable} must be an absolute HTTPS URL`);
  }
  return {
    status:
      configuredCount === 0
        ? 'not_configured'
        : missing.length || issues.length
          ? 'down'
          : 'configured',
    missing,
    issues,
    redirectUri: publicApi ? `${publicApi}${input.redirectPath}` : null,
    webhookUrl: explicitWebhook || (publicApi ? `${publicApi}${input.webhookPath}` : null),
  };
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

function productionPlatformIssues(
  requiredValues: readonly string[],
  includeLaunchRequirements: boolean,
) {
  const issues: string[] = [];
  for (const name of requiredValues) {
    if (!present(name)) issues.push(`${name} is missing`);
  }
  if (!validHttpsUrl('FRONTEND_URL')) {
    issues.push('FRONTEND_URL must be an absolute HTTPS URL');
  }
  if (!validHttpsUrl('PUBLIC_APP_URL')) {
    issues.push('PUBLIC_APP_URL must be an absolute HTTPS URL');
  }
  if (!validHttpsUrl('PUBLIC_API_URL')) {
    issues.push('PUBLIC_API_URL must be an absolute HTTPS URL');
  }
  if (includeLaunchRequirements) {
    if (!validHttpsUrl('TWILIO_WEBHOOK_URL')) {
      issues.push('TWILIO_WEBHOOK_URL must be an absolute HTTPS URL');
    }
    if (!validHttpsUrl('TWILIO_STATUS_CALLBACK_URL')) {
      issues.push('TWILIO_STATUS_CALLBACK_URL must be an absolute HTTPS URL');
    }
    for (const name of ['SENDGRID_SENDING_DOMAIN', 'SENDGRID_REPLY_DOMAIN']) {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(process.env[name] || '').trim())) {
        issues.push(`${name} must be a valid authenticated domain`);
      }
    }
  }
  if (process.env.TYPEORM_SYNC !== 'false') {
    issues.push('TYPEORM_SYNC must be explicitly false');
  }
  if (!['true', 'false'].includes(String(process.env.GLOBAL_AUTOMATIONS_DISABLED))) {
    issues.push('GLOBAL_AUTOMATIONS_DISABLED must be true or false');
  }
  const graceDays = Number(process.env.BILLING_GRACE_DAYS);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 14) {
    issues.push('BILLING_GRACE_DAYS must be an integer from 0 through 14');
  }
  return issues;
}

function base64UrlBytes(value: string) {
  const raw = String(value || '').trim();
  if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return -1;
  try {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(normalized + padding, 'base64').length;
  } catch {
    return -1;
  }
}

function vapidIssues() {
  const issues: string[] = [];
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.VAPID_SUBJECT || '').trim();

  if (publicKey && base64UrlBytes(publicKey) !== 65) {
    issues.push('VAPID_PUBLIC_KEY must be the generated 65-byte public key');
  }
  if (privateKey && base64UrlBytes(privateKey) !== 32) {
    issues.push('VAPID_PRIVATE_KEY must be the generated 32-byte private key');
  }
  if (subject && !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(subject) && !/^https:\/\//i.test(subject)) {
    issues.push('VAPID_SUBJECT must be a mailto: address or HTTPS URL');
  }
  return issues;
}

export function environmentReadiness() {
  const production = process.env.NODE_ENV === 'production';
  const platformIssues = production
    ? productionPlatformIssues(REQUIRED_PRODUCTION_VALUES, true)
    : [];
  const runtimeIssues = production
    ? productionPlatformIssues(STARTUP_REQUIRED_PRODUCTION_VALUES, false)
    : [];

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
  const pushMissing = VAPID_VALUES.filter((name) => !present(name));
  const pushConfigured = VAPID_VALUES.length - pushMissing.length;
  const pushIssues = vapidIssues();
  const googleCalendar = optionalProviderConfiguration({
    required: [
      'GOOGLE_CALENDAR_CLIENT_ID',
      'GOOGLE_CALENDAR_CLIENT_SECRET',
    ],
    redirectPath: '/calendar/google/oauth/callback',
    webhookVariable: 'GOOGLE_CALENDAR_WEBHOOK_URL',
    webhookPath: '/calendar/google/notifications',
  });
  const microsoftCalendar = optionalProviderConfiguration({
    required: [
      'MICROSOFT_CALENDAR_CLIENT_ID',
      'MICROSOFT_CALENDAR_CLIENT_SECRET',
    ],
    redirectPath: '/calendar/microsoft/oauth/callback',
    webhookVariable: 'MICROSOFT_CALENDAR_WEBHOOK_URL',
    webhookPath: '/calendar/microsoft/notifications',
  });
  const calendly = optionalProviderConfiguration({
    required: [
      'CALENDLY_CLIENT_ID',
      'CALENDLY_CLIENT_SECRET',
      'CALENDLY_WEBHOOK_SIGNING_KEY',
    ],
    redirectPath: '/calendar/calendly/oauth/callback',
    webhookVariable: 'CALENDLY_WEBHOOK_URL',
    webhookPath: '/calendar/calendly/notifications',
  });

  return {
    environment: production ? 'production' : process.env.NODE_ENV || 'development',
    runtime: {
      status: production && runtimeIssues.length ? 'down' : 'up',
      issues: runtimeIssues,
    },
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
        pushConfigured === 0
          ? 'not_configured'
          : pushMissing.length || pushIssues.length
            ? 'down'
            : 'up',
      missing: pushMissing,
      issues: pushIssues,
    },
    googleCalendar,
    microsoftCalendar,
    calendly,
    retention: {
      status: 'up',
      days: Number(process.env.OPERATIONAL_RETENTION_DAYS || 90),
      schedule: 'postgres_durable_daily',
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
      mode: 'postgres_leased',
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
    ...report.runtime.issues,
    ...report.encryption.issues,
  ];
  if (issues.length) {
    throw new Error(`Unsafe production configuration: ${issues.join('; ')}`);
  }
}
