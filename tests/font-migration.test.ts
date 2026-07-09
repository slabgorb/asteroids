// tests/font-migration.test.ts
//
// RED-phase suite for Story SH2-4: migrate asteroids' HUD/framing text off the
// vendored "Vector Battle" TTF (ctx.font + ctx.fillText) onto @arcade/shared/font
// stroke-vectors (layoutText -> stroked glyph geometry), honouring asteroids'
// A2-2 letter tracking through layoutText's `letterSpacing` opt.
//
// The migration DELETES the text-as-string canvas signal: post-migration NO text
// reaches ctx.fillText — every glyph is stroked like the ship and rocks. So the
// testable seams here are (1) a recording ctx that proves fillText / ctx.font /
// ctx.letterSpacing are never touched and that the initials-entry text becomes
// stroke geometry, and (2) fs + source-text scans that the TTF asset and its
// FontFace loader are gone and render.ts now imports layoutText. The strings
// handed to layoutText (score, prompts, echo) and the A2-2 opts contract are
// pinned in tests/render-hud.test.ts and tests/font-layout.test.ts via the
// layoutText mock. Position / size / glow stay eyeball criteria in the dev
// server per the epic's render guardrail — these tests pin MECHANISM, never
// coordinates.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { render } from '../src/shell/render'
import { initialState, type GameState, type GameOverPhase } from '../src/core/state'
import { NO_INPUT } from '../src/core/input'

const W = 800
const H = 600

// ---- recording ctx: flags every fillText / ctx.font / ctx.letterSpacing touch,
// counts stroked segments. Every other member no-ops (Proxy) so this suite does
// not break when Dev touches an unrelated ctx call. ------------------------------
function recCtx() {
  const rec = {
    fillTextCalls: [] as string[],
    fontSets: [] as unknown[],
    letterSpacingSets: [] as unknown[],
    segments: 0,
    canvas: { width: W, height: H },
  }
  const target = rec as unknown as Record<string | symbol, unknown>
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop === 'fillText' || prop === 'strokeText') {
        return (s: unknown) => {
          rec.fillTextCalls.push(String(s))
        }
      }
      if (prop === 'lineTo') {
        return () => {
          rec.segments += 1
        }
      }
      if (prop === 'measureText') return () => ({ width: 0 })
      if (prop in t) return t[prop]
      return () => {}
    },
    set(t, prop, value) {
      if (prop === 'font') rec.fontSets.push(value)
      if (prop === 'letterSpacing') rec.letterSpacingSets.push(value)
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

const attract = (over: Partial<GameState> = {}): GameState => ({
  ...initialState(1),
  highScoreTable: [{ name: 'AAA', score: 9000, wave: 6 }],
  ...over,
})

// A game-over state; `qualifies` toggles the three extra initials-entry text runs
// (prompt lines + the underscore-padded echo) while every non-text field — same
// seed, same rocks, ship destroyed — is held identical, so any stroke-count
// delta between the two is TEXT geometry only.
const gameOver = (over: GameOverPhase): GameState => ({
  ...initialState(1),
  mode: 'gameover',
  score: 2500,
  lives: 0,
  shipDestroyed: true,
  gameOver: over,
  highScoreTable: [],
})

const NON_QUALIFYING: GameOverPhase = {
  qualifies: false,
  initials: '',
  confirmed: false,
  displayTimer: 5,
}
const QUALIFYING: GameOverPhase = {
  qualifies: true,
  initials: 'AC',
  confirmed: false,
  displayTimer: 10,
}

const allModes = (): GameState[] => [
  playing({ score: 1250 }),
  attract({ tick: 10 }), // prompt page
  attract({ tick: 250 }), // high-score board page
  gameOver(NON_QUALIFYING),
  gameOver(QUALIFYING),
]

// ---- (1) mechanism: text is stroked, never drawn through the canvas text API ----

describe('SH2-4 — HUD text no longer uses the canvas text API', () => {
  it('never calls ctx.fillText / ctx.strokeText in any mode', () => {
    for (const state of allModes()) {
      const { ctx, rec } = recCtx()
      render(ctx, state, W, H, NO_INPUT)
      expect(rec.fillTextCalls, `fillText was called for ${state.mode}`).toEqual([])
    }
  })

  it('never sets ctx.font — the TTF face string path is gone', () => {
    for (const state of allModes()) {
      const { ctx, rec } = recCtx()
      render(ctx, state, W, H, NO_INPUT)
      expect(rec.fontSets, `ctx.font was set for ${state.mode}`).toEqual([])
    }
  })

  it('never sets ctx.letterSpacing — A2-2 tracking moved to layoutText opts', () => {
    for (const state of allModes()) {
      const { ctx, rec } = recCtx()
      render(ctx, state, W, H, NO_INPUT)
      expect(rec.letterSpacingSets, `ctx.letterSpacing was set for ${state.mode}`).toEqual([])
    }
  })

  it('strokes the extra initials-entry text as vector geometry', () => {
    // Qualifying draws three extra text runs (two prompt lines + the echo) that
    // non-qualifying does not; with text as strokes the qualifying frame must add
    // stroked segments. Pre-migration both go through fillText, so the counts are
    // equal and this fails (the RED signal).
    const q = recCtx()
    render(q.ctx, gameOver(QUALIFYING), W, H, NO_INPUT)
    const nq = recCtx()
    render(nq.ctx, gameOver(NON_QUALIFYING), W, H, NO_INPUT)
    expect(q.rec.segments).toBeGreaterThan(nq.rec.segments)
  })
})

// ---- (2) the Vector Battle TTF asset + its FontFace loader are gone -------------

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url))
const RENDER = fileURLToPath(new URL('../src/shell/render.ts', import.meta.url))
const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url))
const FONTS_DIR = fileURLToPath(new URL('../public/fonts/', import.meta.url))
const read = (p: string): string => readFileSync(p, 'utf8')

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = dir + name
    if (statSync(p).isDirectory()) out.push(...tsFiles(p + '/'))
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

