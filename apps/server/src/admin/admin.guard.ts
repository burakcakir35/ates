import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthService, AdminSession } from './admin-auth.service';
import { AdminPermission } from './roles';

export const REQUIRE_PERMISSION = 'require_permission';

/** Declare the permission a protected admin route needs. */
export const RequirePermission = (permission: AdminPermission) =>
  SetMetadata(REQUIRE_PERMISSION, permission);

/** Minimal request shape we rely on (avoids an express type dependency). */
export interface AdminRequest {
  headers: { authorization?: string };
  adminSession?: AdminSession;
}

function bearerToken(req: AdminRequest): string | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return undefined;
  }
  return header.slice('Bearer '.length).trim();
}

/**
 * Rejects any request without a valid admin bearer token (401) and any
 * authenticated request whose role lacks the route's required permission (403).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const session = this.auth.verify(bearerToken(req));
    if (!session) {
      throw new UnauthorizedException('Admin authentication required');
    }
    req.adminSession = session;

    const permission = this.reflector.getAllAndOverride<
      AdminPermission | undefined
    >(REQUIRE_PERMISSION, [context.getHandler(), context.getClass()]);
    if (permission && !this.auth.can(session, permission)) {
      throw new ForbiddenException(
        `Your role (${session.role}) lacks permission: ${permission}`,
      );
    }
    return true;
  }
}
