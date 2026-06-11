/** Role-based access control for the operator (admin) surface. */

export type AdminRole = 'superadmin' | 'finance' | 'support' | 'readonly';

export type AdminPermission = 'stats:read' | 'players:read' | 'balance:write';

/** What each role is allowed to do. Super admin is a strict superset. */
export const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  superadmin: ['stats:read', 'players:read', 'balance:write'],
  finance: ['stats:read', 'players:read', 'balance:write'],
  support: ['stats:read', 'players:read'],
  readonly: ['stats:read'],
};

export function roleHasPermission(
  role: AdminRole,
  permission: AdminPermission,
): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
