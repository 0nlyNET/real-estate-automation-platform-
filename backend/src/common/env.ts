const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;

export function requireJwtSecret(): string {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) throw new Error('JWT_SECRET is required');
  if (process.env.NODE_ENV === 'production' && secret.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production`);
  }
  return secret;
}

export function platformAdminEmails(): Set<string> {
  return new Set(
    String(process.env.PLATFORM_ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPlatformAdminEmail(email?: string | null): boolean {
  return !!email && platformAdminEmails().has(email.trim().toLowerCase());
}
