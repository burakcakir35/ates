import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { BetSelection, BetTypeId } from '@ates/engine';
import { Currency, GAME_CONFIG } from '../config';
import { GameService, ResultEvent } from './game.service';

interface HelloPayload {
  playerId?: string;
  name?: string;
  currency?: Currency;
}

interface BetPayload {
  playerId: string;
  type: BetTypeId;
  selection: BetSelection;
  amount: number;
}

interface AutoPickPayload {
  playerId: string;
  count: number;
  amount: number;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(GameGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly game: GameService) {}

  afterInit(): void {
    this.game.events.on('state', (state) => {
      this.server.emit('round:state', state);
    });
    this.game.events.on('wallet', (wallet) => {
      this.server.to(`player:${wallet.playerId}`).emit('wallet', wallet);
    });
    this.game.events.on('result', (evt: ResultEvent) => {
      this.server.emit('round:result', evt.settled);
      for (const [playerId, results] of Object.entries(evt.byPlayer)) {
        this.server
          .to(`player:${playerId}`)
          .emit('round:myResult', { roundId: evt.settled.roundId, results });
      }
    });
    this.game.start();
    this.logger.log('Game loop started');
  }

  handleConnection(client: Socket): void {
    client.emit('round:state', this.game.getPublicState());
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Disconnected: ${client.id}`);
  }

  @SubscribeMessage('player:hello')
  onHello(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: HelloPayload,
  ) {
    const currency: Currency =
      payload.currency && GAME_CONFIG.currencies.includes(payload.currency)
        ? payload.currency
        : 'USD';
    const player = this.game.registerPlayer(
      payload.playerId,
      payload.name ?? 'Guest',
      currency,
    );
    client.join(`player:${player.id}`);
    return {
      ok: true,
      player: {
        id: player.id,
        name: player.name,
        currency: player.currency,
        balance: player.balance,
        streak: player.streak,
      },
      limits: this.game.betLimitsFor(player.currency),
      state: this.game.getPublicState(),
    };
  }

  @SubscribeMessage('bet:place')
  onBet(@MessageBody() payload: BetPayload) {
    try {
      const bet = this.game.placeBet({
        playerId: payload.playerId,
        type: payload.type,
        selection: payload.selection,
        amount: payload.amount,
      });
      return { ok: true, betId: bet.id };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  @SubscribeMessage('bet:autopick')
  onAutoPick(@MessageBody() payload: AutoPickPayload) {
    try {
      const { placed } = this.game.autoPlaceBets(
        payload.playerId,
        payload.count,
        payload.amount,
      );
      return { ok: true, placed };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
