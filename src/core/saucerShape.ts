// src/core/saucerShape.ts
//
// A-21: the flying saucer's rendered silhouette, hoisted out of shell/render.ts
// so core/saucerDebris.ts can fracture the SAME shape shell/render.ts's drawSaucer
// strokes — one geometry source, not two independently-tuned copies (shipShape.ts's
// precedent for the ship, applied here to the saucer).
//
// Silhouette dimensions in world lo-units — the classic lens hull with a domed
// canopy, a shade under twice the ship's width. Provisional; A-17 ports exact
// tables. y is world-up. The saucer is axis-aligned (it never banks), so the
// geometry is a pure translation of `saucer.pos` — no heading, unlike the ship.

import type { Saucer, Vec2 } from './state'

export const SAUCER_HALF_W = 140
export const SAUCER_HULL_TOP = 44
export const SAUCER_HULL_BOTTOM = -40
export const SAUCER_HULL_SHOULDER = 56
export const SAUCER_CANOPY_HALF_W = 30
export const SAUCER_CANOPY_TOP = 78

/** One stroked outline of the saucer silhouette: a run of vertices and whether it
 * closes back to the first (the hull lens does; the canopy dome and waistline seam
 * do not). */
export interface SaucerPolyline {
  points: readonly Vec2[]
  closed: boolean
}

/** The saucer's rendered silhouette as the THREE polylines drawSaucer strokes,
 * positioned at `saucer.pos`: the closed 6-point hull lens, the open 4-point
 * canopy dome, and the 2-point waistline seam. THE single geometry source — both
 * the renderer (drawSaucer) and the breakup (saucerSegments → breakSaucer) build
 * from this, so the fractured pieces always match what was on screen. Pure;
 * returns fresh points (no aliasing of the input). */
export function saucerPolylines(saucer: Saucer): readonly SaucerPolyline[] {
  const { x, y } = saucer.pos
  return [
    {
      closed: true,
      points: [
        { x: x - SAUCER_HALF_W, y },
        { x: x - SAUCER_HULL_SHOULDER, y: y + SAUCER_HULL_TOP },
        { x: x + SAUCER_HULL_SHOULDER, y: y + SAUCER_HULL_TOP },
        { x: x + SAUCER_HALF_W, y },
        { x: x + SAUCER_HULL_SHOULDER, y: y + SAUCER_HULL_BOTTOM },
        { x: x - SAUCER_HULL_SHOULDER, y: y + SAUCER_HULL_BOTTOM },
      ],
    },
    {
      closed: false,
      points: [
        { x: x - SAUCER_HULL_SHOULDER, y: y + SAUCER_HULL_TOP },
        { x: x - SAUCER_CANOPY_HALF_W, y: y + SAUCER_CANOPY_TOP },
        { x: x + SAUCER_CANOPY_HALF_W, y: y + SAUCER_CANOPY_TOP },
        { x: x + SAUCER_HULL_SHOULDER, y: y + SAUCER_HULL_TOP },
      ],
    },
    {
      closed: false,
      points: [
        { x: x - SAUCER_HALF_W, y },
        { x: x + SAUCER_HALF_W, y },
      ],
    },
  ]
}

/** Expand a polyline into its edges. A closed poly adds the wrap-around edge
 * (last → first); an open one does not. Fresh tuples/points each call. */
function edgesOf(points: readonly Vec2[], closed: boolean): Array<readonly [Vec2, Vec2]> {
  const out: Array<readonly [Vec2, Vec2]> = []
  const last = closed ? points.length : points.length - 1
  for (let i = 0; i < last; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    out.push([
      { x: a.x, y: a.y },
      { x: b.x, y: b.y },
    ])
  }
  return out
}

/** The saucer's rendered silhouette as individual line segments, in the same order
 * drawSaucer strokes them: the closed 6-point hull lens (6 edges), the open canopy
 * dome (3 edges), then the waistline seam (1 edge) — 10 edges total. Derived from
 * the same saucerPolylines the renderer uses. Pure; fresh points. */
export function saucerSegments(saucer: Saucer): ReadonlyArray<readonly [Vec2, Vec2]> {
  return saucerPolylines(saucer).flatMap(({ points, closed }) => edgesOf(points, closed))
}
