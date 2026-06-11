import { describe, it, expect } from 'vitest';
import { AdminAuthService } from '../src/admin/admin-auth.service';
import { roleHasPermission, ROLE_PERMISSIONS } from '../src/admin/roles';

describe('AdminAuthService', () => {
  it('issues a token for valid credentials and rejects bad ones', () => {
    const auth = new AdminAuthService();
    expect(auth.login('superadmin', 'wrong')).toBeNull();
    expect(auth.login('nobody', 'whatever')).toBeNull();
    const session = auth.login('superadmin', 'superadmin123');
    expect(session).not.toBeNull();
    expect(session!.role).toBe('superadmin');
    expect(typeof session!.token).toBe('string');
    expect(session!.token.length).toBeGreaterThan(16);
  });

  it('verifies only live tokens', () => {
    const auth = new AdminAuthService();
    const session = auth.login('readonly', 'readonly123')!;
    expect(auth.verify(session.token)?.username).toBe('readonly');
    expect(auth.verify('garbage')).toBeNull();
    expect(auth.verify(undefined)).toBeNull();
    auth.logout(session.token);
    expect(auth.verify(session.token)).toBeNull();
  });
});

describe('RBAC roles', () => {
  it('readonly can read stats but cannot write balances', () => {
    expect(roleHasPermission('readonly', 'stats:read')).toBe(true);
    expect(roleHasPermission('readonly', 'balance:write')).toBe(false);
    expect(roleHasPermission('support', 'players:read')).toBe(true);
    expect(roleHasPermission('support', 'balance:write')).toBe(false);
    expect(roleHasPermission('finance', 'balance:write')).toBe(true);
    expect(roleHasPermission('superadmin', 'balance:write')).toBe(true);
  });

  it('superadmin is a superset of every other role', () => {
    const all = ROLE_PERMISSIONS.superadmin;
    for (const role of ['finance', 'support', 'readonly'] as const) {
      for (const perm of ROLE_PERMISSIONS[role]) {
        expect(all).toContain(perm);
      }
    }
  });
});
