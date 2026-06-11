import { AdminRole } from './roles';

export interface AdminUser {
  username: string;
  password: string;
  role: AdminRole;
}

/**
 * Admin accounts. Passwords come from environment variables so real deployments
 * never ship hard-coded secrets; the defaults below exist only so the local
 * play-money prototype is runnable out of the box (documented in TEST_REPORT).
 *
 * Production P0 (tracked, not in this prototype): hashed passwords, mandatory
 * 2FA and an IP allowlist in front of every admin route.
 */
export const ADMIN_USERS: AdminUser[] = [
  {
    username: 'superadmin',
    password: process.env.ADMIN_SUPERADMIN_PASSWORD ?? 'superadmin123',
    role: 'superadmin',
  },
  {
    username: 'finance',
    password: process.env.ADMIN_FINANCE_PASSWORD ?? 'finance123',
    role: 'finance',
  },
  {
    username: 'support',
    password: process.env.ADMIN_SUPPORT_PASSWORD ?? 'support123',
    role: 'support',
  },
  {
    username: 'readonly',
    password: process.env.ADMIN_READONLY_PASSWORD ?? 'readonly123',
    role: 'readonly',
  },
];

/** Admin session lifetime (ms). */
export const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60; // 1 hour
