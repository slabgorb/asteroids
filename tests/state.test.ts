// tests/state.test.ts
//
// GameState + initialState() factory. Supports AC-2 (determinism) by pinning
// the resting shape every step must preserve, and enforces the "zero
// everything else, seed rng via createRng" contract from the A-2 context.

import { describe, it, expect } from 'vitest'
import { initialState, type GameState } from '../src/core/state'
import { createRng } from '../src/core/rng'

describe('initialState', () => {
  it('seeds rng via createRng(seed)', () => {
    // Typed so a change to the exported GameState contract also breaks the build.
    const s: GameState = initialState(12345)
    expect(s.rng).toEqual(createRng(12345))
    expect(s.rng).toEqual({ seed: 12345 })
  })

  it('normalises the seed the same way createRng does', () => {
    expect(initialState(-1).rng.seed).toBe(4294967295)
  })

  it('starts in attract mode', () => {
    // Arcade cabinets boot into the attract loop (mirrors the lobby idle demo).
    expect(initialState(1).mode).toBe('attract')
  })

  it('zeroes the score / wave / lives triad', () => {
    const s = initialState(1)
    expect(s.score).toBe(0)
    expect(s.wave).toBe(0)
    expect(s.lives).toBe(0)
  })

  it('starts with no rocks, no bullets, and no saucer', () => {
    const s = initialState(1)
    expect(Array.isArray(s.rocks)).toBe(true)
    expect(s.rocks).toHaveLength(0)
    expect(Array.isArray(s.bullets)).toBe(true)
    expect(s.bullets).toHaveLength(0)
    // saucer must be explicitly null, not undefined (a real absence, not a
    // missing field) so `Saucer | null` narrowing is meaningful downstream.
    expect('saucer' in s).toBe(true)
    expect(s.saucer).toBeNull()
  })

  it('provides a ship object', () => {
    const s = initialState(1)
    expect(s.ship).toBeDefined()
    expect(s.ship).not.toBeNull()
    expect(typeof s.ship).toBe('object')
  })

  it('is repeatable: same seed produces a deeply-equal state', () => {
    expect(initialState(777)).toEqual(initialState(777))
  })

  it('has a reproducible default seed when called with no argument', () => {
    expect(initialState()).toEqual(initialState())
  })

  it('actually threads the seed argument through (different seeds differ)', () => {
    expect(initialState(1).rng.seed).not.toBe(initialState(2).rng.seed)
  })

  it('returns fresh entity arrays each call (no shared module-level aliasing)', () => {
    // Distinct array instances so mutating one state never bleeds into another.
    expect(initialState(1).rocks).not.toBe(initialState(1).rocks)
    expect(initialState(1).bullets).not.toBe(initialState(1).bullets)
  })
})
