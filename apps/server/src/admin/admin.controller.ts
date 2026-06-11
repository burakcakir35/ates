import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { GameService } from '../game/game.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard, AdminRequest, RequirePermission } from './admin.guard';
import { ROLE_PERMISSIONS } from './roles';

/**
 * Operator (admin) API. Lives behind its own authentication layer (AdminGuard)
 * and is completely separate from the anonymous player API in ApiController.
 * Every route except `login` requires a valid admin bearer token; mutating
 * routes additionally require a role permission.
 */
@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly game: GameService,
  ) {}

  @Post('login')
  login(@Body() body: { username?: string; password?: string }) {
    const result = this.auth.login(body?.username ?? '', body?.password ?? '');
    if (!result) {
      throw new UnauthorizedException('Invalid admin credentials');
    }
    return {
      ok: true,
      token: result.token,
      role: result.role,
      permissions: ROLE_PERMISSIONS[result.role],
      expiresAt: result.expiresAt,
    };
  }

  @Post('logout')
  @UseGuards(AdminGuard)
  logout(@Req() req: AdminRequest) {
    const token = req.headers.authorization?.slice('Bearer '.length).trim();
    this.auth.logout(token);
    return { ok: true };
  }

  @Get('session')
  @UseGuards(AdminGuard)
  session(@Req() req: AdminRequest) {
    const s = req.adminSession!;
    return {
      username: s.username,
      role: s.role,
      permissions: ROLE_PERMISSIONS[s.role],
    };
  }

  @Get('stats')
  @UseGuards(AdminGuard)
  @RequirePermission('stats:read')
  stats() {
    return this.game.getStats();
  }

  @Get('players')
  @UseGuards(AdminGuard)
  @RequirePermission('players:read')
  players() {
    return this.game.listPlayers();
  }

  @Post('players/:id/adjust')
  @UseGuards(AdminGuard)
  @RequirePermission('balance:write')
  adjust(@Param('id') id: string, @Body() body: { delta?: number }) {
    try {
      return this.game.adjustBalance(id, Number(body?.delta));
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }
}
