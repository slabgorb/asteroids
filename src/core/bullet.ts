// src/core/bullet.ts
//
// A-4: player firing — bullet spawn, muzzle velocity (with inherited ship
// momentum), finite lifetime, straight flight that dies at the screen edge
// (1979 shots do NOT wrap), and the max-4-shots cap. Pure:
// no DOM, no wall-clock or entropy globals; time enters only as `dt`, and
// firing consumes no randomness.
//
// A2 ad-hoc (2026-07): the shot direction is derived by HALVING the ship's
// per-axis thrust component (ROM `cmp #$80 : ror A`), then adding momentum and
// clamping the sum to ±111 — see muzzleAxis / clampVel below. An earlier reading
// transcribed the halve as a 3/2 MULTIPLY, which drove near-cardinal axes past
// the ±111 clamp and deflected shots up to ~11° off the ship's nose; halving
// keeps the muzzle (±63) under the clamp so shots fly true along the heading.
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
 * (~72 x 63 = 4536 lo-units, ~55% of the 8192-wide screen at the authentic muzzle
 * speed — see muzzleAxis; a deliberately limited-range shot). The port aged
 * `life` every frame, dying at 18 frames (~an eighth of the screen): 4x too short
 * (A2-9). Shared and owner-agnostic — player and saucer shots age on the same cadence. */
export const SHOT_TIMER_PERIOD_FRAMES = 4

/** Per-axis velocity clamp for a shot: the ROM caps each axis of the shot's
 * TOTAL velocity — muzzle PLUS inherited ship momentum — at ±111 lo-units/frame
 * ($6d19 `cmp #112`/`lda #111`; $6d21 `cmp #145`/`lda #$91` = -111). It bounds
 * the SUM, it does not reshape the muzzle: the halved muzzle alone is only ±63
 * (see muzzleAxis), well under the cap, so a rest-fired shot flies true along the
 * heading and the clamp bites only once fast ship momentum is added. That
 * headroom (111 > the ship's own ±16383/256 ≈ ±63.99 cap) is what lets a shot
 * outrun the ship that fired it. */
export const BULLET_SPEED = 111

function clampVel(v: number): number {
  return Math.min(BULLET_SPEED, Math.max(-BULLET_SPEED, v))
}

/** A shot's per-axis MUZZLE velocity: the ROM HALVES the ship's per-axis thrust
 * component with a signed shift — `cmp #$80 : ror A` ($6d0e–$6d10 for X,
 * $6d31–$6d33 for Y), the canonical 6502 idiom for an arithmetic-shift-right
 * (signed divide-by-2). For the integer thrust-table value that is exactly
 * `h >> 1` (which floors toward -∞, matching `ror`, so the negative cardinals
 * come out one lo-unit larger in magnitude than the positive ones). Because both
 * axes are halved by the SAME factor the muzzle vector preserves the heading's
 * direction — unlike a per-axis clamp, which would deflect it toward a diagonal.
 * Cardinal muzzle speed is therefore sinLookup(64) >> 1 = 63, comfortably under
 * the ±111 total-velocity clamp. (The pre-fix port used `h + h/2` — a 3/2
 * MULTIPLY — which drove near-cardinal axes past the clamp and deflected shots up
 * to ~11° off the nose: A2 ad-hoc fidelity fix.) */
function muzzleAxis(headingVal: number): number {
  return headingVal >> 1
}

/** Advance every live bullet one step: integrate position by velocity, decrement
 * the lifetime counter once per SHOT_TIMER_PERIOD_FRAMES frames (the ROM's
 * every-4th-frame timer DEC at L738F, while position integrates every frame), and
 * drop shots whose life has run out OR that have flown off the playfield edge.
 * Unlike the ship and rocks, 1979 Asteroids shots do NOT wrap the toroidal field
 * — they have a limited range and vanish at the screen edge (which is why you
 * cannot shoot yourself; Asteroids DELUXE later made shots wrap, this game does
 * not). Bullets fly straight — no thrust, no drag — so their velocity is
 * constant. Returns fresh bullet objects (no aliasing of the input). */
function advance(bullets: readonly Bullet[], frames: number): Bullet[] {
  const out: Bullet[] = []
  for (const b of bullets) {
    const life = b.life - frames / SHOT_TIMER_PERIOD_FRAMES
    if (life <= 0) continue
    const x = b.pos.x + b.vel.x * frames
    const y = b.pos.y + b.vel.y * frames
    // Shots die at the edge — no toroidal wrap (see doc comment above).
    if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) continue
    out.push({
      pos: { x, y },
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
        // ROM order ($6d0e–$6d27 / $6d31–$6d44): halve the muzzle, ADD the ship's
        // momentum, THEN clamp the sum to ±111 — not clamp-then-add.
        x: clampVel(muzzleAxis(sinLookup(ship.dir + 64)) + ship.vel.x),
        y: clampVel(muzzleAxis(sinLookup(ship.dir)) + ship.vel.y),
      },
      life: BULLET_LIFETIME_FRAMES,
      owner: 'player',
    })
  }

  return { bullets: next, firePrev: input.fire, fired }
}
