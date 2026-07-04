// tests/render-hud.test.ts
//
// RED-phase suite for Story A-16, Part E: the HUD — the first story to RENDER
// score/lives at all (A-9 computed the score; nothing has ever drawn it) — plus
// the attract-mode start prompt and the game-over overlay texts.
//
// Like tests/render.test.ts (A-5), the testable seam is the sequence of draw
// calls, not pixels: vitest runs in `node`, so we drive render() with a recording
// stub. Unlike A-5's explicit makeCtx, this one is a Proxy that records
// fillText/strokeText strings and counts lineTo segments while no-oping every
// other context member — HUD text lands via the canvas text API (the vendored
// vector font sets ctx.font; star-wars' render.ts precedent), and a Proxy keeps
// this suite from breaking every time Dev touches an unrelated ctx call.
//
// These tests pin MECHANISMS (which strings reach the screen; that lives change
// the drawn geometry), never layout/coordinates — position, size, and glow are
// AC-5-style visual criteria, eyeballed at http://localhost:5275/asteroids/
// per the epic's render guardrail.

import { describe, it, expect } from 'vitest'
import { render } from '../src/shell/render'
import { initialState, type GameState } from '../src/core/state'
import { NO_INPUT } from '../src/core/input'
import { formatScore } from '../src/core/score'

const W = 800
const H = 600

type GameOverPhase = {
  qualifies: boolean
  initials: string
  confirmed: boolean
  displayTimer: number
}
type Entry = { name: string; score: number; wave: number; date?: string }
type FramedState = GameState & { gameOver: GameOverPhase | null; highScoreTable: Entry[] }

/** Proxy ctx recorder: collects every fillText/strokeText string and counts
 * stroked segments; every other method is a no-op, every property is settable.
 * measureText returns width 0 so centring math never NaNs. */
function makeTextCtx() {
  const texts: string[] = []
  let segments = 0
  const target: Record<string | symbol, unknown> = {
    canvas: { width: W, height: H },
  }
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop === 'fillText' || prop === 'strokeText') {
        return (text: unknown) => {
          texts.push(String(text))
        }
      }
      if (prop === 'lineTo') {
        return () => {
          segments += 1
        }
      }
      if (prop === 'measureText') return () => ({ width: 0 })
      if (prop in t) return t[prop]
      return () => {} // any other ctx method: recorded nowhere, breaks nothing
    },
    set(t, prop, value) {
      t[prop] = value
      return true
    },
  })
  return {
    ctx: proxy as unknown as CanvasRenderingContext2D,
    texts,
    segmentCount: () => segments,
  }
}

const playing = (over: Partial<FramedState> = {}): FramedState => ({
  ...initialState(1),
  mode: 'playing',
  lives: 3,
  gameOver: null,
  highScoreTable: [],
  ...over,
})

const drawnTexts = (state: GameState): string[] => {
  const { ctx, texts } = makeTextCtx()
  render(ctx, state, W, H, NO_INPUT)
  return texts
}

// ---- HUD: score + high score --------------------------------------------------

describe('render — HUD score display (first story to draw the score)', () => {
  it('draws the current score as the 6-digit cabinet display string', () => {
    const texts = drawnTexts(playing({ score: 1250 }))
    expect(texts.some((t) => t.includes(formatScore(1250)))).toBe(true) // "001250"
  })

  it('draws the persisted high score alongside the current score', () => {
    const texts = drawnTexts(
      playing({ score: 20, highScoreTable: [{ name: 'AAA', score: 5000, wave: 3 }] }),
    )
    expect(texts.some((t) => t.includes(formatScore(5000)))).toBe(true)
    expect(texts.some((t) => t.includes(formatScore(20)))).toBe(true)
  })

  // The high-score slot is a RUNNING max (context: "max of the persisted table's
  // top entry and the current score"), so once the live run beats the table, the
  // stale table top must no longer appear anywhere on the HUD.
  it('shows the live running max, not the beaten table top', () => {
    const texts = drawnTexts(
      playing({ score: 6000, highScoreTable: [{ name: 'AAA', score: 5000, wave: 3 }] }),
    )
    expect(texts.some((t) => t.includes(formatScore(6000)))).toBe(true)
    expect(texts.some((t) => t.includes(formatScore(5000)))).toBe(false)
  })
})

// ---- HUD: lives icons -----------------------------------------------------------

describe('render — HUD lives icons', () => {
  it('draws more geometry with 3 ships in reserve than with none', () => {
    const three = makeTextCtx()
    render(three.ctx, playing({ lives: 3 }), W, H, NO_INPUT)
    const zero = makeTextCtx()
    render(zero.ctx, playing({ lives: 0 }), W, H, NO_INPUT)
    // One ship-glyph per remaining life: the reserve row must add strokes.
    expect(three.segmentCount()).toBeGreaterThan(zero.segmentCount())
  })
})

// ---- attract overlay -------------------------------------------------------------

describe('render — attract-mode overlay', () => {
  it('shows a start prompt during the attract cycle', () => {
    // The overlay may CYCLE (prompt <-> high-score board, per the ROM's
    // pre-game routine), so sample the attract loop across ticks and require
    // the prompt to appear at least once rather than pinning the cycle phase.
    const attract: FramedState = { ...initialState(1), gameOver: null, highScoreTable: [] }
    const seen: string[] = []
    for (let tick = 0; tick <= 600; tick += 30) {
      seen.push(...drawnTexts({ ...attract, tick }))
    }
    expect(seen.some((t) => /START/i.test(t))).toBe(true)
  })
})

// ---- game-over overlay ------------------------------------------------------------

describe('render — game-over overlay', () => {
  const gameOverState = (over: GameOverPhase, score = 2500): FramedState => ({
    ...initialState(1),
    mode: 'gameover',
    score,
    lives: 0,
    shipDestroyed: true,
    gameOver: over,
    highScoreTable: [],
  })

  it('announces GAME OVER on the non-qualifying path', () => {
    const texts = drawnTexts(
      gameOverState({ qualifies: false, initials: '', confirmed: false, displayTimer: 5 }),
    )
    expect(texts.some((t) => /GAME\s*OVER/i.test(t))).toBe(true)
  })

  it('shows the final score on the game-over screen', () => {
    const texts = drawnTexts(
      gameOverState({ qualifies: false, initials: '', confirmed: false, displayTimer: 5 }, 2500),
    )
    expect(texts.some((t) => t.includes(formatScore(2500)))).toBe(true)
  })

  it('prompts for initials on the qualifying path and echoes what was typed', () => {
    const texts = drawnTexts(
      gameOverState({ qualifies: true, initials: 'AC', confirmed: false, displayTimer: 10 }),
    )
    expect(texts.some((t) => /INITIAL/i.test(t))).toBe(true)
    expect(texts.some((t) => t.includes('AC'))).toBe(true)
  })
})

// ---- render stays read-only over the new fields ------------------------------------

describe('render — never mutates the framing state (A-5 AC-4 boundary, extended)', () => {
  it('leaves a game-over state untouched', () => {
    const s: FramedState = {
      ...initialState(9),
      mode: 'gameover',
      score: 777,
      gameOver: { qualifies: true, initials: 'A', confirmed: false, displayTimer: 4 },
      highScoreTable: [{ name: 'AAA', score: 9000, wave: 2 }],
    }
    const snapshot = structuredClone(s)
    const { ctx } = makeTextCtx()
    render(ctx, s, W, H, NO_INPUT)
    expect(s).toEqual(snapshot)
  })
})
