import { EventEmitter } from 'events';
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import {
  BetResult,
  BetSelection,
  BetTypeId,
  CHAIN_IDS,
  ChainId,
  DEFAULT_JACKPOT_CONFIG,
  JackpotPools,
  autoPick,
  captureBeacon,
  commit,
  computeResultHash,
  contribute,
  deriveWinningTxid,
  generateServerSeed,
  getChain,
  hasIdenticalTail,
  initJackpot,
  payoutMultiplier,
  selectCoinPool,
  selectWinningCoin,
  settleRound,
} from '@ates/engine';
import { Currency, GAME_CONFIG, RoundPhase } from '../config';
import { CoinTicker, convert, getRate, isCoin } from '../fx';
import {
  ActiveBet,
  JackpotAward,
  PlaceBetInput,
  Player,
  PublicRoundState,
  Round,
  SettledRound,
  WalletTx,
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
      transactions: [],
    };
    this.players.set(player.id, player);
    return player;
  }

  getPlayer(id: string): Player | undefined {
    return this.players.get(id);
  }

  // ---- betting ----------------------------------------------------------

  /** Min/max bet thresholds in the player's fiat (limits are USD in config). */
  betLimitsFor(currency: Currency): { min: number; max: number } {
    const rate = getRate('USD', currency);
    return {
      min: Math.round(GAME_CONFIG.minBet * rate * 100) / 100,
      max: Math.round(GAME_CONFIG.maxBet * rate * 100) / 100,
    };
  }

  placeBet(input: PlaceBetInput): ActiveBet {
    const player = this.players.get(input.playerId);
    if (!player) {
      throw new Error('Unknown player');
    }
    if (this.round.phase !== 'betting') {
      throw new Error('Betting is closed for this round');
    }
    if (!Number.isFinite(input.amount)) {
      throw new Error('Invalid amount');
    }
    const limits = this.betLimitsFor(player.currency);
    if (input.amount < limits.min) {
      throw new Error(
        `Minimum bet is ${limits.min} ${player.currency} (${GAME_CONFIG.minBet} USD)`,
      );
    }
    if (input.amount > limits.max) {
      throw new Error(
        `Maximum bet is ${limits.max} ${player.currency} (${GAME_CONFIG.maxBet} USD)`,
      );
    }
    if (input.amount > player.balance) {
      throw new Error('Insufficient balance');
    }

    const amount = Math.round(input.amount * 100) / 100;
    const bet: ActiveBet = {
      id: uuid(),
      playerId: player.id,
      betType: input.type,
      type: input.type,
      selection: input.selection,
      amount,
      amountUsd: Math.round(convert(amount, player.currency, 'USD') * 100) / 100,
    };
    // Validates the bet type/selection up front (throws on unknown type).
    this.maxPoolMultiplier(bet.type, bet.selection);

    // Risk control: worst-case exposure across the whole coin pool, in USD.
    const projected = this.projectedExposureUsd([...this.round.bets, bet]);
    if (projected > GAME_CONFIG.maxRoundExposure) {
      throw new Error('Round exposure cap reached, try a smaller bet');
    }

    player.balance = Math.round((player.balance - bet.amount) * 100) / 100;
    this.round.bets.push(bet);
    this.emitWallet(player);
    this.emitState();
    return bet;
  }

  /** Auto-pick: place `count` random bets through the normal bet flow. */
  autoPlaceBets(
    playerId: string,
    count: number,
    amount: number,
  ): { placed: { betId: string; type: BetTypeId; selection: BetSelection }[] } {
    const picks = autoPick(count);
    const placed: { betId: string; type: BetTypeId; selection: BetSelection }[] =
      [];
    for (const pick of picks) {
      const bet = this.placeBet({
        playerId,
        type: pick.type,
        selection: pick.selection,
        amount,
      });
      placed.push({ betId: bet.id, type: pick.type, selection: pick.selection });
    }
    return { placed };
  }

  // ---- wallet: mock crypto deposits/withdrawals via FX ------------------

  deposit(playerId: string, coin: string, coinAmount: number): WalletTx {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error('Unknown player');
    }
    if (!isCoin(coin)) {
      throw new Error(`Unsupported coin: ${coin}`);
    }
    if (!Number.isFinite(coinAmount) || coinAmount <= 0) {
      throw new Error('Amount must be > 0');
    }
    const rate = getRate(coin as CoinTicker, player.currency);
    const fiatAmount = Math.round(coinAmount * rate * 100) / 100;
    const tx: WalletTx = {
      id: uuid(),
      type: 'deposit',
      coin,
      coinAmount,
      rate,
      fiatAmount,
      currency: player.currency,
      at: Date.now(),
    };
    player.balance = Math.round((player.balance + fiatAmount) * 100) / 100;
    player.transactions.unshift(tx);
    this.emitWallet(player);
    return tx;
  }

  withdraw(playerId: string, coin: string, fiatAmount: number): WalletTx {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error('Unknown player');
    }
    if (!isCoin(coin)) {
      throw new Error(`Unsupported coin: ${coin}`);
    }
    if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
      throw new Error('Amount must be > 0');
    }
    if (fiatAmount > player.balance) {
      throw new Error('Insufficient balance');
    }
    const rate = getRate(coin as CoinTicker, player.currency);
    const coinAmount = fiatAmount / rate;
    const tx: WalletTx = {
      id: uuid(),
      type: 'withdraw',
      coin,
      coinAmount,
      rate,
      fiatAmount: Math.round(fiatAmount * 100) / 100,
      currency: player.currency,
      at: Date.now(),
    };
    player.balance = Math.round((player.balance - tx.fiatAmount) * 100) / 100;
    player.transactions.unshift(tx);
    this.emitWallet(player);
    return tx;
  }

  getTransactions(playerId: string): WalletTx[] {
    return this.players.get(playerId)?.transactions ?? [];
  }

  /** Highest payout multiplier a bet could hit across this round's pool. */
  private maxPoolMultiplier(type: BetTypeId, selection: BetSelection): number {
    let max = 0;
    for (const coin of this.round.coinPool) {
      try {
        max = Math.max(
          max,
          payoutMultiplier(type, coin, selection, GAME_CONFIG.houseEdge),
        );
      } catch {
        // Selection not applicable to this coin's alphabet — skip it.
      }
    }
    if (max === 0) {
      throw new Error(`Unknown bet type: ${type}`);
    }
    return max;
  }

  private projectedExposureUsd(bets: ActiveBet[]): number {
    let total = 0;
    for (const bet of bets) {
      total += bet.amountUsd * this.maxPoolMultiplier(bet.type, bet.selection);
    }
    return Math.round(total * 100) / 100;
  }

  // ---- round lifecycle --------------------------------------------------

  private beginBetting(): void {
    this.roundCounter += 1;
    const serverSeed = generateServerSeed();
    const id = uuid();
    const commitHash = commit(serverSeed);
    // The 20-coin pool is fixed at commit time and publicly re-derivable
    // from commitHash + roundId; the winner is drawn from it after the lock.
    const coinPool = selectCoinPool(commitHash, id);
    this.round = {
      id,
      index: this.roundCounter,
      phase: 'betting',
      coinPool,
      serverSeed,
      commitHash,
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
    this.round.winningChain = selectWinningCoin(
      this.round.resultHash,
      this.round.coinPool,
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
    const winningChain = round.winningChain as ChainId;
    const settlement = settleRound(
      round.bets,
      winningChain,
      txid,
      GAME_CONFIG.houseEdge,
    );

    // Credit winnings and accumulate jackpot contributions.
    const byPlayer: Record<string, BetResult[]> = {};
    const wonByPlayer = new Set<string>();
    const stakeByPlayer = new Map<string, number>();

    for (const bet of round.bets) {
      // Progressive pools are denominated in USD.
      contribute(this.jackpot, bet.amountUsd, DEFAULT_JACKPOT_CONFIG);
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
      winningChain,
      txid,
    );

    // Round totals are normalized to USD (players may bet in any fiat).
    const totalStakedUsd = round.bets.reduce((s, b) => s + b.amountUsd, 0);
    let totalPaidUsd = 0;
    for (const result of settlement.results) {
      if (result.won) {
        const player = this.players.get(result.playerId);
        const cur = player?.currency ?? 'USD';
        totalPaidUsd += convert(result.payout, cur, 'USD');
      }
    }

    const settled: SettledRound = {
      roundId: round.id,
      index: round.index,
      coinPool: round.coinPool,
      winningChain,
      winningTxid: txid,
      serverSeed: round.serverSeed,
      commitHash: round.commitHash,
      resultHash: round.resultHash as string,
      beacon: round.beacon!,
      totalStaked: Math.round(totalStakedUsd * 100) / 100,
      totalPaidOut: Math.round(totalPaidUsd * 100) / 100,
      housePnl: Math.round((totalStakedUsd - totalPaidUsd) * 100) / 100,
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
    winningChain: ChainId,
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
        // Progressive pools are USD; award in the player's fiat.
        awards.push(
          this.payAward(
            player,
            'MAJOR',
            convert(this.jackpot.major, 'USD', player.currency),
          ),
        );
        this.jackpot.major = cfg.majorSeed;
      } else if (player.streak >= cfg.grandStreak) {
        awards.push(
          this.payAward(
            player,
            'GRAND',
            convert(this.jackpot.grand, 'USD', player.currency),
          ),
        );
        this.jackpot.grand = cfg.grandSeed;
        player.streak = 0;
      }
    }

    // Pure-chance Grand gate: winning txid ends in N identical characters.
    if (hasIdenticalTail(winningChain, txid, cfg.grandTailLength)) {
      const winners = [...wonByPlayer];
      if (winners.length > 0) {
        const shareUsd = this.jackpot.grand / winners.length;
        for (const playerId of winners) {
          const player = this.players.get(playerId);
          if (player) {
            awards.push(
              this.payAward(
                player,
                'GRAND_TAIL',
                convert(shareUsd, 'USD', player.currency),
              ),
            );
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
    const totalStakedUsd = this.round.bets.reduce((s, b) => s + b.amountUsd, 0);
    const ranges: PublicRoundState['multiplierRanges'] = {};
    const samples: Record<string, BetSelection> = {
      LAST_CHAR_DIGIT: {},
      LAST_CHAR_LETTER: {},
      LAST_CHAR_PARITY: { parity: 'even' },
      FIRST_CHAR_RANGE: { range: 'high' },
      SUM_PARITY: { parity: 'even' },
    };
    for (const [type, selection] of Object.entries(samples)) {
      let min = Infinity;
      let max = 0;
      for (const coin of this.round.coinPool) {
        try {
          const m = payoutMultiplier(
            type as BetTypeId,
            coin,
            selection,
            GAME_CONFIG.houseEdge,
          );
          min = Math.min(min, m);
          max = Math.max(max, m);
        } catch {
          // not applicable for this coin
        }
      }
      ranges[type] = { min: min === Infinity ? 0 : min, max };
    }
    return {
      roundId: this.round.id,
      index: this.round.index,
      phase: this.round.phase,
      coinPool: this.round.coinPool.map((id) => ({
        id,
        name: getChain(id).name,
      })),
      winningChain:
        this.round.phase === 'betting' ? null : this.round.winningChain ?? null,
      commitHash: this.round.commitHash,
      phaseEndsAt: this.round.phaseEndsAt,
      totalStaked: Math.round(totalStakedUsd * 100) / 100,
      betCount: this.round.bets.length,
      jackpot: {
        major: Math.round(this.jackpot.major * 100) / 100,
        grand: Math.round(this.jackpot.grand * 100) / 100,
      },
      multiplierRanges: ranges,
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
