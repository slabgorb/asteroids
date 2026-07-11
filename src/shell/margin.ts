// src/shell/margin.ts
//
// A2-1: the playfield margin geometry. The core world is a fixed 4:3 rectangle
// (WORLD_W x WORLD_H); render() projects it at a uniform *fit* scale and centres
// it on the canvas. When the canvas aspect ratio is not 4:3 that fit leaves
// letterbox/pillarbox bars — the "non-playable margin". A2-1 overlays those bars
// so the black play area reads as a clearly bounded arena inside an off-4:3
// browser window.
//
// The bar geometry is a PURE function of the canvas size: no canvas, no state, no
// time. render() consumes `marginRects` to paint the mask, and shares `fitScale`
// so the mask and the drawn world derive from ONE scale and can never drift (the
// same parallel-copy hazard core/bounds.ts was created to eliminate).

import { letterbox } from '@arcade/shared/view'
import { WORLD_W, WORLD_H } from '../core/state'

// SH2-10: the centred aspect-fit is now @arcade/shared/view's pure `letterbox`
// (folded from this module's old inline `Math.min(w/WORLD_W, h/WORLD_H)`). The 4:3
// world aspect drives it; `fitScale`/`marginRects` below are asteroids' cabinet
// presentation of that one shared fit (px-per-world-unit + the drawn margin bars).
const WORLD_ASPECT = WORLD_W / WORLD_H

/** A screen-space rectangle (device px), origin top-left. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// Sub-pixel slack: a margin thinner than this is invisible dust from the fit
// division rounding, not a real bar, so it is dropped.
const MARGIN_EPS = 1e-6

/** The uniform fit scale mapping the 4:3 world into a w x h canvas: the largest
 *  scale at which the whole WORLD_W x WORLD_H world fits. Derived from the shared
 *  letterbox (box.width === WORLD_W × scale), so the mask and the drawn world use
 *  one scale. */
export function fitScale(w: number, h: number): number {
  return letterbox(w, h, WORLD_ASPECT).width / WORLD_W
}

/** The non-playable margin as screen-space bars: whatever letterbox/pillarbox
 *  space the centred, uniform-fit projection of the 4:3 world leaves on the
 *  canvas. Two side bars when the canvas is wider than 4:3, two top/bottom bars
 *  when taller, none when the aspect already matches. Pure — a function of
 *  (w, h) only — and returns a fresh array each call. */
export function marginRects(w: number, h: number): Rect[] {
  const box = letterbox(w, h, WORLD_ASPECT)
  const marginX = box.x // side-bar width (0 when width limits the fit)
  const marginY = box.y // top/bottom-bar height (0 when height limits)
  const rects: Rect[] = []
  if (marginX > MARGIN_EPS) {
    rects.push({ x: 0, y: 0, w: marginX, h })
    rects.push({ x: w - marginX, y: 0, w: marginX, h })
  }
  if (marginY > MARGIN_EPS) {
    rects.push({ x: 0, y: 0, w, h: marginY })
    rects.push({ x: 0, y: h - marginY, w, h: marginY })
  }
  return rects
}
