import { createHash } from 'crypto';

/**
 * Deterministic byte stream derived from a seed string. Bytes are produced by
 * hashing `seed || counter` with SHA-256 and consuming the digest, then
 * incrementing the counter. This is deterministic and reproducible, which is
 * what makes the game provably fair: anyone with the seed can replay it.
 */
export class SeededRng {
  private buffer: Buffer = Buffer.alloc(0);
  private offset = 0;
  private counter = 0;

  constructor(private readonly seed: string) {}

  private refill(): void {
    this.buffer = createHash('sha256')
      .update(`${this.seed}:${this.counter}`)
      .digest();
    this.counter += 1;
    this.offset = 0;
  }

  nextByte(): number {
    if (this.offset >= this.buffer.length) {
      this.refill();
    }
    const byte = this.buffer[this.offset];
    this.offset += 1;
    return byte;
  }

  /**
   * Uniform integer in [0, max) using rejection sampling to avoid modulo bias.
   */
  nextInt(max: number): number {
    if (max <= 0) {
      throw new Error('max must be > 0');
    }
    if (max > 256) {
      throw new Error('nextInt only supports max <= 256');
    }
    const limit = Math.floor(256 / max) * max;
    let byte = this.nextByte();
    while (byte >= limit) {
      byte = this.nextByte();
    }
    return byte % max;
  }
}
