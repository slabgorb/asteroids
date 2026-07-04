// tests/margin.test.ts
//
// Story A2-1 (RED) — the playfield margin mask, pure-geometry seam.
//
// The Asteroids world is a fixed 4:3 rectangle (WORLD_W x WORLD_H) that render()
// projects with a uniform *fit* scale (Math.min(w/WORLD_W, h/WORLD_H)) and centres
// on the canvas (render.ts `View`/`toScreen`). When the canvas aspect ratio does
// not match 4:3, that fit leaves letterbox/pillarbox bars — the "non-playable
// margin" the story wants to overlay so the arena reads as clearly bounded.
//
// The bar geometry — which screen rectangles are the margin, given only the canvas
// size — is a PURE function of (w, h): no canvas, no state, no time. That is the
// unit-testable seam. This suite pins it via an INDEPENDENT oracle (`fit`, below)
// that re-derives the expected centred-fit playfield straight from the WORLD
// constants and the documented formula, so the tests specify the geometry rather
// than echo the implementation.
//
// RED until src/shell/margin.ts exists and exports `marginRects(w, h): Rect[]`.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WORLD_W, WORLD_H } from '../src/core/state'
import { marginRects, type Rect } from '../src/shell/margin'

const EPS = 1e-6

/** Independent oracle: the centred, uniform-fit projection of the 4:3 world into a
 *  w x h canvas — the same contract render()'s `view.scale`/`toScreen` implement,
 *  expressed straight from the spec so it is not circular with marginRects. */
function fit(w: number, h: number) {
  const s = Math.min(w / WORLD_W, h / WORLD_H)
  const pw = WORLD_W * s
  const ph = WORLD_H * s
  const left = (w - pw) / 2
  const top = (h - ph) / 2
  return { s, pw, ph, left, top, right: left + pw, bottom: top + ph }
}

const totalArea = (rs: readonly Rect[]): number => rs.reduce((a, r) => a + r.w * r.h, 0)

/** True if (x, y) falls inside any bar (half-open [x, x+w) x [y, y+h), so a point
 *  exactly on the playfield edge counts as playfield, not margin). */
const covers = (rs: readonly Rect[], x: number, y: number): boolean =>
  rs.some((r) => x >= r.x - EPS && x < r.x + r.w - EPS && y >= r.y - EPS && y < r.y + r.h - EPS)

/** True if a bar overlaps the OPEN playfield rectangle — i.e. it eats into the
 *  play area rather than staying in the margin. */
const hitsPlayfield = (r: Rect, f: ReturnType<typeof fit>): boolean =>
  r.x + r.w > f.left + EPS && r.x < f.right - EPS && r.y + r.h > f.top + EPS && r.y < f.bottom - EPS

// ---- pillarbox: canvas WIDER than the 4:3 world → left/right bars --------------

describe('marginRects — pillarbox (canvas wider than the 4:3 world)', () => {
  const W = 1600
  const H = 600 // 1600:600 = 2.67 ≫ 1.33, so the fit is height-limited → side bars
  const f = fit(W, H)

  it('masks exactly the non-playable area (Σ bar area === canvas − playfield)', () => {
    // The bars must tile the whole margin and no more: total area is the canvas
    // minus the projected playfield. Over-covers → eats the play area; under →
    // leaves margin unmasked.
    expect(totalArea(marginRects(W, H))).toBeCloseTo(W * H - f.pw * f.ph, 3)
  })

  it('never intrudes into the playfield interior', () => {
    for (const r of marginRects(W, H)) {
      expect(hitsPlayfield(r, f), `bar ${JSON.stringify(r)} overlaps the play area`).toBe(false)
    }
  })

  it('covers a point in each side margin but leaves the playfield centre clear', () => {
    const rs = marginRects(W, H)
    expect(covers(rs, f.left / 2, H / 2), 'left margin uncovered').toBe(true)
    expect(covers(rs, (f.right + W) / 2, H / 2), 'right margin uncovered').toBe(true)
    expect(covers(rs, W / 2, H / 2), 'playfield centre wrongly masked').toBe(false)
  })

  it('is mirror-symmetric about the vertical centreline (bars are centred)', () => {
    const rs = marginRects(W, H)
    for (const x of [2, 100, 399, 401, 800, 1199, 1201, 1598]) {
      expect(covers(rs, x, H / 2), `asymmetry at x=${x}`).toBe(covers(rs, W - x, H / 2))
    }
  })

  it('keeps every bar inside the canvas with non-negative extents', () => {
    for (const r of marginRects(W, H)) {
      expect(r.w).toBeGreaterThanOrEqual(-EPS)
      expect(r.h).toBeGreaterThanOrEqual(-EPS)
      expect(r.x).toBeGreaterThanOrEqual(-EPS)
      expect(r.y).toBeGreaterThanOrEqual(-EPS)
      expect(r.x + r.w).toBeLessThanOrEqual(W + EPS)
      expect(r.y + r.h).toBeLessThanOrEqual(H + EPS)
    }
  })
})

