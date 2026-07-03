// src/core/sim.ts
//
// The pure step. Deterministic: identical (state, input, dt) yields identical
// state. Time only ever enters here as `dt`; randomness only ever comes from
// `state.rng`. This story does the minimum to prove the loop is wired and
// deterministic: advance the tick counter and pass the RNG through untouched.
// No entity behaviour (rotation/thrust/rocks/bullets) yet — that's A-3+.

import type { GameState } from './state'
import type { Input } from './input'
import type { Rng } from './rng'

export function stepGame(state: GameState, input: Input, dt: number): GameState {
  // Clone the RNG so this step never mutates the caller's state — the one
  // exception to "never touch `state`, only read it": the clone is a fresh
  // mutable value threaded into the returned state, never the original.
  const rng: Rng = { seed: state.rng.seed }

  return {
    ...state,
    rng,
    tick: state.tick + 1,
  }
}
