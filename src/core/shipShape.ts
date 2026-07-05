// src/core/shipShape.ts
//
// A2-5: the ship's rendered silhouette, hoisted out of shell/render.ts so
// core/shipDebris.ts can fracture the SAME polygon shell/render.ts's drawShip
// strokes — one function, not two independently-tuned copies (bounds.ts's
// "one function, not parallel copies" precedent for wrap logic, applied here
// to ship geometry: session TEA Delivery Finding).
//
// Ship silhouette dimensions, in world lo-units (~200 tip-to-tail → ~25px on a
// 1024-wide field). Provisional — the ROM-exact shape table is A-17's quarry.

import type { Ship, Vec2 } from './state'

export const SHIP_NOSE = 130
export const SHIP_TAIL = 70
export const SHIP_HALF_WIDTH = 75
export const SHIP_NOTCH = 35

/** Heading basis from `dir` (256-unit circle): forward unit vector (fx, fy)
 * and its +90° perpendicular (px, py). */
export function shipHeading(dir: number): { fx: number; fy: number; px: number; py: number } {
  const theta = (dir / 256) * Math.PI * 2
  const fx = Math.cos(theta)
  const fy = Math.sin(theta)
  return { fx, fy, px: -fy, py: fx }
}

/** The ship's 4 polygon vertices in world space, in the same order the
 * renderer strokes them: nose, right wing, tail notch, left wing. */
export function shipVertices(ship: Ship): [Vec2, Vec2, Vec2, Vec2] {
  const { fx, fy, px, py } = shipHeading(ship.dir)
  const { x, y } = ship.pos
  return [
    { x: x + fx * SHIP_NOSE, y: y + fy * SHIP_NOSE },
    { x: x - fx * SHIP_TAIL + px * SHIP_HALF_WIDTH, y: y - fy * SHIP_TAIL + py * SHIP_HALF_WIDTH },
    { x: x - fx * SHIP_NOTCH, y: y - fy * SHIP_NOTCH },
    { x: x - fx * SHIP_TAIL - px * SHIP_HALF_WIDTH, y: y - fy * SHIP_TAIL - py * SHIP_HALF_WIDTH },
  ]
}