describe('SH2-4 — the non-commercial TTF face and its loader are retired', () => {
  it('ships no .ttf under public/fonts/', () => {
    const ttfs = existsSync(FONTS_DIR)
      ? readdirSync(FONTS_DIR).filter((f) => f.toLowerCase().endsWith('.ttf'))
      : []
    expect(ttfs, `stray TTF asset(s): ${ttfs.join(', ')}`).toEqual([])
  })

  it('no source file references FontFace or document.fonts', () => {
    const offenders = tsFiles(SRC_DIR).filter((p) => /\bFontFace\b|document\.fonts/.test(read(p)))
    expect(offenders.map((p) => p.replace(SRC_DIR, 'src/'))).toEqual([])
  })

  it('no source file references loadVectorFont', () => {
    const offenders = tsFiles(SRC_DIR).filter((p) => /\bloadVectorFont\b/.test(read(p)))
    expect(offenders.map((p) => p.replace(SRC_DIR, 'src/'))).toEqual([])
  })

  it("no source file references the 'Vector Battle' font family", () => {
    const offenders = tsFiles(SRC_DIR).filter((p) => /Vector Battle/.test(read(p)))
    expect(offenders.map((p) => p.replace(SRC_DIR, 'src/'))).toEqual([])
  })

  it('main.ts no longer boots a TTF font load', () => {
    expect(/\bloadVectorFont\b/.test(read(MAIN)), 'main.ts still calls loadVectorFont').toBe(false)
  })
})

// ---- (3) render.ts strokes shared-font glyphs instead of TTF text --------------

describe('SH2-4 — render.ts draws text via @arcade/shared/font layoutText', () => {
  it('uses no canvas text API (fillText / ctx.font / ctx.letterSpacing) in source', () => {
    const src = read(RENDER)
    expect(/\bfillText\b/.test(src), 'render.ts still calls fillText').toBe(false)
    expect(/\bctx\.font\b/.test(src), 'render.ts still sets ctx.font').toBe(false)
    expect(/\bletterSpacing\b/.test(src), 'render.ts still sets ctx.letterSpacing').toBe(false)
  })

  it('imports and calls layoutText', () => {
    const src = read(RENDER)
    expect(/\blayoutText\b/.test(src), 'render.ts does not reference layoutText').toBe(true)
    expect(
      /import[^;]*\blayoutText\b[^;]*from\s*['"](?:\.\/font|@arcade\/shared\/font)['"]/.test(src),
      'render.ts must import layoutText from ./font or @arcade/shared/font',
    ).toBe(true)
    expect(/\blayoutText\s*\(/.test(src), 'render.ts must call layoutText(...)').toBe(true)
  })
})
