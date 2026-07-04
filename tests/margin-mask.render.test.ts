// tests/margin-mask.render.test.ts
//
// Story A2-1 (RED) — the margin mask, wired into render().
//
// margin.test.ts pins the pure bar geometry. This suite pins that render()
// actually PAINTS that mask, and paints it without breaking the two things the
// ACs guard: it must not obscure the play area, and it must not obscure the HUD.
//
// The testable seam (as in render.test.ts) is the ordered stream of draw calls a
// mock CanvasRenderingContext2D records. render() already fills one full-frame
// black background rect; the mask is any *non*-full-frame fill on top. The mock
// timestamps every fillRect and fillText with a monotonic order counter so we can
// assert the mask lands BEFORE the first HUD glyph — the deterministic expression
// of "does not obscure UI elements". Exact opacity is a feel value the house
// convention verifies in the dev server, so this suite pins that the mask reads as
// a dark overlay in the margin, not its precise alpha.
//
// An INDEPENDENT oracle (`fit`) re-derives the expected playfield from the WORLD
// constants so the margin/play-area classification is not circular with margin.ts.
//
// RED until render() draws a margin mask.

import { describe, it, expect } from 'vitest'
import { render } from '../src/shell/render'
import { WORLD_W, WORLD_H, initialState, type GameState, type Mode } from '../src/core/state'
import { NO_INPUT } from '../src/core/input'

const EPS = 1e-6

type FillRec = { x: number; y: number; w: number; h: number; style: string; alpha: number; order: number }
type TextRec = { x: number; y: number; order: number }

/** A canvas-context stub that records fillRect / fillText in draw order. */
function makeCtx() {
  const fills: FillRec[] = []
  const texts: TextRec[] = []
  const segments: number[][] = []
  let pen: [number, number] = [0, 0]
  let order = 0
  const rec = {
    fillStyle: '' as string,
    strokeStyle: '' as string,
    shadowColor: '' as string,
    shadowBlur: 0,
    lineWidth: 0,
    globalAlpha: 1,
    textAlign: '' as CanvasTextAlign,
    font: '' as string,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    stroke() {},
    fill() {},
    arc() {},
    moveTo(x: number, y: number) {
      pen = [x, y]
    },
    lineTo(x: number, y: number) {
      segments.push([pen[0], pen[1], x, y])
      pen = [x, y]
    },
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ x, y, w, h, style: rec.fillStyle, alpha: rec.globalAlpha, order: order++ })
    },
    clearRect() {},
    fillText(_t: string, x: number, y: number) {
      texts.push({ x, y, order: order++ })
    },
  }
  return { ctx: rec as unknown as CanvasRenderingContext2D, fills, texts, segments }
}

function fit(w: number, h: number) {
  const s = Math.min(w / WORLD_W, h / WORLD_H)
  const pw = WORLD_W * s
  const ph = WORLD_H * s
  const left = (w - pw) / 2
  const top = (h - ph) / 2
  return { left, top, right: left + pw, bottom: top + ph }
}

const isFullFrame = (f: FillRec, w: number, h: number): boolean =>
  f.x <= EPS && f.y <= EPS && f.w >= w - EPS && f.h >= h - EPS

/** The mask is every fill that is not the full-frame background clear. */
const maskFillsOf = (fills: FillRec[], w: number, h: number): FillRec[] =>
  fills.filter((f) => !isFullFrame(f, w, h))

const containsPoint = (f: FillRec, x: number, y: number): boolean =>
  x >= f.x - EPS && x <= f.x + f.w + EPS && y >= f.y - EPS && y <= f.y + f.h + EPS

const hitsPlayfield = (f: FillRec, p: ReturnType<typeof fit>): boolean =>
  f.x + f.w > p.left + EPS && f.x < p.right - EPS && f.y + f.h > p.top + EPS && f.y < p.bottom - EPS

/** A dark overlay: black-family fill (globalAlpha carries the transparency, or an
 *  rgba()/#rrggbbaa spec does). Matches the two natural implementations without
 *  pinning the exact opacity, which is browser-verified. */
const isDarkOverlay = (style: string): boolean => {
  const s = style.trim().toLowerCase()
  return /^#0{3,8}$/.test(s) || s === 'black' || /^rgba?\(\s*0\s*,\s*0\s*,\s*0\b/.test(s)
}

const playingState = (over: Partial<GameState> = {}, mode: Mode = 'playing'): GameState => ({
  ...initialState(1979),
  mode,
  ...over,
})

// ---- pillarbox: the mask covers the side margins, nothing else -----------------

