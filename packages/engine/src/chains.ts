/**
 * Coin/chain definitions. Every coin has its own TXID alphabet, so probability
 * distributions (and therefore fair odds) must be computed per coin.
 */

export type ChainId =
  | 'BTC'
  | 'ETH'
  | 'TRX'
  | 'SOL'
  | 'LTC'
  | 'DOGE'
  | 'BCH'
  | 'XRP'
  | 'ADA'
  | 'DOT'
  | 'AVAX'
  | 'MATIC'
  | 'LINK'
  | 'ATOM'
  | 'XLM'
  | 'ALGO'
  | 'NEAR'
  | 'FTM'
  | 'ARB'
  | 'OP'
  | 'TON'
  | 'XMR'
  | 'DASH'
  | 'ZEC';

/** The four major chains whose block hashes feed the result beacon. */
export type BeaconChainId = 'BTC' | 'ETH' | 'TRX' | 'SOL';

export interface ChainSpec {
  id: ChainId;
  name: string;
  /** Characters that can appear in the hash, in canonical order. */
  alphabet: string;
  /** Hash length, excluding any prefix. */
  length: number;
  /** Optional fixed prefix (e.g. "0x" for Ethereum). */
  prefix: string;
}

const HEX = '0123456789abcdef';
// Base58 (Bitcoin alphabet) — note the absence of 0, O, I and l.
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const hex = (id: ChainId, name: string, prefix = ''): ChainSpec => ({
  id,
  name,
  alphabet: HEX,
  length: 64,
  prefix,
});
const b58 = (id: ChainId, name: string, length: number): ChainSpec => ({
  id,
  name,
  alphabet: BASE58,
  length,
  prefix: '',
});

export const CHAINS: Record<ChainId, ChainSpec> = {
  BTC: hex('BTC', 'Bitcoin'),
  ETH: hex('ETH', 'Ethereum', '0x'),
  TRX: hex('TRX', 'Tron'),
  SOL: b58('SOL', 'Solana', 88),
  LTC: hex('LTC', 'Litecoin'),
  DOGE: hex('DOGE', 'Dogecoin'),
  BCH: hex('BCH', 'Bitcoin Cash'),
  XRP: hex('XRP', 'XRP Ledger'),
  ADA: hex('ADA', 'Cardano'),
  DOT: hex('DOT', 'Polkadot', '0x'),
  AVAX: hex('AVAX', 'Avalanche', '0x'),
  MATIC: hex('MATIC', 'Polygon', '0x'),
  LINK: hex('LINK', 'Chainlink', '0x'),
  ATOM: hex('ATOM', 'Cosmos'),
  XLM: hex('XLM', 'Stellar'),
  ALGO: b58('ALGO', 'Algorand', 52),
  NEAR: b58('NEAR', 'NEAR', 44),
  FTM: hex('FTM', 'Fantom', '0x'),
  ARB: hex('ARB', 'Arbitrum', '0x'),
  OP: hex('OP', 'Optimism', '0x'),
  TON: b58('TON', 'TON', 44),
  XMR: hex('XMR', 'Monero'),
  DASH: hex('DASH', 'Dash'),
  ZEC: hex('ZEC', 'Zcash'),
};

/** Beacon chains: the multi-chain block-hash beacon uses these four. */
export const CHAIN_IDS: BeaconChainId[] = ['BTC', 'ETH', 'TRX', 'SOL'];

/** Every candidate coin the per-round 20-coin pool can draw from. */
export const COIN_IDS: ChainId[] = Object.keys(CHAINS) as ChainId[];

export function getChain(id: ChainId): ChainSpec {
  const spec = CHAINS[id];
  if (!spec) {
    throw new Error(`Unknown chain: ${id}`);
  }
  return spec;
}
