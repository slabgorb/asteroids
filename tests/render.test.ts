// tests/render.test.ts
//
// Story A-5 (RED) — the vector render foundation, ship silhouette, and thrust
// flame. render.ts draws to a canvas, but the testable seam is the *sequence of
// draw calls*: we drive render() with a mock CanvasRenderingContext2D that
// records every stroked segment (moveTo→lineTo) and every fillRect/clearRect,
// then assert on the recorded geometry. This is the star-wars render-test harness
// (tests/shell/render.tie-orient.test.ts) ported to this cabinet; vitest runs in
// the `node` environment (no DOM), so a mock — not jsdom — is the right tool.
//
// These tests assert MECHANISMS, not pixel coordinates, so they survive the
// provisional ship silhouette (ROM-exact vertices land in A-17) while still
// pinning the contracts that matter:
//   - the ship's heading (ship.dir) and position (ship.pos) reach the screen
//   - the "pointing up = dir 64" convention (state.ts) renders nose-toward-top
//   - the thrust flame appears only under thrust, and draws aft of the ship
//   - the frame is cleared to black each call
//   - render() never mutates the pure core state (AC-4)
//
// RED until src/shell/render.ts exists and exports render(ctx, state, W, H, input).

import { describe, it, expect } from 'vitest'
import { render } from '../src/shell/render'
import { initialState, type GameState, type Ship, type Mode, type ShipDebrisSegment } from '../src/core/state'
import { NO_INPUT, type Input } from '../src/core/input'

const W = 800
const H = 600

/** A canvas-context stub that records the vector geometry render() emits, so we
 *  can assert what was drawn without a real DOM canvas. Segments are [x1,y1,x2,y2]
 *  in the order they were stroked; the current point advances on lineTo the way a
 *  real 2D context's path does, so a polygon's actual edges are captured. */
function makeCtx() {
  const segments: number[][] = []
  const fills: { x: number; y: number; w: number; h: number; style: string }[] = []
  const clears: { x: number; y: number; w: number; h: number }[] = []
  // A2-5: the alpha in effect at the moment each shape COMMITS (stroke()) — the
  // real canvas rasterizes with globalAlpha as of that call, so this is the
  // faithful place to capture it (not e.g. reading rec.globalAlpha after the
  // fact, which could observe a later shape's value).
  const strokeAlphas: number[] = []
  let pen: [number, number] = [0, 0]
  const rec = {
    fillStyle: '' as string,
    strokeStyle: '' as string,
    shadowColor: '' as string,
    shadowBlur: 0,
    lineWidth: 0,
    lineCap: '' as string,
    lineJoin: '' as string,
    globalAlpha: 1,
    globalCompositeOperation: '' as string,
    save() {},
    restore() {},
    scale() {},
    translate() {},
    rotate() {},
    beginPath() {},
    closePath() {},
    stroke() {
      strokeAlphas.push(rec.globalAlpha)
    },
    fill() {},
    moveTo(x: number, y: number) {
      pen = [x, y]
    },
    lineTo(x: number, y: number) {
      segments.push([pen[0], pen[1], x, y])
      pen = [x, y]
    },
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ x, y, w, h, style: rec.fillStyle })
    },
    clearRect(x: number, y: number, w: number, h: number) {
      clears.push({ x, y, w, h })
    },
    arc() {},
    // A-16: the HUD draws text; this suite asserts vector geometry only, so the
    // text call is a recorded-nowhere no-op (tests/render-hud.test.ts owns text).
    fillText() {},
  }
  return { ctx: rec as unknown as CanvasRenderingContext2D, segments, fills, clears, strokeAlphas }
}

/** A live run with the ship overridden — mode defaults to 'playing' so the ship
 *  is unambiguously on-screen (attract-mode framing is out of A-5's scope). */
const shipState = (over: Partial<Ship> = {}, mode: Mode = 'playing'): GameState => {
  const s = initialState(1979)
  return { ...s, mode, ship: { ...s.ship, ...over } }
}

const thrusting: Input = { ...NO_INPUT, thrust: true }

const endpointYs = (segs: number[][]): number[] => segs.flatMap((s) => [s[1], s[3]])
const segKey = (s: number[]): string => s.join(',')

