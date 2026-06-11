import { EventEmitter } from 'events';
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import {
  BetResult,
  CHAIN_IDS,
  DEFAULT_JACKPOT_CONFIG,
  JackpotPools,
  captureBeacon,
  commit,
  computeResultHash,
  contribute,
  deriveWinningTxid,
  generateServerSeed,
  hasIdenticalTail,
  initJackpot,
  maxExposure,
  payoutMultiplier,
  settleRound,
} from '@ates/engine';
import { Currency, GAME_CONFIG, RoundPhase } from '../config';
import {
  ActiveBet,
  JackpotAward,
  PlaceBetInput,
  Player,
  PublicRoundState,
  Round,
  SettledRound,
} from './game.types';

export interface ResultEvent {
  settled: SettledRound;
  /** Per-player bet outcomes for this round. */
  byPlayer: Record<string, BetResult[]>;
}

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);
  readonly events = new EventEmitter();

  private players = new Map<string, Player>();
  private round!: Round;
  private roundCounter = 0;
  private jackpot: JackpotPools = initJackpot(DEFAULT_JACKPOT_CONFIG);
  private history: SettledRound[] = [];
  private timer: NodeJS.Timeout | null = null;
  private started = false;

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.beginBetting();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.started = false;
  }

  // ---- players ----------------------------------------------------------

  registerPlayer(id: string | undefined, name: string, currency: Currency): Player {
    if (id) {
      const existing = this.players.get(id);
      if (existing) {
        return existing;
      }
    }
    const player: Player = {
      id: id ?? uuid(),
      name: name || 'Guest',
      currency,
      balance: GAME_CONFIG.startingBalance,
      streak: 0,
    };
    this.players.set(player.id, player);
    return player;
  }

  getPlayer(id: string): Player | undefined {
    return this.players.get(id);
  }

  // ---- betting ----------------------------------------------------------

  placeBet(input: PlaceBetInput): ActiveBet {
    const player = this.players.get(input.playerId);
    if (!player) {
      throw new Error('Unknown player');
    }
    if (this.round.phase !== 'betting') {
      throw new Error('Betting is closed for this round');
    }
    if (input.amount < GAME_CONFIG.minBet) {
      throw new Error(`Minimum bet is ${GAME_CONFIG.minBet}`);
    }
    if (input.amount > GAME_CONFIG.maxBet) {
      throw new Error(`Maximum bet is ${GAME_CONFIG.maxBet}`);
    }
    if (input.amount > player.balance) {
      throw new Error('Insufficient balance');
    }

    const bet: ActiveBet = {
      id: uuid(),
      playerId: player.id,
      betType: input.type,
      type: input.type,
      selection: input.selection,
      amount: Math.round(input.amount * 100) / 100,
    };

    // Risk control: refuse bets that would push round exposure over the cap.
    const projected = maxExposure(
      [...this.round.bets, bet],
      this.round.winningChain,
      GAME_CONFIG.houseEdge,
    );
    if (projected > GAME_CONFIG.maxRoundExposure) {
      throw new Error('Round exposure cap reached, try a smaller bet');
    }

    player.balance = Math.round((player.balance - bet.amount) * 100) / 100;
    this.round.bets.push(bet);
    this.emitWallet(player);
    this.emitState();
    return bet;
  }

  // ---- round lifecycle --------------------------------------------------

  private beginBetting(): void {
    this.roundCounter += 1;
    const serverSeed = generateServerSeed();
    const winningChain =
      CHAIN_IDS[Math.floor(Math.random() * CHAIN_IDS.length)];
    this.round = {
      id: uuid(),
      index: this.roundCounter,
      phase: 'betting',
      winningChain,
      serverSeed,
      commitHash: commit(serverSeed),
      bets: [],
      phaseEndsAt: Date.now() + GAME_CONFIG.bettingMs,
    };
    this.emitState();
    this.schedule(GAME_CONFIG.bettingMs, () => this.lockRound());
  }

  private lockRound(): void {
    this.setPhase('locking', GAME_CONFIG.lockingMs);
    // Beacon is captured *after* bets lock, so nobody can front-run it.
    this.round.beacon = captureBeacon();
    this.round.resultHash = computeResultHash(
      this.round.serverSeed,
      this.round.beacon,
      this.round.id,
    );
    this.round.winningTxid = deriveWinningTxid(
      this.round.resultHash,
      this.round.winningChain,
    );
    this.schedule(GAME_CONFIG.lockingMs, () => this.revealRound());
  }

  private revealRound(): void {
    const round = this.round;
    const txid = round.winningTxid as string;
    const settlement = settleRound(
      round.bets,
      round.winningChain,
      txid,
      GAME_CONFIG.houseEdge,
    );

    // Credit winnings and accumulate jackpot contributions.
    const byPlayer: Record<string, BetResult[]> = {};
    const wonByPlayer = new Set<string>();
    const stakeByPlayer = new Map<string, number>();

    for (const bet of round.bets) {
      contribute(this.jackpot, bet.amount, DEFAULT_JACKPOT_CONFIG);
      stakeByPlayer.set(
        bet.playerId,
        (stakeByPlayer.get(bet.playerId) ?? 0) + bet.amount,
      );
    }

    for (const result of settlement.results) {
      (byPlayer[result.playerId] ??= []).push(result);
      if (result.won) {
        wonByPlayer.add(result.playerId);
        const player = this.players.get(result.playerId);
        if (player) {
          player.balance =
            Math.round((player.balance + result.payout) * 100) / 100;
        }
      }
    }

    const awards = this.processJackpots(
      wonByPlayer,
      stakeByPlayer,
      round.winningChain,
      txid,
    );

    const settled: SettledRound = {
      roundId: round.id,
      index: round.index,
      winningChain: round.winningChain,
      winningTxid: txid,
      serverSeed: round.serverSeed,
      commitHash: round.commitHash,
      resultHash: round.resultHash as string,
      beacon: round.beacon!,
      totalStaked: settlement.totalStaked,
      totalPaidOut: settlement.totalPaidOut,
      housePnl: settlement.housePnl,
      awards,
      settledAt: Date.now(),
    };
    this.history.unshift(settled);
    this.history = this.history.slice(0, 50);

    round.phase = 'result';
    round.phaseEndsAt = Date.now() + GAME_CONFIG.resultMs;

    this.events.emit('result', { settled, byPlayer } as ResultEvent);
    // Push fresh balances to everyone who took part.
    for (const playerId of new Set(round.bets.map((b) => b.playerId))) {
      const player = this.players.get(playerId);
      if (player) {
        this.emitWallet(player);
      }
    }
    this.emitState();
    this.schedule(GAME_CONFIG.resultMs, () => this.beginBetting());
  }

  /**
   * Resolve jackpot tiers from per-player streaks and the pure-chance tail
   * gate, paying out and resetting progressive pools as needed.
   */
  private processJackpots(
    wonByPlayer: Set<string>,
    stakeByPlayer: Map<string, number>,
    winningChain: Round['winningChain'],
    txid: string,
  ): JackpotAward[] {
    const cfg = DEFAULT_JACKPOT_CONFIG;
    const awards: JackpotAward[] = [];

    for (const [playerId, stake] of stakeByPlayer) {
      const player = this.players.get(playerId);
      if (!player) {
        continue;
      }
      if (wonByPlayer.has(playerId)) {
        player.streak += 1;
      } else {
        player.streak = 0;
        continue;
      }

      if (player.streak === 3) {
        awards.push(this.payAward(player, 'MINI', stake * cfg.miniMultiplier));
      } else if (player.streak === 5) {
        awards.push(this.payAward(player, 'MINOR', stake * cfg.minorMultiplier));
      } else if (player.streak === cfg.grandStreak - 1) {
        awards.push(this.payAward(player, 'MAJOR', this.jackpot.major));
        this.jackpot.major = cfg.majorSeed;
      } else if (player.streak >= cfg.grandStreak) {
        awards.push(this.payAward(player, 'GRAND', this.jackpot.grand));
        this.jackpot.grand = cfg.grandSeed;
        player.streak = 0;
      }
    }

    // Pure-chance Grand gate: winning txid ends in N identical characters.
    if (hasIdenticalTail(winningChain, txid, cfg.grandTailLength)) {
      const winners = [...wonByPlayer];
      if (winners.length > 0) {
        const share = this.jackpot.grand / winners.length;
        for (const playerId of winners) {
          const player = this.players.get(playerId);
          if (player) {
            awards.push(this.payAward(player, 'GRAND_TAIL', share));
          }
        }
        this.jackpot.grand = cfg.grandSeed;
      }
    }

    return awards;
  }

  private payAward(player: Player, tier: string, amount: number): JackpotAward {
    const rounded = Math.round(amount * 100) / 100;
    player.balance = Math.round((player.balance + rounded) * 100) / 100;
    this.logger.log(`Jackpot ${tier} of ${rounded} -> ${player.id}`);
    return { playerId: player.id, tier, amount: rounded };
  }

  // ---- helpers ----------------------------------------------------------

  private setPhase(phase: RoundPhase, durationMs: number): void {
    this.round.phase = phase;
    this.round.phaseEndsAt = Date.now() + durationMs;
    this.emitState();
  }

  private schedule(ms: number, fn: () => void): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(fn, ms);
  }

  private emitState(): void {
    this.events.emit('state', this.getPublicState());
  }

  private emitWallet(player: Player): void {
    this.events.emit('wallet', {
      playerId: player.id,
      balance: player.balance,
      currency: player.currency,
      streak: player.streak,
    });
  }

  getPublicState(): PublicRoundState {
    const totalStaked = this.round.bets.reduce((s, b) => s + b.amount, 0);
    return {
      roundId: this.round.id,
      index: this.round.index,
      phase: this.round.phase,
      winningChain: this.round.winningChain,
      commitHash: this.round.commitHash,
      phaseEndsAt: this.round.phaseEndsAt,
      totalStaked: Math.round(totalStaked * 100) / 100,
      betCount: this.round.bets.length,
      jackpot: {
        major: Math.round(this.jackpot.major * 100) / 100,
        grand: Math.round(this.jackpot.grand * 100) / 100,
      },
    };
  }

  getHistory(): SettledRound[] {
    return this.history;
  }

  findSettled(roundId: string): SettledRound | undefined {
    return this.history.find((r) => r.roundId === roundId);
  }

  getStats() {
    const totalStaked = this.history.reduce((s, r) => s + r.totalStaked, 0);
    const totalPaidOut = this.history.reduce((s, r) => s + r.totalPaidOut, 0);
    return {
      players: this.players.size,
      roundsPlayed: this.roundCounter,
      recentTotalStaked: Math.round(totalStaked * 100) / 100,
      recentTotalPaidOut: Math.round(totalPaidOut * 100) / 100,
      recentHousePnl: Math.round((totalStaked - totalPaidOut) * 100) / 100,
      jackpot: {
        major: Math.round(this.jackpot.major * 100) / 100,
        grand: Math.round(this.jackpot.grand * 100) / 100,
      },
    };
  }

  /** Bet catalogue with per-chain payout multipliers, for the UI. */
  getBetCatalogue() {
    const sampleSelections: Record<string, Record<string, unknown>> = {
      LAST_CHAR_DIGIT: {},
      LAST_CHAR_LETTER: {},
      LAST_CHAR_PARITY: { parity: 'even' },
      FIRST_CHAR_RANGE: { range: 'high' },
      SUM_PARITY: { parity: 'even' },
      SUM_MOD: { mod: 10, residue: 0 },
      EXACT_LAST_CHAR: { char: 'a' },
    };
    return Object.entries(sampleSelections).map(([type, selection]) => ({
      type,
      multipliers: CHAIN_IDS.reduce(
        (acc, chain) => {
          try {
            acc[chain] = payoutMultiplier(
              type as never,
              chain,
              selection as never,
              GAME_CONFIG.houseEdge,
            );
          } catch {
            acc[chain] = 0;
          }
          return acc;
        },
        {} as Record<string, number>,
      ),
    }));
  }
}
