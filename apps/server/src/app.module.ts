import { Module } from '@nestjs/common';
import { ApiController } from './api/api.controller';
import { GameGateway } from './game/game.gateway';
import { GameService } from './game/game.service';

@Module({
  controllers: [ApiController],
  providers: [GameService, GameGateway],
})
export class AppModule {}