describe('render — ship silhouette (AC-2)', () => {
  it('draws the ship as stroked vector segments', () => {
    const { ctx, segments } = makeCtx()
    render(ctx, shipState(), W, H, NO_INPUT)
    expect(segments.length).toBeGreaterThan(0)
  })

  it('honours the ship heading — a rotated ship draws different geometry (dir reaches the screen)', () => {
    const up = makeCtx()
    render(up.ctx, shipState({ dir: 64 }), W, H, NO_INPUT)

    const sideways = makeCtx()
    render(sideways.ctx, shipState({ dir: 128 }), W, H, NO_INPUT)

    // Both draw a ship, so both produce segments...
    expect(up.segments.length).toBeGreaterThan(0)
    expect(sideways.segments.length).toBeGreaterThan(0)
    // ...and since the states differ ONLY in ship.dir, honouring the heading MUST
    // change the stroked geometry. RED while the silhouette ignores dir.
    expect(sideways.segments).not.toEqual(up.segments)
  })

  it('honours the ship position — a translated ship draws different geometry (pos reaches the screen)', () => {
    const base = initialState(1979).ship.pos
    const centred = makeCtx()
    render(centred.ctx, shipState(), W, H, NO_INPUT)

    const shifted = makeCtx()
    render(shifted.ctx, shipState({ pos: { x: base.x + 2000, y: base.y + 1500 } }), W, H, NO_INPUT)

    expect(centred.segments.length).toBeGreaterThan(0)
    expect(shifted.segments.length).toBeGreaterThan(0)
    // Same ship, different world position → different screen translation.
    expect(shifted.segments).not.toEqual(centred.segments)
  })

  it('renders "pointing up" (dir 64) with the nose toward the top of the screen', () => {
    // state.ts spawns the ship at dir 64 = "pointing up". For that to read as up,
    // world +y must project to screen −y. So a ship pointing up (dir 64) must
    // reach higher up the screen (smaller y) than one pointing down (dir 192),
    // and a down-pointing ship must reach lower (larger y). This anchors the
    // vertical orientation and catches a flipped or dir-ignoring projection.
    const upCtx = makeCtx()
    render(upCtx.ctx, shipState({ dir: 64 }), W, H, NO_INPUT)

    const downCtx = makeCtx()
    render(downCtx.ctx, shipState({ dir: 192 }), W, H, NO_INPUT)

    expect(upCtx.segments.length).toBeGreaterThan(0)
    expect(downCtx.segments.length).toBeGreaterThan(0)

    const up = endpointYs(upCtx.segments)
    const down = endpointYs(downCtx.segments)
    // Nose-up reaches higher (smaller min y) than nose-down.
    expect(Math.min(...up)).toBeLessThan(Math.min(...down))
    // Nose-down reaches lower (larger max y) than nose-up.
    expect(Math.max(...down)).toBeGreaterThan(Math.max(...up))
  })
})

describe('render — fresh black field each frame (AC-1)', () => {
  it('clears the whole frame to black (or transparent) before drawing', () => {
    const { ctx, fills, clears } = makeCtx()
    render(ctx, shipState(), W, H, NO_INPUT)

    const isFull = (r: { x: number; y: number; w: number; h: number }): boolean =>
      r.x <= 0 && r.y <= 0 && r.w >= W && r.h >= H
    const black = new Set(['#000', '#000000', 'black', 'rgb(0,0,0)', 'rgb(0, 0, 0)'])

    const fullBlackFill = fills.some((f) => isFull(f) && black.has(f.style.toLowerCase()))
    const fullClear = clears.some(isFull)
    // A vector cabinet must repaint a fresh black field every frame or the ship
    // smears. Accept a full-frame black fillRect OR a full-frame clearRect.
    expect(fullBlackFill || fullClear).toBe(true)
  })
})

describe('render — thrust flame (AC-3)', () => {
  it('draws a flame only while thrust is held', () => {
    const off = makeCtx()
    render(off.ctx, shipState({ dir: 64 }), W, H, NO_INPUT)

    const on = makeCtx()
    render(on.ctx, shipState({ dir: 64 }), W, H, thrusting)

    // Same ship, same frame — the only difference is input.thrust. The flame must
    // add geometry when thrust is on and vanish when it is off.
    expect(on.segments.length).toBeGreaterThan(off.segments.length)
  })

  it('draws the flame AFT — behind the ship, opposite the nose', () => {
    const off = makeCtx()
    render(off.ctx, shipState({ dir: 64 }), W, H, NO_INPUT)

    const on = makeCtx()
    render(on.ctx, shipState({ dir: 64 }), W, H, thrusting)

    // With only thrust differing, the ship-body segments are byte-identical, so
    // the segments present under thrust but absent without it ARE the flame.
    const offKeys = new Set(off.segments.map(segKey))
    const flame = on.segments.filter((s) => !offKeys.has(segKey(s)))
    expect(flame.length).toBeGreaterThan(0)

    // The ship sits at world centre → screen centre; pointing up (dir 64), aft is
    // downward on screen. The flame's geometry must live below the ship centre.
    const flameYs = endpointYs(flame)
    const flameMeanY = flameYs.reduce((a, b) => a + b, 0) / flameYs.length
    expect(flameMeanY).toBeGreaterThan(H / 2)
  })
})

describe('render — core purity (AC-4)', () => {
  it('never mutates the game state it is handed', () => {
    const state = shipState({ dir: 100 })
    const before = structuredClone(state)
    render(makeCtx().ctx, state, W, H, thrusting)
    // The renderer READS the core state and draws it; it must not write back.
    expect(state).toEqual(before)
  })
})

