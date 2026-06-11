import { describe, it, expect, afterEach } from 'vitest';
import { GameService } from '../src/game/game.service';
import { GAME_CONFIG } from '../src/config';

describe('GameService', () => {
  let svc: GameService;

  afterEach(() => {
    svc?.stop();
  });

  it('registers a player with the starting balance', () => {
    svc = new GameService();
    const player = svc.registerPlayer(undefined, 'Alice', 'USD');
    expect(player.balance).toBe(GAME_CONFIG.startingBalance);
    expect(player.currency).toBe('USD');
  });

  it('accepts a bet during the betting phase and debits the balance', () => {
    svc = new GameService();
    svc.start();
    const player = svc.registerPlayer(undefined, 'Bob', 'USD');
    const bet = svc.placeBet({
      playerId: player.id,
      type: 'LAST_CHAR_DIGIT',
      selection: {},
      amount: 10,
    });
    expect(bet.amount).toBe(10);
    expect(svc.getPlayer(player.id)?.balance).toBe(
      GAME_CONFIG.startingBalance - 10,
    );
    expect(svc.getPublicState().betCount).toBe(1);
  });

  it('rejects bets below the minimum', () => {
    svc = new GameService();
    svc.start();
    const player = svc.registerPlayer(undefined, 'Carol', 'USD');
    expect(() =>
      svc.placeBet({
        playerId: player.id,
        type: 'LAST_CHAR_DIGIT',
        selection: {},
        amount: 0.01,
      }),
    ).toThrow(/Minimum bet/);
  });
});
