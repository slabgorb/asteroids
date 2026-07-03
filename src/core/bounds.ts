// src/core/bounds.ts
//
// A-6: the shared toroidal-wrap module. A-3 (ship) and A-4 (bullet) each grew
// an identical private `wrap(v, size)` helper — the ROM's UpdateObjPos ($6fc7)
// fold (X masks hi mod $20, Y snaps at $18; both reduce to exact mod at all
// reachable speeds). Rocks need the very same fold, so the position-only core
// is hoisted here: ship and rocks wrap bit-for-bit identically BY CONSTRUCTION
// (one function) rather than by convention (parallel copies that can drift).

import type { Vec2 } from './state'

/** A rectangular toroidal playfield: positions fold into [0, width) x [0, height). */
export interface Bounds {
  width: number
  height: number
}

/** Scalar toroidal fold into [0, size) — exact mod, correct for negatives. */
function wrap(v: number, size: number): number {
  return ((v % size) + size) % size
}

/** Fold a position into the passed bounds on both axes. Pure: returns a fresh
 * Vec2 and never mutates the input. */
export function wrapPosition(position: Vec2, bounds: Bounds): Vec2 {
  return {
    x: wrap(position.x, bounds.width),
    y: wrap(position.y, bounds.height),
  }
}
