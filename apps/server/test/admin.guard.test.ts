import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import {
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthService } from '../src/admin/admin-auth.service';
import {
  AdminGuard,
  REQUIRE_PERMISSION,
} from '../src/admin/admin.guard';

function contextFor(
  headers: Record<string, string>,
  handler: (...args: unknown[]) => unknown = () => undefined,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function makeGuard() {
  const auth = new AdminAuthService();
  const guard = new AdminGuard(auth, new Reflector());
  return { auth, guard };
}

describe('AdminGuard (player/admin isolation + RBAC)', () => {
  it('rejects requests with no bearer token (401)', () => {
    const { guard } = makeGuard();
    expect(() => guard.canActivate(contextFor({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects forged/garbage tokens (401)', () => {
    const { guard } = makeGuard();
    expect(() =>
      guard.canActivate(contextFor({ authorization: 'Bearer nope' })),
    ).toThrow(UnauthorizedException);
  });

  it('allows a valid token when no permission is required', () => {
    const { auth, guard } = makeGuard();
    const { token } = auth.login('readonly', 'readonly123')!;
    expect(
      guard.canActivate(contextFor({ authorization: `Bearer ${token}` })),
    ).toBe(true);
  });

  it('blocks read-only role from a balance:write route (403)', () => {
    const { auth, guard } = makeGuard();
    const { token } = auth.login('readonly', 'readonly123')!;
    const handler = () => undefined;
    Reflect.defineMetadata(REQUIRE_PERMISSION, 'balance:write', handler);
    expect(() =>
      guard.canActivate(
        contextFor({ authorization: `Bearer ${token}` }, handler),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows finance role on a balance:write route', () => {
    const { auth, guard } = makeGuard();
    const { token } = auth.login('finance', 'finance123')!;
    const handler = () => undefined;
    Reflect.defineMetadata(REQUIRE_PERMISSION, 'balance:write', handler);
    expect(
      guard.canActivate(
        contextFor({ authorization: `Bearer ${token}` }, handler),
      ),
    ).toBe(true);
  });
});
