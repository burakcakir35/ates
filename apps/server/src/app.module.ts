import { Module } from '@nestjs/common';
import { ApiController } from './api/api.controller';
import { AdminController } from './admin/admin.controller';
import { AdminAuthService } from './admin/admin-auth.service';
import { AdminGuard } from './admin/admin.guard';
import { GameGateway } from './game/game.gateway';
import { GameService } from './game/game.service';

@Module({
  controllers: [ApiController, AdminController],
  providers: [GameService, GameGateway, AdminAuthService, AdminGuard],
})
export class AppModule {}