describe('render margin mask — pillarbox (wide canvas)', () => {
  const W = 1600
  const H = 600
  const p = fit(W, H)

  it('paints a mask, and only over the non-playable margin', () => {
    const { ctx, fills } = makeCtx()
    render(ctx, playingState(), W, H, NO_INPUT)
    const mask = maskFillsOf(fills, W, H)
    expect(mask.length, 'no margin mask was drawn').toBeGreaterThan(0)
    for (const f of mask) {
      expect(hitsPlayfield(f, p), `mask fill ${JSON.stringify(f)} covers the play area`).toBe(false)
    }
    // and it actually reaches both side margins
    expect(mask.some((f) => containsPoint(f, p.left / 2, H / 2)), 'left margin unmasked').toBe(true)
    expect(mask.some((f) => containsPoint(f, (p.right + W) / 2, H / 2)), 'right margin unmasked').toBe(true)
  })

  it('never paints over the playfield centre — gameplay stays fully visible', () => {
    const { ctx, fills } = makeCtx()
    render(ctx, playingState(), W, H, NO_INPUT)
    for (const f of maskFillsOf(fills, W, H)) {
      expect(containsPoint(f, W / 2, H / 2), 'mask covers the playfield centre').toBe(false)
    }
  })

  it('draws the mask BEFORE the HUD text, so the HUD is never obscured (AC-2)', () => {
    const { ctx, fills, texts } = makeCtx()
    render(ctx, playingState(), W, H, NO_INPUT)
    const mask = maskFillsOf(fills, W, H)
    expect(mask.length).toBeGreaterThan(0)
    expect(texts.length, 'expected HUD text to be drawn').toBeGreaterThan(0)
    const firstHudOrder = Math.min(...texts.map((t) => t.order))
    for (const f of mask) {
      expect(f.order, 'a mask fill was drawn on top of the HUD').toBeLessThan(firstHudOrder)
    }
  })

  it('reads as a dark overlay (AC-2 intent; exact opacity is browser-verified)', () => {
    const { ctx, fills } = makeCtx()
    render(ctx, playingState(), W, H, NO_INPUT)
    for (const f of maskFillsOf(fills, W, H)) {
      expect(isDarkOverlay(f.style), `mask fill style "${f.style}" is not a dark overlay`).toBe(true)
    }
  })

  it('does not mutate the core state it renders', () => {
    const state = playingState()
    const before = structuredClone(state)
    render(makeCtx().ctx, state, W, H, NO_INPUT)
    expect(state).toEqual(before)
  })
})

// ---- letterbox: same guarantees on the other axis ------------------------------

describe('render margin mask — letterbox (tall canvas)', () => {
  const W = 600
  const H = 1600
  const p = fit(W, H)

  it('masks the top and bottom margins but never the playfield centre', () => {
    const { ctx, fills } = makeCtx()
    render(ctx, playingState(), W, H, NO_INPUT)
    const mask = maskFillsOf(fills, W, H)
    expect(mask.length, 'no margin mask was drawn').toBeGreaterThan(0)
    expect(mask.some((f) => containsPoint(f, W / 2, p.top / 2)), 'top margin unmasked').toBe(true)
    expect(mask.some((f) => containsPoint(f, W / 2, (p.bottom + H) / 2)), 'bottom margin unmasked').toBe(true)
    for (const f of mask) {
      expect(hitsPlayfield(f, p), 'mask covers the play area').toBe(false)
    }
    expect(mask.some((f) => containsPoint(f, W / 2, H / 2)), 'mask covers the playfield centre').toBe(false)
  })
})

// ---- exact 4:3: nothing to mask -----------------------------------------------

describe('render margin mask — exact 4:3 canvas (no margin)', () => {
  it('paints no mask when the playfield already fills the canvas', () => {
    const W = 800
    const H = 600
    const { ctx, fills } = makeCtx()
    render(ctx, playingState(), W, H, NO_INPUT)
    // Only the full-frame background fill is allowed; no extra bars.
    expect(maskFillsOf(fills, W, H)).toHaveLength(0)
  })
})

// ---- always-on: the mask frames the arena in every mode ------------------------

describe('render margin mask — always-on framing', () => {
  it('draws the mask in attract mode too (it is arena framing, not a play-mode overlay)', () => {
    const W = 1600
    const H = 600
    const { ctx, fills } = makeCtx()
    render(ctx, playingState({}, 'attract'), W, H, NO_INPUT)
    expect(maskFillsOf(fills, W, H).length, 'attract-mode frame has no margin mask').toBeGreaterThan(0)
  })
})
