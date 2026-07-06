// src/core/shrapnel.ts
//
// A2-8: rock-break shrapnel — the dim, short-lived scatter of debris dots the
// 1979 ROM draws on EVERY object explosion (DrawObjectExplode $7349 ->
// ShrapPatPtrTbl $50F8), distinct from the ship's line-fragment breakup
// (core/shipDebris.ts, A2-5). Reuses shipDebris.ts's transient-particle shape
// (a pos/vel/life dot + an update*(dt) that ages and drops), but three ways
// different, per the Architect's ROM quarry (memory: asteroids-a2-8-shrapnel-quarry):
//   - RNG-FREE: the ROM patterns are fixed data, so spawnShrapnel takes only a
//     position and draws no randomness — a rock break must NOT perturb the
//     wave/saucer spawn RNG stream (the A2-6 determinism lesson).
//   - ANCHORED: the burst does not inherit the destroyed rock's velocity; its
//     dots spread symmetrically from a fixed point (ROM: the exploding object
//     skips UpdateObjPos — it never translates; only its render scale grows).
//   - POINT-BASED: each piece is a single dot, not a line segment.

import type { Shrapnel, Vec2 } from './state'

/** Seconds a shrapnel dot lives before it is dropped. ROM: the object-explosion
 * timer counts ~20 frames (~0.33s @60Hz) from $A0 to rollover — a quick flicker,
 * far shorter than the ship breakup's DEBRIS_LIFETIME_S (1.5s). Feel-based
 * provisional in the house "verify vs quarry (A-17)" tradition. */
export const SHRAPNEL_LIFETIME_S = 0.35

/** How many dots a break scatters — the ROM shrapnel patterns are ~10-11 dots.
 * A render-fidelity count, not load-bearing. */
export const SHRAPNEL_COUNT = 11

/** Outward spread speed, world-units per 60 Hz frame (the Ship.vel/Rock.velocity
 * unit). Small: over SHRAPNEL_LIFETIME_S the cloud grows only ~SPREAD*21 units —
 * a subtle bloom, not a shockwave. Feel-based provisional (verify vs quarry A-17). */
const SHRAPNEL_SPREAD_SPEED = 2.4

/** The fixed (RNG-FREE) scatter pattern: SHRAPNEL_COUNT outward velocity vectors
 * on evenly-spaced headings, with a small harmonic speed variation so the dots
 * read as an irregular scatter rather than a perfect ring. Evenly-spaced full-
 * circle headings make the pattern centroid-balanced — its mean velocity is
 * exactly zero (harmonics k>=2 sum to zero over the ring), so the burst EXPANDS
 * from the impact point without ever drifting off it: the ROM's stationary-anchor
 * shrapnel, modelled as symmetric per-dot velocity. A provisional stand-in for the
 * ROM's exact ShrapPatPtrTbl geometry (verify vs quarry A-17). */
const SHRAPNEL_PATTERN: readonly Vec2[] = Array.from({ length: SHRAPNEL_COUNT }, (_, i) => {
  const theta = (i / SHRAPNEL_COUNT) * Math.PI * 2
  const speed = SHRAPNEL_SPREAD_SPEED * (1 + 0.35 * Math.cos(2 * theta) + 0.2 * Math.sin(3 * theta))
  return { x: Math.cos(theta) * speed, y: Math.sin(theta) * speed }
})

/** Scatter a burst of debris dots at a rock's break point. Every dot starts AT
 * `center` and spreads along the fixed pattern; PURE and RNG-FREE (no rng
 * parameter — a break must not consume randomness, or it would shift the spawn
 * stream, cf. A2-6). Fresh objects, input untouched. */
export function spawnShrapnel(center: Vec2): Shrapnel[] {
  return SHRAPNEL_PATTERN.map((vel) => ({
    pos: { x: center.x, y: center.y },
    vel: { x: vel.x, y: vel.y },
    life: SHRAPNEL_LIFETIME_S,
  }))
}

/** Advance every dot one step: rigid translation (pos += vel * frames, the
 * rocks.ts/bullet.ts per-frame convention — NO toroidal wrap, unlike rocks),
 * life decremented by dt (seconds), dropped once life reaches zero. Returns
 * fresh dots (no aliasing of the input), mirroring updateShipDebris. */
export function updateShrapnel(particles: readonly Shrapnel[], dt: number): Shrapnel[] {
  const frames = dt * 60
  const out: Shrapnel[] = []
  for (const p of particles) {
    const life = p.life - dt
    if (life <= 0) continue
    out.push({
      pos: { x: p.pos.x + p.vel.x * frames, y: p.pos.y + p.vel.y * frames },
      vel: { x: p.vel.x, y: p.vel.y },
      life,
    })
  }
  return out
}
