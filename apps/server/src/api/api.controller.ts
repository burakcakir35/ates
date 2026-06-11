import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { CHAINS, verifyRound } from '@ates/engine';
import { GAME_CONFIG } from '../config';
import { DEPOSIT_COINS, getAllRates } from '../fx';
import { GameService } from '../game/game.service';

@Controller('api')
export class ApiController {
  constructor(private readonly game: GameService) {}

  @Get('health')
  health() {
    return { ok: true, mode: 'play-money' };
  }

  @Get('config')
  config() {
    return {
      bettingMs: GAME_CONFIG.bettingMs,
      lockingMs: GAME_CONFIG.lockingMs,
      resultMs: GAME_CONFIG.resultMs,
      houseEdge: GAME_CONFIG.houseEdge,
      minBet: GAME_CONFIG.minBet,
      maxBet: GAME_CONFIG.maxBet,
      currencies: GAME_CONFIG.currencies,
    };
  }

  @Get('bet-types')
  betTypes() {
    return this.game.getBetCatalogue();
  }

  /** Full candidate coin catalogue the per-round 20-coin pool draws from. */
  @Get('coins')
  coins() {
    return Object.values(CHAINS).map((c) => ({
      id: c.id,
      name: c.name,
      alphabetSize: c.alphabet.length,
    }));
  }

  /** Mock FX rates used for crypto→fiat conversion. */
  @Get('fx/rates')
  fxRates() {
    return { depositCoins: DEPOSIT_COINS, ...getAllRates() };
  }

  @Post('wallet/:playerId/deposit')
  deposit(
    @Param('playerId') playerId: string,
    @Body() body: { coin?: string; amount?: number },
  ) {
    try {
      const tx = this.game.deposit(playerId, body?.coin ?? '', body?.amount ?? 0);
      return { ok: true, tx, balance: this.game.getPlayer(playerId)?.balance };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Post('wallet/:playerId/withdraw')
  withdraw(
    @Param('playerId') playerId: string,
    @Body() body: { coin?: string; amount?: number },
  ) {
    try {
      const tx = this.game.withdraw(
        playerId,
        body?.coin ?? '',
        body?.amount ?? 0,
      );
      return { ok: true, tx, balance: this.game.getPlayer(playerId)?.balance };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Get('wallet/:playerId/transactions')
  transactions(@Param('playerId') playerId: string) {
    return this.game.getTransactions(playerId);
  }

  @Get('rounds/recent')
  recent() {
    return this.game.getHistory().map((r) => ({
      roundId: r.roundId,
      index: r.index,
      winningChain: r.winningChain,
      winningTxid: r.winningTxid,
      totalStaked: r.totalStaked,
      totalPaidOut: r.totalPaidOut,
      awards: r.awards,
      settledAt: r.settledAt,
    }));
  }

  /** Provably-fair verification: recompute the result from revealed inputs. */
  @Get('verify/:roundId')
  verify(@Param('roundId') roundId: string) {
    const round = this.game.findSettled(roundId);
    if (!round) {
      throw new NotFoundException('Round not found (only recent rounds kept)');
    }
    const valid = verifyRound({
      roundId: round.roundId,
      serverSeed: round.serverSeed,
      commitHash: round.commitHash,
      beacon: round.beacon,
      resultHash: round.resultHash,
      winningChain: round.winningChain,
      winningTxid: round.winningTxid,
      coinPool: round.coinPool,
    });
    return {
      roundId: round.roundId,
      valid,
      commitHash: round.commitHash,
      serverSeed: round.serverSeed,
      beacon: round.beacon,
      resultHash: round.resultHash,
      coinPool: round.coinPool,
      winningChain: round.winningChain,
      winningTxid: round.winningTxid,
    };
  }

  /**
   * Operator stats. NOTE: in production this must sit behind the admin auth
   * boundary (RBAC + 2FA + IP allowlist) described in the spec. It is open here
   * only because this is a local play-money prototype.
   */
  @Get('admin/stats')
  adminStats() {
    return this.game.getStats();
  }
}
