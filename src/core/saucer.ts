// src/core/saucer.ts
//
// A-11 + A-12: the FLYING SAUCER — a countdown-spawned enemy that crosses the
// field horizontally, weaves with periodic vertical course changes, and fires on
// a cadence. Two variants share all of that plumbing (A-11) and differ only in
// spawn selection and fire:
//   * LARGE (A-11): fires at RANDOM headings; the only variant early in the game.
//   * SMALL (A-12): the spawn director selects it more often as the score climbs;
//     it AIMS at the ship, with a random error that ramps to zero (dead-on) once
//     the score reaches SAUCER_AIM_PERFECT_SCORE (35000).
// A-13 (scoring/collision/siren) reads Saucer.size; the spawn director, movement,
// and bullet plumbing are otherwise reused verbatim.
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

import type { GameState, Saucer, Bullet, Vec2, SaucerSize } from './state'
import { WORLD_W, WORLD_H } from './state'
import { nextFloat, nextInt, type Rng } from '@arcade/shared/rng'

/** Horizontal crossing speed, world lo-units per 60 Hz frame. The ROM applies its
 * ±16-unit saucer drift INSIDE the every-4th-frame saucer-update gate (UpdateScr
 * L6B93 `and #$03`), so the continuous-dt equivalent is that drift / 4 = 4 (A2-9:
 * the port moved every frame → 4x too fast crossing + weave, "turns quickly").
 * The base 16 drift is still provisional — verify vs quarry (A-17); the /4 gate is
 * ROM-confirmed. */
export const SAUCER_SPEED = 4

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

/** Seconds between shots. The ROM reloads ScrTimer to $0A = 10 (L6C54) but
 * decrements it INSIDE the every-4th-frame saucer-update gate (UpdateScr L6B93),
 * so a shot lands every 10 x 4 = 40 frames (A2-9: the port fired every 10 frames
 * → bullet spam). The 10-tick reload is corroborated by both fetched sources; the
 * x4 gate is ROM-confirmed. */
export const SAUCER_FIRE_INTERVAL = 40 / 60

/** Max simultaneous saucer shots. Sources disagree (2 vs 3). verify vs quarry (A-17). */
export const SAUCER_MAX_BULLETS = 2

/** Saucer shot lifetime in 60 Hz frames (~18, single-source). verify vs quarry (A-17). */
export const SAUCER_BULLET_LIFETIME = 18

/** Saucer shot speed, lo-units per frame — reuses the ship's ±111 muzzle clamp
 * (single-source). verify vs quarry (A-17). */
export const SAUCER_BULLET_SPEED = 111

// --- A-13: collision extents + saucer↔rock flag ---------------------------

/** Collision half-extent per saucer size, world lo-units (an AABB half-width,
 * the same convention as ROCK_HITBOX/SHIP_HITBOX). The SMALL saucer is a
 * genuinely tiny target: its window (2×42 = 84) is narrower than a player shot's
 * 111-lo-unit-per-frame travel, so a fast shot can tunnel it — which is why
 * bullet↔saucer uses the SWEPT path test (sim.ts sweptOverlaps), exactly as
 * bullet↔rock does for small rocks. The LARGE saucer is a bigger, ship-sized
 * target. Provisional feel values; verify vs quarry (A-17). */
export const SAUCER_HITBOX: Readonly<Record<SaucerSize, number>> = {
  large: 90,
  small: 42,
}

/** Whether a saucer is destroyed on contact with a rock (A-13). Secondary
 * sources + this story's brief assert it, but NEITHER fetched primary-source
 * disassembly excerpt found the routine — a direct conflict. Shipped ON behind
 * this named flag (minimal interpretation: the saucer dies, the rock is
 * unaffected); verify vs quarry (A-17) before treating as settled. */
export const SAUCER_ROCK_COLLISION_ENABLED = true

// --- A-12: the small saucer (aimed fire + accuracy ramp) ------------------

/** Score at/above which the SMALL saucer's aim is dead-on (zero error). This is
 * the number in the story title ("accuracy ramp after 35000 pts") — the spec,
 * not a ROM guess. verify the exact ROM threshold vs quarry (A-17). */
export const SAUCER_AIM_PERFECT_SCORE = 35000

/** Half-width (radians) of the small saucer's aim-error cone at score 0 — its
 * widest scatter, shrinking linearly to zero at SAUCER_AIM_PERFECT_SCORE. A
 * quarter-turn-ish cone keeps even the earliest small saucer recognisably aimed
 * (unlike the large saucer's full-circle spray). Provisional feel value.
 * verify vs quarry (A-17). */
export const SAUCER_AIM_ERROR_MAX = Math.PI / 5

/** Score at/above which the spawn director MAY produce a small saucer; below it,
 * only large saucers spawn — keeping the early game (and A-11's score-0 suite)
 * large-only. Provisional. verify vs quarry (A-17). */
