// src/core/bullet.ts
//
// A-4: player firing — bullet spawn, muzzle velocity (with inherited ship
// momentum), finite lifetime, toroidal flight, and the max-4-shots cap. Pure:
// no DOM, no wall-clock or entropy globals; time enters only as `dt`, and
// firing consumes no randomness.
//
// ROM-tuned against the rev-4 disassembly at
// https://6502disassembly.com/va-asteroids/Asteroids.html (the reference/ quarry
// is absent from this checkout — see session Delivery Findings — so the values
// live here, cited by ROM address). The shot routine is BulletSlotFound
// $6cfd–$6d8e (quarried during A-3). Units mirror ship.ts: world lo-units
// (8 per screen pixel at 1024x768); velocity is world-units per 60 Hz frame;
// `dir` is a 256-unit circle, 0 = +x, dir 64 = +y, counterclockwise positive.

import type { Bullet, Ship } from './state'
import { WORLD_W, WORLD_H } from './state'
import type { Input } from './input'
import { sinLookup } from './ship'

/** Maximum simultaneous player shots (ChkFireBtn ship-bullet loop, $6cee:
 * `lda #$03` iterating slots 0..3). A fire press is ignored while four shots
 * are already alive. */
export const MAX_PLAYER_SHOTS = 4

/** Shot lifetime in 60 Hz frames — the per-shot countdown seeded on fire
 * (ShpShotTimer, $6d01 `lda #18`, byte $12 = 18). Authentic seed; range is set
 * by how OFTEN this counter ticks, not by inflating it. */
export const BULLET_LIFETIME_FRAMES = 18

/** How many 60 Hz frames pass between successive decrements of a shot's lifetime
 * timer. The ROM integrates position every frame but only DECREMENTS the per-shot
 * timer on every 4th frame (FrameTimerLo `and #$03`, L738F) — so a shot seeded to
 * BULLET_LIFETIME_FRAMES actually flies BULLET_LIFETIME_FRAMES x 4 = 72 frames
 * (~72 x 111 = 7992 lo-units, nearly the full 8192-wide screen). The port aged
 * `life` every frame, dying at 18 frames (~a quarter screen): 4x too short (A2-9).
 * Shared and owner-agnostic — player and saucer shots age on the same cadence. */
export const SHOT_TIMER_PERIOD_FRAMES = 4

/** Per-axis muzzle-speed clamp: the shot's heading velocity is capped at ±111
 * lo-units/frame (shot-velocity clamp near $6d1a/$6d22) BEFORE the ship's
 * velocity is added. This is above the ship's ±16383/256 per-axis cap, so a
 * shot always outruns the ship that fired it. */
export const BULLET_SPEED = 111

function clampMuzzle(v: number): number {
  return Math.min(BULLET_SPEED, Math.max(-BULLET_SPEED, v))
}

/** Toroidal wrap into [0, size) on both axes (UpdateObjPos $6fc7), matching the
 * ship's playfield wrap. */
function wrap(v: number, size: number): number {
  return ((v % size) + size) % size
}

/** A shot's per-axis muzzle velocity: the thrust-direction sine amplitude taken
 * at 3/2 (the ROM adds the heading value plus half of it again, BulletSlotFound
 * $6d0c–$6d2a) and clamped to ±BULLET_SPEED. At a cardinal heading this lands at
 * the clamp on one axis and zero on the other, so cardinal muzzle speed is a
 * fixed 111 in every direction. */
function muzzleAxis(headingVal: number): number {
  return clampMuzzle(headingVal + headingVal / 2)
}

/** Advance every live bullet one step: integrate position by velocity with
 * toroidal wrap on both axes, decrement the lifetime counter once per
 * SHOT_TIMER_PERIOD_FRAMES frames (the ROM's every-4th-frame timer DEC at L738F,
 * while position integrates every frame), and drop shots whose life has run out.
 * Bullets fly straight — no thrust, no drag — so their velocity is constant.
 * Returns fresh bullet objects (no aliasing of the input). */
function advance(bullets: readonly Bullet[], frames: number): Bullet[] {
  const out: Bullet[] = []
  for (const b of bullets) {
    const life = b.life - frames / SHOT_TIMER_PERIOD_FRAMES
    if (life <= 0) continue
    out.push({
      pos: {
        x: wrap(b.pos.x + b.vel.x * frames, WORLD_W),
        y: wrap(b.pos.y + b.vel.y * frames, WORLD_H),
      },
      vel: { x: b.vel.x, y: b.vel.y },
      life,
      owner: b.owner,
    })
  }
  return out
}

/** One frame of firing, returned alongside the updated fire-edge state. */
export interface FireStep {
  bullets: Bullet[]
  firePrev: boolean
  /** A-18: true iff a fresh player shot spawned THIS frame — the audio-event
   * signal. Exposed so callers never have to infer it by diffing bullet-array
   * length (which also shrinks on expiry the same frame). */
  fired: boolean
}

/** Step firing for one frame. `ship` is the post-flight ship for this frame —
 * a shot is fired in the direction you now face and inherits the velocity you
 * now have. Existing shots advance first, then a new shot spawns iff the fire
 * button just went low→high (edge-triggered via `firePrev`, the ShipBulletSR
 * $63 shift register) AND fewer than MAX_PLAYER_SHOTS shots are live. Momentum
 * is inherited: the clamped muzzle velocity is added to the ship's velocity
 * ($6d11 `adc ShipXSpeed`). `dt` scales ROM-per-frame rates by dt*60. */
export function stepBullets(
  bullets: readonly Bullet[],
  ship: Ship,
  firePrev: boolean,
  input: Input,
  dt: number,
): FireStep {
  const frames = dt * 60
  const next = advance(bullets, frames)

  // The 4-shot cap counts PLAYER shots only — saucer shots (A-11) share this
  // array but have their own SAUCER_MAX_BULLETS cap, so the two never crowd
  // each other out.
  const risingEdge = input.fire && !firePrev
  const playerShots = next.reduce((n, b) => (b.owner === 'player' ? n + 1 : n), 0)
  const fired = risingEdge && playerShots < MAX_PLAYER_SHOTS
  if (fired) {
    next.push({
      pos: { x: ship.pos.x, y: ship.pos.y },
      vel: {
        x: muzzleAxis(sinLookup(ship.dir + 64)) + ship.vel.x,
        y: muzzleAxis(sinLookup(ship.dir)) + ship.vel.y,
      },
      life: BULLET_LIFETIME_FRAMES,
      owner: 'player',
    })
  }

  return { bullets: next, firePrev: input.fire, fired }
}
