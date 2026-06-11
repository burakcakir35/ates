import { Currency } from './config';

/**
 * FX (exchange-rate) service for the play-money prototype.
 *
 * Rates are mocked but the interface is the integration point for a real
 * source later (`getRate(from, to)` stays the same; only the table changes).
 * All conversions pivot through USD.
 */

export type CoinTicker =
  | 'BTC'
  | 'ETH'
  | 'SOL'
  | 'TRX'
  | 'USDT'
  | 'LTC'
  | 'DOGE'
  | 'XRP';

export const DEPOSIT_COINS: CoinTicker[] = [
  'BTC',
  'ETH',
  'SOL',
  'TRX',
  'USDT',
  'LTC',
  'DOGE',
  'XRP',
];

/** Mock spot prices: 1 coin = X USD. */
const COIN_USD: Record<CoinTicker, number> = {
  BTC: 100000,
  ETH: 4000,
  SOL: 200,
  TRX: 0.3,
  USDT: 1,
  LTC: 120,
  DOGE: 0.4,
  XRP: 2.5,
};

/** Mock fiat rates: 1 USD = X fiat. */
const USD_FIAT: Record<Currency, number> = {
  USD: 1,
  EUR: 0.92,
  TRY: 41,
  GBP: 0.78,
};

export type FxUnit = CoinTicker | Currency;

function usdValue(unit: FxUnit): number {
  if (unit in COIN_USD) {
    return COIN_USD[unit as CoinTicker];
  }
  if (unit in USD_FIAT) {
    return 1 / USD_FIAT[unit as Currency];
  }
  throw new Error(`Unknown FX unit: ${unit}`);
}

/** How many `to` units one `from` unit is worth. */
export function getRate(from: FxUnit, to: FxUnit): number {
  return usdValue(from) / usdValue(to);
}

/** Convert an amount between any two known units (coin or fiat). */
export function convert(amount: number, from: FxUnit, to: FxUnit): number {
  return amount * getRate(from, to);
}

export function isCoin(unit: string): unit is CoinTicker {
  return unit in COIN_USD;
}

export function getAllRates() {
  return { coinUsd: { ...COIN_USD }, usdFiat: { ...USD_FIAT } };
}
