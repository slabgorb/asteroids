// src/core/sim.ts
//
// The pure step. Deterministic: identical (state, input, dt) yields identical
// state. Time only ever enters here as `dt`; randomness only ever comes from
// `state.rng`. A-2 wired the loop (tick + RNG passthrough); A-3 adds the
// ship's flight model. Rocks/bullets/saucers arrive in later stories.

import type { GameState } from './state'
import type { Input } from './input'
import type { Rng } from './rng'
import { stepShip } from './ship'

export function stepGame(state: GameState, input: Input, dt: number): GameState {
  // Clone the RNG so this step never mutates the caller's state — the one
  // exception to "never touch `state`, only read it": the clone is a fresh
  // mutable value threaded into the returned state, never the original.
  const rng: Rng = { seed: state.rng.seed }

  return {
    ...state,
    rng,
    tick: state.tick + 1,
    ship: stepShip(state.ship, input, dt),
  }
}
