// tests/rng.test.ts
//
// AC-1: createRng(seed) + repeated nextFloat/nextInt produce a known,
// reproducible sequence for a fixed seed (golden test). Plus the structural
// invariants a seeded PRNG must uphold: unsigned seed normalisation,
// determinism, range, mutation-advances-state, and independence between
// distinct Rng values.
//
// The golden values below were generated once from the canonical mulberry32
// algorithm the A-2 context specifies (seed normalised with `>>> 0`,
// `nextFloat` advances by 0x6D2B79F5 and runs the xorshift-multiply mix,
// `nextInt(rng, n) = Math.floor(nextFloat(rng) * n)`). They lock the sequence
// so any drift from that algorithm is a regression, exactly as the AC requires.

import { describe, it, expect } from 'vitest'
import { createRng, nextFloat, nextInt, type Rng } from '../src/core/rng'

const GOLDEN_SEED = 12345

// createRng(12345); nextFloat x10
const GOLDEN_FLOATS: readonly number[] = [
  0.9797282677609473,
  0.3067522644996643,
  0.484205421525985,
  0.817934412509203,
  0.5094283693470061,
  0.34747186047025025,
  0.07375754183158278,
  0.7663964673411101,
  0.9968264393974096,
  0.8250224851071835,
]

// createRng(12345); nextInt(rng, 6) x10
const GOLDEN_INTS_N6: readonly number[] = [5, 1, 2, 4, 3, 2, 0, 4, 5, 4]

function take<T>(n: number, fn: () => T): T[] {
  return Array.from({ length: n }, () => fn())
}

describe('createRng', () => {
  it('stores the seed normalised to an unsigned 32-bit integer', () => {
    expect(createRng(GOLDEN_SEED).seed).toBe(12345)
    expect(createRng(0).seed).toBe(0)
  })

  it('masks negative and >32-bit seeds with >>> 0', () => {
    // -1 >>> 0 === 0xFFFFFFFF
    expect(createRng(-1).seed).toBe(4294967295)
    // (2^32 + 1) >>> 0 === 1
    expect(createRng(4294967297).seed).toBe(1)
  })

  it('is a plain serialisable value type ({ seed }), not a class instance', () => {
    const rng: Rng = createRng(GOLDEN_SEED)
    expect(Object.keys(rng)).toEqual(['seed'])
    expect(rng).toEqual({ seed: 12345 })
  })
})

describe('nextFloat', () => {
  it('reproduces the golden sequence for a fixed seed', () => {
    const rng = createRng(GOLDEN_SEED)
    expect(GOLDEN_FLOATS).toHaveLength(10)
    expect(take(GOLDEN_FLOATS.length, () => nextFloat(rng))).toEqual([...GOLDEN_FLOATS])
  })

  it('returns values in [0, 1) across many iterations', () => {
    const rng = createRng(1)
    for (let i = 0; i < 5000; i++) {
      const f = nextFloat(rng)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
    }
  })

  it('is deterministic: two Rngs seeded identically yield identical sequences', () => {
    const a = createRng(GOLDEN_SEED)
    const b = createRng(GOLDEN_SEED)
    expect(take(20, () => nextFloat(a))).toEqual(take(20, () => nextFloat(b)))
  })

  it('produces different sequences for different seeds', () => {
    const a = take(10, () => nextFloat(createRng(1)))
    const b = take(10, () => nextFloat(createRng(2)))
    expect(a).not.toEqual(b)
  })

  it('advances (mutates) the Rng seed on each call', () => {
    const rng = createRng(GOLDEN_SEED)
    const before = rng.seed
    nextFloat(rng)
    expect(rng.seed).not.toBe(before)
  })

  it('keeps distinct Rng values independent (no shared state)', () => {
    const a = createRng(1)
    const b = createRng(1)
    // Drain `a`; `b` must be untouched and still start the seed-1 sequence.
    take(5, () => nextFloat(a))
    expect(b.seed).toBe(1)
    expect(nextFloat(b)).toBe(nextFloat(createRng(1)))
  })
})

describe('nextInt', () => {
  it('reproduces the golden integer sequence for a fixed seed', () => {
    const rng = createRng(GOLDEN_SEED)
    expect(GOLDEN_INTS_N6).toHaveLength(10)
    expect(take(GOLDEN_INTS_N6.length, () => nextInt(rng, 6))).toEqual([...GOLDEN_INTS_N6])
  })

  it('returns values in [0, n) and exercises more than one bucket', () => {
    const rng = createRng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 5000; i++) {
      const v = nextInt(rng, 6)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(6)
      seen.add(v)
    }
    // A stuck generator (always 0) would be deterministic but useless.
    expect(seen.size).toBeGreaterThan(1)
  })

  it('always returns 0 for n === 1', () => {
    const rng = createRng(99)
    for (let i = 0; i < 100; i++) {
      expect(nextInt(rng, 1)).toBe(0)
    }
  })

  it('consumes the stream: nextInt advances the Rng seed', () => {
    const rng = createRng(GOLDEN_SEED)
    const before = rng.seed
    nextInt(rng, 6)
    expect(rng.seed).not.toBe(before)
  })
})
