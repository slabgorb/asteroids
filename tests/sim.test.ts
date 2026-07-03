// tests/sim.test.ts
//
// AC-2: stepGame(state, input, dt) is a pure, deterministic function. Two runs
// seeded identically and fed the same input script + fixed dt produce
// deeply-equal GameState after N ticks. This file proves:
//   - purity (the input state object is never mutated),
//   - a fresh object is returned (immutable-return discipline),
//   - the RNG is CLONED, not aliased, and passed through untouched this story,
//   - the step is NOT a no-op (a tick field advances) — so determinism is not
//     satisfied trivially by an identity function.

import { describe, it, expect } from 'vitest'
import { stepGame } from '../src/core/sim'
import { initialState, type GameState } from '../src/core/state'
import { NO_INPUT, type Input } from '../src/core/input'

const DT = 1 / 60

const SCRIPT: Input[] = [
  NO_INPUT,
  { ...NO_INPUT, left: true },
  { ...NO_INPUT, thrust: true },
  { ...NO_INPUT, right: true, fire: true },
  { ...NO_INPUT, hyperspace: true },
]

function run(seed: number, ticks: number, dt = DT): GameState {
  let s = initialState(seed)
  for (let i = 0; i < ticks; i++) {
    s = stepGame(s, SCRIPT[i % SCRIPT.length], dt)
  }
  return s
}

describe('stepGame — purity & immutability', () => {
  it('does not mutate the input state', () => {
    const s0 = initialState(42)
    const snapshot = structuredClone(s0)
    stepGame(s0, NO_INPUT, DT)
    expect(s0).toEqual(snapshot)
  })

  it('returns a new state object, not the same reference', () => {
    const s0 = initialState(42)
    expect(stepGame(s0, NO_INPUT, DT)).not.toBe(s0)
  })

  it('is referentially transparent: same inputs → equal outputs', () => {
    const s0 = initialState(5)
    expect(stepGame(s0, NO_INPUT, DT)).toEqual(stepGame(s0, NO_INPUT, DT))
  })
})

describe('stepGame — determinism (AC-2)', () => {
  it('produces deeply-equal state after N ticks for the same seed + script', () => {
    expect(run(7, 100)).toEqual(run(7, 100))
  })

  it('stays deterministic under a fixed dt regardless of run interleaving', () => {
    const a = run(123, 60)
    const b = run(123, 60)
    expect(a).toEqual(b)
  })
})

describe('stepGame — RNG clone discipline', () => {
  it('returns a fresh Rng clone, not the caller’s Rng instance', () => {
    const s0 = initialState(123)
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.rng).not.toBe(s0.rng)
  })

  it('passes the RNG through untouched this story (no entity behaviour yet)', () => {
    const s0 = initialState(123)
    const s5 = run(123, 5)
    // No nextFloat/nextInt is consumed in A-2, so the seed is unchanged.
    expect(s5.rng).toEqual(s0.rng)
    expect(s5.rng.seed).toBe(s0.rng.seed)
  })
})

describe('stepGame — the loop is actually wired (not a no-op)', () => {
  it('advances something every step (result differs from the rest state)', () => {
    const s1 = stepGame(initialState(1), NO_INPUT, DT)
    expect(s1).not.toEqual(initialState(1))
  })

  it('increments an integer tick counter once per step', () => {
    // Contract decision (see session Design Deviations): the unspecified
    // "elapsed-time/tick field" is pinned to an integer `tick` counter,
    // starting at 0 and += 1 per stepGame call.
    expect(initialState(1).tick).toBe(0)
    let s = initialState(1)
    const ticks: number[] = []
    for (let i = 0; i < 5; i++) {
      s = stepGame(s, NO_INPUT, DT)
      ticks.push(s.tick)
    }
    expect(ticks).toEqual([1, 2, 3, 4, 5])
  })
})
