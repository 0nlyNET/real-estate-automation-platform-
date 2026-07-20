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

export function platformStaffEmails(): Set<string> {
  return new Set(
    String(process.env.PLATFORM_STAFF_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export type PlatformRole = 'super_admin' | 'staff';

export function getPlatformRole(email?: string | null): PlatformRole | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (platformAdminEmails().has(normalized)) return 'super_admin';
  if (platformStaffEmails().has(normalized)) return 'staff';
  return null;
}

export function isPlatformOperatorEmail(email?: string | null): boolean {
  return getPlatformRole(email) !== null;
}

export function resolvePlatformRole(
  email?: string | null,
  storedRole?: string | null,
): PlatformRole | null {
  if (isPlatformAdminEmail(email)) return 'super_admin';
  if (storedRole === 'staff' || (!!email && platformStaffEmails().has(email.trim().toLowerCase()))) {
    return 'staff';
  }
  return null;
}
