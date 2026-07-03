// src/core/sim.ts
//
// The pure step. Deterministic: identical (state, input, dt) yields identical
// state. Time only ever enters here as `dt`; randomness only ever comes from
// `state.rng`. A-2 wired the loop (tick + RNG passthrough); A-3 added the
// ship's flight model; A-4 added firing; A-6 drifts the rocks. Saucers and
// rock spawning (the wave director) arrive in later stories.

import type { GameState, Rock, Bullet, Vec2 } from './state'
import { WORLD_W, WORLD_H } from './state'
import type { Input } from './input'
import type { Rng } from './rng'
import { stepShip, SHIP_HITBOX } from './ship'
import { stepBullets } from './bullet'
import { updateRocks, splitRock, ROCK_HITBOX } from './rocks'
import { updateWaveDirector } from './waves'
import { applyScore } from './score'
import { wrappedDelta, type Bounds } from './bounds'

const WORLD_BOUNDS: Bounds = { width: WORLD_W, height: WORLD_H }

/** Wrap-aware overlap: true when `a` and `b` are within `extent` on BOTH axes
 * across the toroidal field (an AABB of half-extent `extent`, measured by the
 * shortest seam-crossing displacement). */
function overlaps(a: Vec2, b: Vec2, extent: number): boolean {
  const d = wrappedDelta(a, b, WORLD_BOUNDS)
  return Math.abs(d.x) < extent && Math.abs(d.y) < extent
}

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
  let rocks =
    state.mode === 'playing' ? updateRocks(state.rocks, dt, WORLD_BOUNDS) : state.rocks
  let liveBullets: Bullet[] = bullets
  let shipDestroyed = state.shipDestroyed
  let score = state.score
  let lives = state.lives

  // Collision + destruction runs on the post-move positions, during play only.
  if (state.mode === 'playing') {
    // Bullet-vs-rock: a shot destroys the FIRST rock it overlaps (one shot, one
    // rock) and is consumed. A large/medium rock becomes splitRock's children;
    // a small rock despawns to nothing (drawing no rng). splitRock mutates `rng`
    // — this step's own clone of state.rng — so the advanced seed is threaded
    // forward in the returned state, keeping the replay deterministic.
    const working: Rock[] = [...rocks]
    const survivors: Bullet[] = []
    for (const bullet of liveBullets) {
      const hit = working.findIndex((r) => overlaps(bullet.pos, r.pos, ROCK_HITBOX[r.size]))
      if (hit === -1) {
        survivors.push(bullet)
      } else {
        // A-9: score the destroyed rock's OWN tier (children are scored only
        // when they are later shot), then split it. applyScore also grants a
        // bonus ship for every 10000-point boundary this award crosses. A child
        // spawned this frame that a later bullet hits is a real, separate
        // destruction and scores its own tier — no rock is ever counted twice.
        const destroyed = working[hit]
        const awarded = applyScore(score, lives, destroyed.size)
        score = awarded.score
        lives = awarded.lives
        working.splice(hit, 1, ...splitRock(destroyed, rng))
      }
    }
    rocks = working
    liveBullets = survivors

    // Ship-vs-rock: overlapping any rock destroys the ship. Rocks are unaffected
    // — ramming does not split them (that is a bullet's job). Sticky: once true
    // it stays true until A-15's respawn/invuln clears it.
    if (!shipDestroyed) {
      shipDestroyed = rocks.some((r) => overlaps(ship.pos, r.pos, SHIP_HITBOX + ROCK_HITBOX[r.size]))
    }
  }

  const stepped: GameState = {
    ...state,
    rng,
    tick: state.tick + 1,
    ship,
    rocks,
    bullets: liveBullets,
    score,
    lives,
    firePrev,
    shipDestroyed,
  }

  // The wave director spawns the next wave once the field is clear (play only).
  // It runs on the post-step state and clones the rng itself, so any spawn draws
  // are threaded into the returned state without touching the caller's rng.
  return updateWaveDirector(stepped, dt)
}
