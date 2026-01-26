export type UserRole = 'owner' | 'admin' | 'agent' | 'tc' | 'read_only';

export const ROLE_ORDER: Record<UserRole, number> = {
  owner: 4,
  admin: 3,
  agent: 2,
  tc: 1,
  read_only: 0,
};

export function hasAtLeastRole(userRole: UserRole, required: UserRole) {
  return (ROLE_ORDER[userRole] ?? 0) >= (ROLE_ORDER[required] ?? 0);
}

export function canManageUsers(role: UserRole) {
  return role === 'owner' || role === 'admin';
}
