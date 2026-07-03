// src/core/sim.ts
//
// The pure step. Deterministic: identical (state, input, dt) yields identical
// state. Time only ever enters here as `dt`; randomness only ever comes from
// `state.rng`. A-2 wired the loop (tick + RNG passthrough); A-3 added the
// ship's flight model; A-4 added firing; A-6 drifts the rocks. Saucers and
// rock spawning (the wave director) arrive in later stories.

import type { GameState } from './state'
import { WORLD_W, WORLD_H } from './state'
import type { Input } from './input'
import type { Rng } from './rng'
import { stepShip } from './ship'
import { stepBullets } from './bullet'
import { updateRocks } from './rocks'
import type { Bounds } from './bounds'

const WORLD_BOUNDS: Bounds = { width: WORLD_W, height: WORLD_H }

export function stepGame(state: GameState, input: Input, dt: number): GameState {
  // Clone the RNG so this step never mutates the caller's state — the one
  // exception to "never touch `state`, only read it": the clone is a fresh
  // mutable value threaded into the returned state, never the original.
  const rng: Rng = { seed: state.rng.seed }

  // Fire in the direction the ship now faces, inheriting its updated velocity.
  const ship = stepShip(state.ship, input, dt)
  const { bullets, firePrev } = stepBullets(state.bullets, ship, state.firePrev, input, dt)

  // Rocks drift only during play; attract-mode behaviour is A-10's call
  // (spawning doesn't exist yet, so the gate is unobservable until then).
  const rocks =
    state.mode === 'playing' ? updateRocks(state.rocks, dt, WORLD_BOUNDS) : state.rocks

  return {
    ...state,
    rng,
    tick: state.tick + 1,
    ship,
    rocks,
    bullets,
    firePrev,
  }
}