export const SAUCER_SMALL_MIN_SCORE = 10000

/** Score at/above which ONLY small saucers spawn. Between SAUCER_SMALL_MIN_SCORE
 * and here the small-saucer probability rises linearly with the score (canon puts
 * small-only around 40000). Local — no test pins the exact schedule, only the
 * brackets (large-only at 0, small present when high). verify vs quarry (A-17). */
const SAUCER_SMALL_ONLY_SCORE = 40000

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

/** Probability that a spawn at this score is the SMALL variant: zero below
 * SAUCER_SMALL_MIN_SCORE (large-only early game), rising linearly to one at
 * SAUCER_SMALL_ONLY_SCORE (small-only late game). */
function smallProbability(score: number): number {
  if (score < SAUCER_SMALL_MIN_SCORE) return 0
  if (score >= SAUCER_SMALL_ONLY_SCORE) return 1
  return (score - SAUCER_SMALL_MIN_SCORE) / (SAUCER_SMALL_ONLY_SCORE - SAUCER_SMALL_MIN_SCORE)
}

/** Pick the saucer size for a spawn at this score. Below the small-saucer floor
 * this returns 'large' WITHOUT consuming rng, so the early game's spawn stream
 * (and A-11's score-0 tests) stay byte-for-byte unchanged; only once small
 * saucers are possible does it draw. Consumes rng only when score >= the floor. */
function pickSize(rng: Rng, score: number): SaucerSize {
  if (score < SAUCER_SMALL_MIN_SCORE) return 'large'
  return nextFloat(rng) < smallProbability(score) ? 'small' : 'large'
}

/** Spawn a saucer entering from a random left/right edge, crossing INTO the field
 * (velocity sign matches the entry edge), at a random height. Its size is chosen
 * by score (pickSize): large-only early, small increasingly likely as play
 * deepens. Consumes (advances) the passed rng. */
function spawnSaucer(rng: Rng, score: number): Saucer {
  const fromLeft = nextInt(rng, 2) === 0
  const y = nextFloat(rng) * WORLD_H
  const size = pickSize(rng, score)
  return {
    pos: { x: fromLeft ? 0 : WORLD_W, y },
    velocity: { x: fromLeft ? SAUCER_SPEED : -SAUCER_SPEED, y: 0 },
    size,
    courseTimer: SAUCER_COURSE_CHANGE_INTERVAL,
    fireTimer: SAUCER_FIRE_INTERVAL,
  }
}

/** The small saucer's AIMED heading: the bearing to the ship plus a symmetric
 * random error whose half-width shrinks linearly from SAUCER_AIM_ERROR_MAX at
 * score 0 to zero at SAUCER_AIM_PERFECT_SCORE (dead-on at/after 35000). Consumes
 * (advances) the passed rng. */
function aimHeading(from: Vec2, shipPos: Vec2, score: number, rng: Rng): number {
  const bearing = Math.atan2(shipPos.y - from.y, shipPos.x - from.x)
  const ramp = Math.max(0, 1 - score / SAUCER_AIM_PERFECT_SCORE)
  const error = (nextFloat(rng) * 2 - 1) * SAUCER_AIM_ERROR_MAX * ramp
  return bearing + error
}

/** A saucer shot. A LARGE saucer fires at a RANDOM heading (never aims); a SMALL
 * saucer AIMS at the ship via aimHeading (the A-12 differentiator). Either way
 * exactly one rng draw is consumed, so the large-saucer stream is unchanged from
 * A-11. Consumes (advances) the passed rng. */
function fireShot(from: Vec2, size: SaucerSize, shipPos: Vec2, score: number, rng: Rng): Bullet {
  const heading =
    size === 'small' ? aimHeading(from, shipPos, score, rng) : nextFloat(rng) * 2 * Math.PI
  return {
    pos: { x: from.x, y: from.y },
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
  const saucer = spawnSaucer(rng, state.score)
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
      bullets = [...bullets, fireShot({ x, y }, saucer.size, state.ship.pos, state.score, rng)]
    }
  }

  const moved: Saucer = { pos: { x, y }, velocity, size: saucer.size, courseTimer, fireTimer }
  return { ...state, rng, saucer: moved, bullets }
}

/** The siren state hook for A-18 (A-13): "which saucer is alive right now", as a
 * pure derived value — 'large' or 'small' while that variant is on screen, else
 * null. The real Asteroids siren shifts pitch by which saucer is present; A-18
 * owns all sound synthesis and drives it off this. Deliberately trivial and
 * timer-free: no audio, no wall-clock, just a read of state.saucer, so it stays
 * inside the deterministic core-purity boundary. */
export function sirenState(state: GameState): SaucerSize | null {
  return state.saucer === null ? null : state.saucer.size
}
