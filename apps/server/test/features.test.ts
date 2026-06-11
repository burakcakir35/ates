import { describe, it, expect, afterEach } from 'vitest';
import { COIN_POOL_SIZE, selectCoinPool } from '@ates/engine';
import { GameService } from '../src/game/game.service';
import { GAME_CONFIG } from '../src/config';
import { convert, getRate } from '../src/fx';

describe('20-coin pool', () => {
  let svc: GameService;
  afterEach(() => svc?.stop());

  it('every round exposes a 20-coin pool with no winner during betting', () => {
    svc = new GameService();
    svc.start();
    const state = svc.getPublicState();
    expect(state.coinPool).toHaveLength(COIN_POOL_SIZE);
    expect(new Set(state.coinPool.map((c) => c.id)).size).toBe(COIN_POOL_SIZE);
    expect(state.winningChain).toBeNull();
    expect(Object.keys(state.multiplierRanges).length).toBeGreaterThan(0);
  });

  it('pool is re-derivable from public commitHash + roundId', () => {
    svc = new GameService();
    svc.start();
    const state = svc.getPublicState();
    const rederived = selectCoinPool(state.commitHash, state.roundId);
    expect(state.coinPool.map((c) => c.id)).toEqual(rederived);
  });
});

describe('crypto→fiat FX', () => {
  let svc: GameService;
  afterEach(() => svc?.stop());

  it('deposit converts coin to the player fiat with an audit record', () => {
    svc = new GameService();
    svc.start();
    const player = svc.registerPlayer(undefined, 'Tülay', 'TRY');
    const before = player.balance;
    const tx = svc.deposit(player.id, 'USDT', 100);
    const expected = Math.round(100 * getRate('USDT', 'TRY') * 100) / 100;
    expect(tx.fiatAmount).toBe(expected);
    expect(svc.getPlayer(player.id)?.balance).toBe(before + expected);
    const recorded = svc.getTransactions(player.id)[0];
    expect(recorded.coin).toBe('USDT');
    expect(recorded.coinAmount).toBe(100);
    expect(recorded.rate).toBe(getRate('USDT', 'TRY'));
    expect(recorded.currency).toBe('TRY');
  });

  it('withdraw converts fiat back to coin and debits the balance', () => {
    svc = new GameService();
    svc.start();
    const player = svc.registerPlayer(undefined, 'Wally', 'EUR');
    const before = player.balance;
    const tx = svc.withdraw(player.id, 'SOL', 92);
    expect(tx.coinAmount).toBeCloseTo(convert(92, 'EUR', 'SOL'), 10);
    expect(svc.getPlayer(player.id)?.balance).toBe(before - 92);
  });

  it('rejects bad deposits/withdrawals', () => {
    svc = new GameService();
    svc.start();
    const player = svc.registerPlayer(undefined, 'Nope', 'USD');
    expect(() => svc.deposit(player.id, 'SHIB', 1)).toThrow(/Unsupported coin/);
    expect(() => svc.deposit(player.id, 'BTC', -1)).toThrow(/> 0/);
    expect(() => svc.withdraw(player.id, 'BTC', 10 ** 9)).toThrow(
      /Insufficient/,
    );
  });

  it('min bet threshold is dynamic per fiat (0.5 USD equivalent)', () => {
    svc = new GameService();
    svc.start();
    const tryPlayer = svc.registerPlayer(undefined, 'Taner', 'TRY');
    const minTry =
      Math.round(GAME_CONFIG.minBet * getRate('USD', 'TRY') * 100) / 100;
    expect(svc.betLimitsFor('TRY').min).toBe(minTry);
    // 1 TRY is well above the USD min (0.5) but below the TRY threshold.
    expect(() =>
      svc.placeBet({
        playerId: tryPlayer.id,
        type: 'LAST_CHAR_DIGIT',
        selection: {},
        amount: 1,
      }),
    ).toThrow(/Minimum bet/);
    // At the threshold it is accepted.
    const bet = svc.placeBet({
      playerId: tryPlayer.id,
      type: 'LAST_CHAR_DIGIT',
      selection: {},
      amount: minTry,
    });
    expect(bet.amountUsd).toBeCloseTo(GAME_CONFIG.minBet, 1);
  });
});

describe('auto-pick', () => {
  let svc: GameService;
  afterEach(() => svc?.stop());

  it('places N valid bets through the normal flow with exact debits', () => {
    svc = new GameService();
    svc.start();
    const player = svc.registerPlayer(undefined, 'Auto', 'USD');
    const before = player.balance;
    const { placed } = svc.autoPlaceBets(player.id, 5, 2);
    expect(placed).toHaveLength(5);
    expect(svc.getPlayer(player.id)?.balance).toBe(before - 10);
    expect(svc.getPublicState().betCount).toBe(5);
  });

  it('rejects invalid counts and amounts', () => {
    svc = new GameService();
    svc.start();
    const player = svc.registerPlayer(undefined, 'Auto2', 'USD');
    expect(() => svc.autoPlaceBets(player.id, 0, 2)).toThrow();
    expect(() => svc.autoPlaceBets(player.id, 3, 0.01)).toThrow(/Minimum bet/);
  });
});