// ---- letterbox: canvas TALLER than the 4:3 world → top/bottom bars -------------

describe('marginRects — letterbox (canvas taller than the 4:3 world)', () => {
  const W = 600
  const H = 1600 // 600:1600 = 0.375 ≪ 1.33, so the fit is width-limited → top/bottom bars
  const f = fit(W, H)

  it('masks exactly the non-playable area (Σ bar area === canvas − playfield)', () => {
    expect(totalArea(marginRects(W, H))).toBeCloseTo(W * H - f.pw * f.ph, 3)
  })

  it('never intrudes into the playfield interior', () => {
    for (const r of marginRects(W, H)) {
      expect(hitsPlayfield(r, f), `bar ${JSON.stringify(r)} overlaps the play area`).toBe(false)
    }
  })

  it('covers a point in each top/bottom margin but leaves the playfield centre clear', () => {
    const rs = marginRects(W, H)
    expect(covers(rs, W / 2, f.top / 2), 'top margin uncovered').toBe(true)
    expect(covers(rs, W / 2, (f.bottom + H) / 2), 'bottom margin uncovered').toBe(true)
    expect(covers(rs, W / 2, H / 2), 'playfield centre wrongly masked').toBe(false)
  })

  it('is mirror-symmetric about the horizontal centreline (bars are centred)', () => {
    const rs = marginRects(W, H)
    for (const y of [2, 100, 574, 576, 800, 1024, 1026, 1598]) {
      expect(covers(rs, W / 2, y), `asymmetry at y=${y}`).toBe(covers(rs, W / 2, H - y))
    }
  })
})

// ---- exact 4:3: playfield fills the canvas → NO margin -------------------------

describe('marginRects — exact 4:3 canvas (nothing to mask)', () => {
  // A canvas whose aspect already matches the world leaves no margin; a mask that
  // painted anything here would dim a live edge of the arena for no reason.
  it.each([
    [800, 600],
    [1024, 768],
    [1600, 1200],
  ])('adds zero masked area at %ix%i', (W, H) => {
    expect(totalArea(marginRects(W, H))).toBeCloseTo(0, 6)
  })
})

// ---- axis selection: the crux of the geometry ---------------------------------

describe('marginRects — puts the margin on the correct axis for near-square canvases', () => {
  it('a canvas a hair too WIDE gets side bars, not top/bottom', () => {
    const W = 810
    const H = 600 // 1.35 > 1.333 → pillarbox
    const rs = marginRects(W, H)
    expect(covers(rs, 2, H / 2), 'expected a left bar').toBe(true)
    expect(covers(rs, W - 2, H / 2), 'expected a right bar').toBe(true)
    expect(covers(rs, W / 2, 2), 'unexpected top bar').toBe(false)
    expect(covers(rs, W / 2, H - 2), 'unexpected bottom bar').toBe(false)
  })

  it('a canvas a hair too TALL gets top/bottom bars, not sides', () => {
    const W = 800
    const H = 610 // 1.311 < 1.333 → letterbox
    const rs = marginRects(W, H)
    expect(covers(rs, W / 2, 2), 'expected a top bar').toBe(true)
    expect(covers(rs, W / 2, H - 2), 'expected a bottom bar').toBe(true)
    expect(covers(rs, 2, H / 2), 'unexpected left bar').toBe(false)
    expect(covers(rs, W - 2, H / 2), 'unexpected right bar').toBe(false)
  })
})

// ---- determinism & purity -----------------------------------------------------

describe('marginRects — deterministic and side-effect free', () => {
  it('returns deep-equal geometry on repeated calls', () => {
    expect(marginRects(1600, 600)).toEqual(marginRects(1600, 600))
  })

  it('hands back a fresh array each call (no shared mutable state)', () => {
    const a = marginRects(1600, 600)
    const b = marginRects(1600, 600)
    expect(a).not.toBe(b)
    a.length = 0 // mutating the caller's copy must not poison the next call
    expect(marginRects(1600, 600)).toEqual(b)
  })
})

// ---- TS lang-review #1: no type-safety escapes --------------------------------

describe('margin.ts — introduces no type-safety escapes (TS lang-review #1)', () => {
  const SRC = fileURLToPath(new URL('../src/shell/margin.ts', import.meta.url))

  it('src/shell/margin.ts exists', () => {
    // RED until Dev creates the module.
    expect(existsSync(SRC), 'src/shell/margin.ts must exist').toBe(true)
  })

  it('uses no `as any` and no @ts-ignore', () => {
    expect(existsSync(SRC)).toBe(true)
    const src = readFileSync(SRC, 'utf8')
    expect(/\bas any\b/.test(src), 'margin.ts must not use `as any`').toBe(false)
    expect(/@ts-ignore/.test(src), 'margin.ts must not use @ts-ignore').toBe(false)
  })
})
