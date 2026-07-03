// src/core/rng.ts
//
// The core's ONLY source of randomness — a seeded, deterministic PRNG
// (mulberry32). The seed is carried in GameState so that stepGame() produces
// identical output for identical input. Ported 1:1 from star-wars'
// src/core/rng.ts, which itself mirrors tempest's pattern.

export interface Rng {
  seed: number
}

export function createRng(seed: number): Rng {
  return { seed: seed >>> 0 }
}

/** Advance the generator and return a float in [0, 1). Mutates `rng.seed`. */
export function nextFloat(rng: Rng): number {
  rng.seed = (rng.seed + 0x6d2b79f5) >>> 0
  let t = rng.seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Integer in [0, n). */
export function nextInt(rng: Rng, n: number): number {
  return Math.floor(nextFloat(rng) * n)
}
