// src/core/shipDebris.ts
//
// A2-5: ship death breakup — on the destruction edge, the ship's rendered
// silhouette (shipShape.ts's 4-vertex polygon) fractures into its 4 edges as
// independent drifting, fading debris segments. Mirrors rocks.ts's splitRock
// (inherited heading + independent random angular spread) for motion, and
// bullet.ts's Bullet.life (countdown to removal) for lifetime.

import type { Ship, ShipDebrisSegment, Vec2 } from './state'
import { nextFloat, type Rng } from '@arcade/shared/rng'
import { shipVertices } from './shipShape'

/** Seconds a debris piece drifts before fading out. Feel-based provisional —
 * same "pin relationships/positivity, not exact magnitudes" convention as
 * rocks.ts's speed bands (verify vs quarry, A-17). */
export const DEBRIS_LIFETIME_S = 1.5

/** Outward drift speed added to each piece on top of the ship's own velocity
 * at death, world-units per 60 Hz frame (the Ship.vel/Rock.velocity unit). */
const BREAKUP_SPEED = 6

/** Angular spread (radians) applied to each piece's outward heading. A polar
 * fan is right for ship debris (pieces spray outward from a point); note rocks.ts
 * splitRock uses a different, ROM-derived per-axis velocity kick (A2-6), not this. */
const BREAKUP_SPREAD_ANGLE = Math.PI / 4

/** Fracture a destroyed ship into its 4 rendered edges, each an independent
 * debris segment: outward heading from the ship's center to the edge's
 * midpoint, spread by BREAKUP_SPREAD_ANGLE, plus the
 * ship's own velocity at death (debris carries its momentum). Pure over
 * `ship`; consumes the passed rng — advances its seed, exactly like
 * splitRock, so the caller clones state.rng before calling. */
export function breakShip(ship: Ship, rng: Rng): ShipDebrisSegment[] {
  const [nose, rightWing, notch, leftWing] = shipVertices(ship)
  const edges: ReadonlyArray<readonly [Vec2, Vec2]> = [
    [nose, rightWing],
    [rightWing, notch],
    [notch, leftWing],
    [leftWing, nose],
  ]
  return edges.map(([p1, p2]) => {
    const midX = (p1.x + p2.x) / 2
    const midY = (p1.y + p2.y) / 2
    const outward = Math.atan2(midY - ship.pos.y, midX - ship.pos.x)
    const angle = outward + (nextFloat(rng) * 2 - 1) * BREAKUP_SPREAD_ANGLE
    return {
      p1: { x: p1.x, y: p1.y },
      p2: { x: p2.x, y: p2.y },
      vel: {
        x: ship.vel.x + Math.cos(angle) * BREAKUP_SPEED,
        y: ship.vel.y + Math.sin(angle) * BREAKUP_SPEED,
      },
      life: DEBRIS_LIFETIME_S,
    }
  })
}

/** Advance every debris segment one step: rigid translation of both endpoints
 * (pos += velocity * frames, the rocks.ts/bullet.ts per-frame convention),
 * life decremented by dt (seconds), dropped once life reaches zero. Returns
 * fresh segments (no aliasing of the input), mirroring updateRock/advance. */
export function updateShipDebris(
  segments: readonly ShipDebrisSegment[],
  dt: number,
): ShipDebrisSegment[] {
  const frames = dt * 60
  const out: ShipDebrisSegment[] = []
  for (const seg of segments) {
    const life = seg.life - dt
    if (life <= 0) continue
    out.push({
      p1: { x: seg.p1.x + seg.vel.x * frames, y: seg.p1.y + seg.vel.y * frames },
      p2: { x: seg.p2.x + seg.vel.x * frames, y: seg.p2.y + seg.vel.y * frames },
      vel: { x: seg.vel.x, y: seg.vel.y },
      life,
    })
  }
  return out
}
