// src/core/hyperspace.ts
//
// A-14: hyperspace — the panic-button bail-out. A jump instantly relocates the
// ship to a fresh seeded position inside an edge-inset band, at the cost of a
// flat 25% chance the jump self-destructs. A failed jump is an ORDINARY ship
// death, routed through A-15's handleShipDeath (decrement + respawn wait, or
// game over on the last ship) — never a special case. A successful jump hides
// the ship and shields it for a brief reappearance window by REUSING A-15's
// GameState.shipSpawnTimer (its own $30 = 48-frame value) rather than inventing
// a parallel field — the field's own comment (lives.ts/state.ts) reserves it
// for exactly this. The one genuinely-new field is Ship.visible.
//
// Pure: randomness only from the seeded rng, no DOM, no wall-clock. All three
// constants are provisional leads for A-17's quarry port (see
// context-story-A-14.md), shipped behind named exports + a rockCount seam.

import type { GameState, Vec2 } from './state'
import { WORLD_W, WORLD_H } from './state'
import type { Input } from './input'
import { type Rng, nextFloat } from './rng'
import type { Bounds } from './bounds'
import { handleShipDeath } from './lives'

/** Flat self-destruct chance per jump. Corroborated by the disassembly hub/epic;
 * computerarcheology reads a position-dependent variant instead — shipped flat,
 * with rollHyperspaceSurvival carrying an (unused) rockCount seam for the A-17
 * density-dependent swap. verify vs quarry (A-17). */
export const HYPERSPACE_DEATH_CHANCE = 0.25

/** Reposition band inset from each playfield edge, as a fraction per axis: the
 * new position is drawn from [margin, 1-margin] of the world, never the strip
 * near an edge (computerarcheology's masked-range read). ~10% is provisional —
 * the exact fraction is unconfirmed. verify vs quarry (A-17). */
export const HYPERSPACE_EDGE_MARGIN = 0.1

/** Seconds the ship is hidden AND cannot be hit after a successful jump — the
 * shared spawn timer ($02FA) set to $30 = 48 frames per computerarcheology,
 * 60 Hz assumed. Reuses GameState.shipSpawnTimer (A-15). verify vs quarry
 * (A-17). */
export const HYPERSPACE_TIMER_S = 48 / 60

const WORLD_BOUNDS: Bounds = { width: WORLD_W, height: WORLD_H }

/** One seeded survival roll: survives iff the draw clears the death chance.
 * Consumes exactly one nextFloat off `rng`. `_rockCount` is the A-17 seam for a
 * future density-dependent formula — accepted now, ignored in the body so the
 * swap is a one-line change, not a signature change. */
export function rollHyperspaceSurvival(rng: Rng, _rockCount: number): boolean {
  return nextFloat(rng) >= HYPERSPACE_DEATH_CHANCE
}

/** A fresh seeded position inside the edge-inset band — one nextFloat per axis
 * (x then y), each mapped into [margin, 1-margin] * dimension. */
export function rollHyperspacePosition(rng: Rng, bounds: Bounds): Vec2 {
  const span = 1 - 2 * HYPERSPACE_EDGE_MARGIN
  return {
    x: (HYPERSPACE_EDGE_MARGIN + nextFloat(rng) * span) * bounds.width,
    y: (HYPERSPACE_EDGE_MARGIN + nextFloat(rng) * span) * bounds.height,
  }
}

/** Trigger a hyperspace jump. Acts only when `input.hyperspace` is held, the
 * ship is alive, and no jump window is open (`shipSpawnTimer === 0`) — the open
 * window IS the debounce, so holding the key can't re-fire mid-jump and no
 * separate edge tracking is needed. On a jump: roll survival first. A failed
 * roll dies where it stood (handleShipDeath — no reposition). A survived roll
 * draws a new position, teleports there at rest, hides the ship, and arms the
 * reappearance window. Every no-op returns the state untouched — rng included,
 * so a held key that can't act never perturbs the deterministic stream. */
export function triggerHyperspace(state: GameState, input: Input): GameState {
  if (!input.hyperspace || state.shipDestroyed || state.shipSpawnTimer > 0) {
    return state
  }
  // A-2 discipline: draw off a CLONE, thread the advanced seed into the result.
  const rng: Rng = { seed: state.rng.seed }
  if (!rollHyperspaceSurvival(rng, state.rocks.length)) {
    return handleShipDeath({ ...state, rng })
  }
  return {
    ...state,
    rng,
    ship: { ...state.ship, pos: rollHyperspacePosition(rng, WORLD_BOUNDS), vel: { x: 0, y: 0 }, visible: false },
    shipSpawnTimer: HYPERSPACE_TIMER_S,
  }
}
