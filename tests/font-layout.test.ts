// tests/font-layout.test.ts
//
// RED-phase suite for Story SH2-4, the A2-2 letter-spacing contract: asteroids'
// HUD/framing strings must flow through @arcade/shared/font `layoutText`, and the
// caps-only face's inter-glyph tracking (A2-2 — the thin strokes read cramped at
// zero tracking) must be expressed through layoutText's `letterSpacing` OPT, not
// hand-rolled on ctx.letterSpacing.
//
// The shared font is mocked at the local ./font seam (tempest's precedent:
// render.ts imports layoutText from './font', which re-exports
// @arcade/shared/font). The mock records the (text, opts) handed to layoutText
// and returns trivial-but-valid geometry, so the assertions are decoupled from
// the shared package resolving and from real glyph coordinates.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '../src/shell/render'
import { initialState, type GameState, type GameOverPhase } from '../src/core/state'
import { NO_INPUT } from '../src/core/input'
import { formatScore } from '../src/core/score'

const font = vi.hoisted(() => {
  const calls: { text: string; opts: { letterSpacing?: number } | undefined }[] = []
  return {
    calls,
    layoutText(text: string, opts?: { letterSpacing?: number }) {
      calls.push({ text, opts })
      const n = [...text].length
      const sp = opts?.letterSpacing ?? 0
      return { strokes: [{ points: [{ x: 0, y: 0 }, { x: 16, y: 0 }] }], width: 16 * n + sp * n }
    },
  }
})

vi.mock('../src/shell/font', () => ({
  layoutText: font.layoutText,
  CELL_W: 16,
  CELL_H: 24,
  hasGlyph: () => true,
  charGlyph: () => ({ strokes: [], advance: 24 }),
  GLYPH_CHARS: ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_,/',
}))

const W = 800
const H = 600

function ctxRec() {
  const rec = {
    letterSpacingSets: [] as unknown[],
    fontSets: [] as unknown[],
    canvas: { width: W, height: H },
  }
  const proxy = new Proxy(rec as unknown as Record<string | symbol, unknown>, {
    get(t, prop) {
      if (prop === 'measureText') return () => ({ width: 0 })
      if (prop in t) return t[prop]
      return () => {}
    },
    set(t, prop, value) {
      if (prop === 'letterSpacing') rec.letterSpacingSets.push(value)
      if (prop === 'font') rec.fontSets.push(value)
      t[prop] = value
      return true
    },
  })
  return { ctx: proxy as unknown as CanvasRenderingContext2D, rec }
}

const playing = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(1),
  mode: 'playing',
  lives: 3,
  gameOver: null,
  highScoreTable: [],
  ...over,
})

const gameOver = (over: GameOverPhase): GameState => ({
  ...initialState(1),
  mode: 'gameover',
  score: 2500,
  lives: 0,
  shipDestroyed: true,
  gameOver: over,
  highScoreTable: [],
})

const QUALIFYING: GameOverPhase = {
  qualifies: true,
  initials: 'AC',
  confirmed: false,
  displayTimer: 10,
}

function layoutFor(state: GameState) {
  font.calls.length = 0
  const { ctx } = ctxRec()
  render(ctx, state, W, H, NO_INPUT)
  return font.calls
}

beforeEach(() => {
  font.calls.length = 0
})

describe('SH2-4 — HUD strings flow through layoutText', () => {
  it('routes the score string through layoutText', () => {
    const calls = layoutFor(playing({ score: 1250 }))
    expect(calls.some((c) => c.text.includes(formatScore(1250)))).toBe(true)
  })

  it('routes the underscore-padded initials echo through layoutText', () => {
    // over.initials === 'AC' -> echo 'AC_' (render.ts:405). The '_' glyph is the
    // SH2-3 addition asteroids depends on — it must survive the layout, not blank.
    const calls = layoutFor(gameOver(QUALIFYING))
    expect(calls.some((c) => c.text === 'AC_')).toBe(true)
  })
})

describe('SH2-4 — A2-2 tracking is carried by the layoutText opt, not ctx', () => {
  it('passes a positive letterSpacing on every laid-out run', () => {
    // Every HUD/overlay run wants tracking (the caps-only face reads cramped at
    // zero). A constant cell-space letterSpacing reproduces the old 0.1em × px
    // screen tracking once glyph geometry is scaled — the value need not vary
    // with size, but it must be > 0 and consistent across a run's measure+draw.
    const calls = layoutFor(gameOver(QUALIFYING))
    expect(calls.length, 'render never called layoutText').toBeGreaterThan(0)
    for (const c of calls) {
      expect(
        c.opts?.letterSpacing ?? 0,
        `run "${c.text}" was laid out with no positive letterSpacing`,
      ).toBeGreaterThan(0)
    }
  })

  it('never sets ctx.letterSpacing — the hand-rolled tracking path is gone', () => {
    const { ctx, rec } = ctxRec()
    render(ctx, gameOver(QUALIFYING), W, H, NO_INPUT)
    expect(rec.letterSpacingSets).toEqual([])
  })
})
