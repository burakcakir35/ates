import { randomBytes, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ADMIN_SESSION_TTL_MS, ADMIN_USERS } from './admin.config';
import { AdminPermission, AdminRole, roleHasPermission } from './roles';

export interface AdminSession {
  token: string;
  username: string;
  role: AdminRole;
  expiresAt: number;
}

/** Constant-time string comparison to avoid leaking password length/prefix. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * In-memory admin session store. Issues opaque bearer tokens on a valid
 * username/password and validates them on every protected request. This is the
 * separate authentication layer that isolates the operator surface from the
 * anonymous player surface.
 */
@Injectable()
export class AdminAuthService {
  private sessions = new Map<string, AdminSession>();

  login(
    username: string,
    password: string,
  ): { token: string; role: AdminRole; expiresAt: number } | null {
    const user = ADMIN_USERS.find((u) => u.username === username);
    // Always run a comparison so timing does not reveal whether the user exists.
    const reference = user?.password ?? 'invalid';
    const ok = safeEqual(password ?? '', reference) && user !== undefined;
    if (!ok || !user) {
      return null;
    }
    const token = randomBytes(32).toString('hex');
    const session: AdminSession = {
      token,
      username: user.username,
      role: user.role,
      expiresAt: Date.now() + ADMIN_SESSION_TTL_MS,
    };
    this.sessions.set(token, session);
    return { token, role: user.role, expiresAt: session.expiresAt };
  }

  verify(token: string | undefined): AdminSession | null {
    if (!token) {
      return null;
    }
    const session = this.sessions.get(token);
    if (!session) {
      return null;
    }
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  logout(token: string | undefined): void {
    if (token) {
      this.sessions.delete(token);
    }
  }

  can(session: AdminSession, permission: AdminPermission): boolean {
    return roleHasPermission(session.role, permission);
  }
}
