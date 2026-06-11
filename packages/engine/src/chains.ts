/**
 * Chain definitions. Every chain has its own alphabet, so probability
 * distributions (and therefore fair odds) must be computed per chain.
 */

export type ChainId = 'BTC' | 'ETH' | 'TRX' | 'SOL';

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

export const CHAINS: Record<ChainId, ChainSpec> = {
  BTC: { id: 'BTC', name: 'Bitcoin', alphabet: HEX, length: 64, prefix: '' },
  ETH: { id: 'ETH', name: 'Ethereum', alphabet: HEX, length: 64, prefix: '0x' },
  TRX: { id: 'TRX', name: 'Tron', alphabet: HEX, length: 64, prefix: '' },
  SOL: { id: 'SOL', name: 'Solana', alphabet: BASE58, length: 88, prefix: '' },
};

export const CHAIN_IDS: ChainId[] = ['BTC', 'ETH', 'TRX', 'SOL'];

export function getChain(id: ChainId): ChainSpec {
  const spec = CHAINS[id];
  if (!spec) {
    throw new Error(`Unknown chain: ${id}`);
  }
  return spec;
}
