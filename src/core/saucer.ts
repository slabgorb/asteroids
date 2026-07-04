// src/core/saucer.ts
//
// A-11: the LARGE SAUCER — a countdown-spawned enemy that crosses the field
// horizontally, weaves with periodic vertical course changes, and fires at
// RANDOM headings on a cadence. Foundation for A-12 (small saucer + aimed fire)
// and A-13 (scoring/collision/siren): the spawn director, movement, and bullet
// plumbing here are reused; A-12 only swaps in a second size and replaces the
// random heading with an aimed one.
//
// Determinism: no wall-clock, no Math.random — all randomness flows through the
// passed Rng, which advances IN PLACE (like spawnWave / splitRock). Callers
// inside stepGame clone state.rng before drawing; updateSpawnDirector and
// stepSaucer do this themselves.
//
// ROM leads from computerarcheology.com/Arcade/Asteroids/Code.html and
// 6502disassembly.com/va-asteroids/Asteroids.html (mutually corroborating on the
// single-saucer invariant, ~10-frame fire cadence, and course-change mechanism;
// conflicting on bullet count, entry-side wiring, and several byte values). Every
// magnitude below is PROVISIONAL and named/isolated so A-17's quarry port is a
// constant swap, not a refactor — each carries a `verify vs quarry (A-17)` note.

import type { GameState, Saucer, Bullet } from './state'
import { WORLD_W, WORLD_H } from './state'
import { nextFloat, nextInt, type Rng } from './rng'

/** Horizontal crossing speed, world lo-units per 60 Hz frame. Scaled from the
 * ROM's ±16-units/frame saucer drift (A-3's unscaled-lo-units convention).
 * verify vs quarry (A-17). */
export const SAUCER_SPEED = 16

/** Seconds until the FIRST saucer is eligible to spawn. The reload's starting
 * value was not found in either fetch — feel-based. verify vs quarry (A-17). */
export const SAUCER_SPAWN_TIMER_INITIAL = 6

/** Minimum spawn reload as difficulty rises. Both sources agree the reload
 * shrinks toward a floor (~$20 / 32 frames per one source); exact byte differs.
 * verify vs quarry (A-17). */
export const SAUCER_SPAWN_TIMER_FLOOR = 32 / 60

/** Seconds between vertical-course rerolls (~128 frames @60Hz). Mechanism
 * corroborated by both sources; exact cadence differs. verify vs quarry (A-17). */
export const SAUCER_COURSE_CHANGE_INTERVAL = 128 / 60

/** The discrete table a course reroll draws from (a 2-bit RNG index → 4 entries).
 * The two zero entries bias the saucer toward long horizontal runs punctuated by
 * diagonal legs; exact values differ between sources. verify vs quarry (A-17). */
export const SAUCER_VERTICAL_SPEEDS: readonly number[] = [-SAUCER_SPEED, 0, 0, SAUCER_SPEED]

/** Seconds between shots (10 frames @60Hz — independently corroborated by both
 * fetched sources). */
export const SAUCER_FIRE_INTERVAL = 10 / 60

/** Max simultaneous saucer shots. Sources disagree (2 vs 3). verify vs quarry (A-17). */
export const SAUCER_MAX_BULLETS = 2

/** Saucer shot lifetime in 60 Hz frames (~18, single-source). verify vs quarry (A-17). */
export const SAUCER_BULLET_LIFETIME = 18

/** Saucer shot speed, lo-units per frame — reuses the ship's ±111 muzzle clamp
 * (single-source). verify vs quarry (A-17). */
export const SAUCER_BULLET_SPEED = 111

/** How much the spawn reload shrinks per wave, toward the floor. The shrink
 * TRIGGER is unconfirmed (asteroid-count threshold vs frame counter — the two
 * sources conflict); modelled as a deterministic per-wave step. verify vs
 * quarry (A-17). */
const SPAWN_RELOAD_SHRINK_PER_WAVE = 0.25

/** The spawn reload for a given wave: starts at INITIAL and shrinks toward the
 * FLOOR as play deepens. Waves 0-1 read as INITIAL (no shrink yet). */
function spawnReload(wave: number): number {
  const shrunk = SAUCER_SPAWN_TIMER_INITIAL - Math.max(0, wave - 1) * SPAWN_RELOAD_SHRINK_PER_WAVE
  return Math.max(SAUCER_SPAWN_TIMER_FLOOR, shrunk)
}

/** Toroidal fold into [0, size) — the vertical wrap the saucer shares with every
 * other entity (UpdateObjPos $6fc7). The HORIZONTAL crossing deliberately does
 * NOT use this: the saucer despawns on the far edge instead of wrapping. */
function wrap(v: number, size: number): number {
  return ((v % size) + size) % size
}

/** Spawn a large saucer entering from a random left/right edge, crossing INTO
 * the field (velocity sign matches the entry edge), at a random height. Consumes
 * (advances) the passed rng. */