// A2-5 (Reviewer finding, rework): drawShipDebris and its wiring had zero test
// coverage — a mutant deleting the call, or the alpha-fade math, would have
// passed every pre-existing test in this file. `shipDestroyed: true` (and the
// default `lives: 0`/empty rocks/bullets/saucer from initialState) suppress
// every OTHER stroked entity, so `segments`/`strokeAlphas` isolate debris only.
describe('render — ship breakup debris (A2-5)', () => {
  function debrisState(segments: ShipDebrisSegment[]): GameState {
    const s = initialState(1979)
    return { ...s, mode: 'playing', shipDestroyed: true, shipDebris: segments }
  }

  const segAt = (life: number): ShipDebrisSegment => ({
    p1: { x: 4000, y: 3000 },
    p2: { x: 4100, y: 3000 },
    vel: { x: 0, y: 0 },
    life,
  })

  it('draws each debris segment as a stroked line', () => {
    const { ctx, segments } = makeCtx()
    render(ctx, debrisState([segAt(1), segAt(1)]), W, H, NO_INPUT)
    expect(segments.length).toBe(2) // one moveTo->lineTo per segment
  })

  it('draws nothing when there is no debris', () => {
    const { ctx, segments } = makeCtx()
    render(ctx, debrisState([]), W, H, NO_INPUT)
    expect(segments.length).toBe(0)
  })

  it('fades a segment out — less remaining life strokes at lower alpha', () => {
    const bright = makeCtx()
    render(bright.ctx, debrisState([segAt(1.5)]), W, H, NO_INPUT) // full life
    const dim = makeCtx()
    render(dim.ctx, debrisState([segAt(0.1)]), W, H, NO_INPUT) // nearly expired

    expect(bright.strokeAlphas).toHaveLength(1)
    expect(dim.strokeAlphas).toHaveLength(1)
    expect(dim.strokeAlphas[0]).toBeLessThan(bright.strokeAlphas[0])
  })
})

// A-21: the saucer death breakup grows a new stroked entity class
// (saucerDebris), mirroring A2-5's ship breakup. Pre-empts the exact Reviewer
// finding A2-5 drew (drawShipDebris had zero coverage). `shipDestroyed: true`
// (plus the default lives:0 / empty rocks/bullets / null saucer from
// initialState) suppress every OTHER stroked entity, so `segments`/`strokeAlphas`
// isolate the saucer debris alone. Deliberately does NOT import from
// ../src/core/saucerDebris — that module does not exist yet, and importing it
// would fail the whole file to load; the `saucerDebris` field reference is
// runtime-safe (an extra property under esbuild), and the pre-A-21 renderer
// simply strokes nothing for it -> RED until drawSaucerDebris is wired.
describe('render — saucer breakup debris (A-21)', () => {
  // Return type carries the not-yet-declared `saucerDebris` field explicitly, so
  // this fixture type-checks without an `as any`/`as unknown` escape (TS #1) and
  // `mode: 'playing'` stays contextually typed. Once Dev adds saucerDebris to
  // GameState the intersection collapses to plain GameState — no churn.
  function saucerDebrisState(
    segments: ShipDebrisSegment[],
  ): GameState & { saucerDebris: ShipDebrisSegment[] } {
    const s = initialState(1979)
    return { ...s, mode: 'playing', shipDestroyed: true, saucer: null, saucerDebris: segments }
  }

  const segAt = (life: number): ShipDebrisSegment => ({
    p1: { x: 4000, y: 3000 },
    p2: { x: 4100, y: 3000 },
    vel: { x: 0, y: 0 },
    life,
  })

  it('draws each saucer-debris segment as a stroked line', () => {
    const { ctx, segments } = makeCtx()
    render(ctx, saucerDebrisState([segAt(1), segAt(1)]), W, H, NO_INPUT)
    expect(segments.length).toBe(2) // one moveTo->lineTo per segment
  })

  it('draws nothing when there is no saucer debris', () => {
    const { ctx, segments } = makeCtx()
    render(ctx, saucerDebrisState([]), W, H, NO_INPUT)
    expect(segments.length).toBe(0)
  })

  it('fades a segment out — less remaining life strokes at lower alpha', () => {
    // Alpha is monotonic in remaining life (life/lifetime), so more life must
    // stroke brighter regardless of the exact SAUCER_DEBRIS_LIFETIME_S value.
    const bright = makeCtx()
    render(bright.ctx, saucerDebrisState([segAt(1)]), W, H, NO_INPUT)
    const dim = makeCtx()
    render(dim.ctx, saucerDebrisState([segAt(0.1)]), W, H, NO_INPUT)

    expect(bright.strokeAlphas).toHaveLength(1)
    expect(dim.strokeAlphas).toHaveLength(1)
    expect(dim.strokeAlphas[0]).toBeLessThan(bright.strokeAlphas[0])
  })
})
