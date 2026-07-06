// src/core/saucerDebris.ts
//
// A-21: saucer death breakup — when the flying saucer is DESTROYED (a player shot,
// a ship ram, or a rock), its rendered silhouette fractures into independent
// drifting, fading line-segment debris, the visual twin of the player ship's
// breakup (core/shipDebris.ts, A2-5). Reuses shipDebris.ts's segment shape and its
// updateShipDebris ager (a segment is a segment), but with one deliberate
// difference from breakShip:
//   - RNG-FREE: breakShip CONSUMES rng (a random per-edge spread), but a saucer
//     death is followed IN THE SAME FRAME by stepSaucer + updateSpawnDirector
//     reading the shared rng, so any rng draw here would shift the wave/saucer
//     spawn stream (the A2-6/A2-8 determinism trap that made spawnShrapnel
//     RNG-free). breakSaucer therefore takes only the saucer and draws no
//     randomness — the pieces diverge via a FIXED index-based outward pattern.
//
// This breakup is a feel-based house embellishment (consistent visual language
// with the ship), NOT ROM-faithful — the 1979 ROM's saucer death is the
// shrapnel-dot explosion. Magnitudes below are provisional: verify vs quarry (A-17).

import type { Saucer, ShipDebrisSegment } from './state'
import { saucerSegments } from './saucerShape'

/** Seconds a saucer-debris piece drifts before it is dropped — matches the ship
 * breakup's feel (shipDebris.ts DEBRIS_LIFETIME_S). verify vs quarry (A-17). */
export const SAUCER_DEBRIS_LIFETIME_S = 1.5

/** Outward drift speed added to each piece on top of the saucer's velocity, world
 * lo-units per 60 Hz frame (the Saucer.velocity unit). verify vs quarry (A-17). */
const SAUCER_BREAKUP_SPEED = 6

/** Fracture a destroyed saucer into its rendered silhouette edges (saucerSegments),
 * each an independent debris segment. PURE and RNG-FREE: each piece flies outward
 * on a FIXED heading spaced evenly around the circle by its edge index (so every
 * piece moves — including the waistline, whose midpoint is the saucer center — and
 * the pieces diverge), plus the saucer's own velocity at death (debris carries its
 * momentum). Returns fresh segments (no aliasing); the input saucer is untouched. */
export function breakSaucer(saucer: Saucer): ShipDebrisSegment[] {
  const edges = saucerSegments(saucer)
  const n = edges.length
  return edges.map(([p1, p2], i) => {
    const theta = (i / n) * Math.PI * 2
    return {
      p1: { x: p1.x, y: p1.y },
      p2: { x: p2.x, y: p2.y },
      vel: {
        x: saucer.velocity.x + Math.cos(theta) * SAUCER_BREAKUP_SPEED,
        y: saucer.velocity.y + Math.sin(theta) * SAUCER_BREAKUP_SPEED,
      },
      life: SAUCER_DEBRIS_LIFETIME_S,
    }
  })
}