function spawnSaucer(rng: Rng): Saucer {
  const fromLeft = nextInt(rng, 2) === 0
  const y = nextFloat(rng) * WORLD_H
  return {
    pos: { x: fromLeft ? 0 : WORLD_W, y },
    velocity: { x: fromLeft ? SAUCER_SPEED : -SAUCER_SPEED, y: 0 },
    courseTimer: SAUCER_COURSE_CHANGE_INTERVAL,
    fireTimer: SAUCER_FIRE_INTERVAL,
  }
}

/** A saucer shot at a RANDOM heading (the large saucer never aims — the A-12
 * differentiator). Consumes (advances) the passed rng. */
function fireShot(pos: { x: number; y: number }, rng: Rng): Bullet {
  const heading = nextFloat(rng) * 2 * Math.PI
  return {
    pos: { x: pos.x, y: pos.y },
    vel: { x: Math.cos(heading) * SAUCER_BULLET_SPEED, y: Math.sin(heading) * SAUCER_BULLET_SPEED },
    life: SAUCER_BULLET_LIFETIME,
    owner: 'saucer',
  }
}

/** Advance the spawn director one tick (play only). Mirrors updateWaveDirector:
 * while a saucer is alive OR the ship is dead/exploding it rests (the
 * single-saucer invariant + the ship gate); otherwise it arms a wave-scaled
 * reload, counts it down, and spawns EXACTLY ONE saucer when it elapses — never
 * on the same tick it arms, so there is no instant first-frame spawn. Clones
 * state.rng before drawing, so the caller's rng is never mutated. Pure. */
export function updateSpawnDirector(state: GameState, dt: number): GameState {
  if (state.mode !== 'playing') return state
  if (state.saucer !== null) return state // one saucer at a time
  if (state.shipDestroyed) return state // no spawn while the ship is gone

  // Not counting yet (boot, or a saucer just cleared): arm a fresh reload without
  // spawning, so the very first eligible frame always waits a full cadence.
  if (state.saucerSpawnTimer <= 0) {
    return { ...state, saucerSpawnTimer: spawnReload(state.wave) }
  }
  const remaining = state.saucerSpawnTimer - dt
  if (remaining > 0) {
    return { ...state, saucerSpawnTimer: remaining }
  }
  const rng: Rng = { seed: state.rng.seed }
  const saucer = spawnSaucer(rng)
  return { ...state, rng, saucer, saucerSpawnTimer: spawnReload(state.wave) }
}

/** Advance the live saucer one tick (play only): constant horizontal drift at
 * SAUCER_SPEED; a vertical-course reroll on the SAUCER_COURSE_CHANGE_INTERVAL
 * cadence, drawn from SAUCER_VERTICAL_SPEEDS; toroidal VERTICAL wrap; a far-edge
 * DESPAWN (the saucer becomes null on crossing the opposite horizontal edge — no
 * wrap); and cadence-gated RANDOM fire capped at SAUCER_MAX_BULLETS live saucer
 * shots. Bullet flight + aging is the shared stepBullets' job (owner-agnostic);
 * this only APPENDS new saucer shots. Clones state.rng before drawing. Pure. */
export function stepSaucer(state: GameState, dt: number): GameState {
  if (state.mode !== 'playing') return state
  const saucer = state.saucer
  if (saucer === null) return state

  const frames = dt * 60
  const rng: Rng = { seed: state.rng.seed }

  // Vertical-course reroll on the cadence (same value is a legal reroll). CARRY
  // the remainder (`+=`, not `=`) so sub-frame float rounding never accumulates —
  // rerolls stay locked to true multiples of the interval, not drifting a frame
  // per cycle.
  let velocity = saucer.velocity
  let courseTimer = saucer.courseTimer - dt
  if (courseTimer <= 0) {
    velocity = { x: velocity.x, y: SAUCER_VERTICAL_SPEEDS[nextInt(rng, SAUCER_VERTICAL_SPEEDS.length)] }
    courseTimer += SAUCER_COURSE_CHANGE_INTERVAL
  }

  // Integrate. Horizontal crossing does NOT wrap — the far edge despawns it.
  const x = saucer.pos.x + velocity.x * frames
  if (x < 0 || x > WORLD_W) {
    return { ...state, rng, saucer: null } // crossed the far edge → gone (bullets fly on)
  }
  const y = wrap(saucer.pos.y + velocity.y * frames, WORLD_H)

  // Cadence-gated random fire, capped at SAUCER_MAX_BULLETS live saucer shots.
  let bullets = state.bullets
  let fireTimer = saucer.fireTimer - dt
  if (fireTimer <= 0) {
    fireTimer += SAUCER_FIRE_INTERVAL // carry the remainder — keep the fire cadence drift-free
    const liveSaucerShots = bullets.reduce((n, b) => (b.owner === 'saucer' ? n + 1 : n), 0)
    if (liveSaucerShots < SAUCER_MAX_BULLETS) {
      bullets = [...bullets, fireShot({ x, y }, rng)]
    }
  }

  const moved: Saucer = { pos: { x, y }, velocity, courseTimer, fireTimer }
  return { ...state, rng, saucer: moved, bullets }
}
