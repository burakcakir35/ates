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
  resolveJackpots,
  deriveWinningTxid,
  generateServerSeed,
  getChain,
  complementaryGroup,
  hasIdenticalTail,
  initJackpot,
  isCounterBet,
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
  // Lifetime jackpot accounting (USD) — every payout is drawn from the pools
  // above and never minted, so totalJackpotPaidUsd <= total contributions.
  private jackpotPaidUsd = 0;
  private jackpotCappedCount = 0;
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

    // Anti-arbitrage: reject a bet that completes a guaranteed-win counter-set
    // (e.g. odd + even) this player already opened in the same round.
    const conflict = this.round.bets.find(
      (existing) =>
        existing.playerId === player.id &&
        isCounterBet(
          { type: existing.type, selection: existing.selection },
          { type: bet.type, selection: bet.selection },
        ),
    );
    if (conflict) {
      throw new Error(
        'Counter-bet not allowed: you already bet the opposite outcome of this ' +
          'set this round',
      );
    }

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
    // Lock in the side this player already committed for each complementary
    // group so auto-pick can never complete a guaranteed-win counter-set
    // (auto-pick is internally conflict-free; this also respects manual bets).
    const locked = new Map<string, { type: BetTypeId; selection: BetSelection }>();
    for (const existing of this.round.bets) {
      if (existing.playerId !== playerId) {
        continue;
      }
      const g = complementaryGroup(existing.type, existing.selection);
      if (g) {
        locked.set(g.group, {
          type: existing.type,
          selection: existing.selection,
        });
      }
    }

    const placed: { betId: string; type: BetTypeId; selection: BetSelection }[] =
      [];
    for (const raw of autoPick(count)) {
      let pick: { type: BetTypeId; selection: BetSelection } = raw;
      const g = complementaryGroup(pick.type, pick.selection);
      if (g) {
        const lk = locked.get(g.group);
        if (lk) {
          pick = lk;
        } else {
          locked.set(g.group, pick);
        }
      }
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
    // Pools and jackpot maths are denominated in USD; convert to player fiat
    // only at payout time.
    const stakeUsdByPlayer = new Map<string, number>();

    for (const bet of round.bets) {
      // Progressive pools are denominated in USD.
      contribute(this.jackpot, bet.amountUsd, DEFAULT_JACKPOT_CONFIG);
      stakeUsdByPlayer.set(
        bet.playerId,
        (stakeUsdByPlayer.get(bet.playerId) ?? 0) + bet.amountUsd,
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

    const jackpotPaidBeforeUsd = this.jackpotPaidUsd;
    const awards = this.processJackpots(
      wonByPlayer,
      stakeUsdByPlayer,
      winningChain,
      txid,
    );
    const jackpotPaidUsdThisRound = this.jackpotPaidUsd - jackpotPaidBeforeUsd;

    // Round totals are normalized to USD (players may bet in any fiat).
    const totalStakedUsd = round.bets.reduce((s, b) => s + b.amountUsd, 0);
    // Total paid out = regular settlement payouts + jackpot awards (the latter
    // come from the pools, so they are a real house outflow this round).
    let totalPaidUsd = jackpotPaidUsdThisRound;
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
   * Resolve jackpot tiers via the pure engine resolver. Every tier — including
   * MINI/MINOR — is paid strictly FROM the progressive pools (funded by the 4%
   * contribution), capped at the pool balance. The house never mints jackpot
   * money, so no player strategy (including single-side streak farming) can
   * drive the house negative. Awards are converted to each player's fiat.
   */
  private processJackpots(
    wonByPlayer: Set<string>,
    stakeUsdByPlayer: Map<string, number>,
    winningChain: ChainId,
    txid: string,
  ): JackpotAward[] {
    const cfg = DEFAULT_JACKPOT_CONFIG;

    const outcomes = [...stakeUsdByPlayer.entries()]
      .filter(([id]) => this.players.has(id))
      .map(([playerId, stakeUsd]) => ({
        playerId,
        stakeUsd,
        won: wonByPlayer.has(playerId),
      }));

    const streaks = new Map<string, number>();
    for (const o of outcomes) {
      streaks.set(o.playerId, this.players.get(o.playerId)!.streak);
    }

    const hasTail = hasIdenticalTail(winningChain, txid, cfg.grandTailLength);
    const res = resolveJackpots(this.jackpot, streaks, outcomes, hasTail, cfg);

    // Sync streaks back to the players.
    for (const [playerId, streak] of streaks) {
      const player = this.players.get(playerId);
      if (player) {
        player.streak = streak;
      }
    }

    this.jackpotPaidUsd =
      Math.round((this.jackpotPaidUsd + res.paidUsd) * 100) / 100;
    this.jackpotCappedCount += res.cappedCount;

    const awards: JackpotAward[] = [];
    for (const a of res.awards) {
      const player = this.players.get(a.playerId);
      if (!player) {
        continue;
      }
      const rounded =
        Math.round(convert(a.amountUsd, 'USD', player.currency) * 100) / 100;
      player.balance = Math.round((player.balance + rounded) * 100) / 100;
      this.logger.log(
        `Jackpot ${a.tier} of ${rounded} ${player.currency} -> ${player.id}`,
      );
      awards.push({ playerId: player.id, tier: a.tier, amount: rounded });
    }
    return awards;
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
      // Lifetime jackpot accounting: every payout came from the pools above,
      // never minted by the house. `capped` counts payouts clipped to a short
      // pool (pool can never go negative).
      jackpotPaidTotal: Math.round(this.jackpotPaidUsd * 100) / 100,
      jackpotCappedPayouts: this.jackpotCappedCount,
    };
  }

  /** Operator view of every player (admin-only; not exposed to players). */
  listPlayers() {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      currency: p.currency,
      balance: p.balance,
      streak: p.streak,
    }));
  }

  /** Operator balance adjustment (credit/debit), used by the finance role. */
  adjustBalance(playerId: string, delta: number) {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error('Unknown player');
    }
    if (!Number.isFinite(delta)) {
      throw new Error('Invalid amount');
    }
    player.balance = Math.round((player.balance + delta) * 100) / 100;
    this.emitWallet(player);
    return { id: player.id, balance: player.balance };
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
