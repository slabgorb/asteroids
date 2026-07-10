// tests/name-entry-backspace.test.ts
//
// SH2-13 RED — asteroids is the cabinet's REFERENCE typing flow, and this story
// (a) gives it the one thing it lacks, Backspace, and (b) re-roots the mechanism
// in the shared reducer (@arcade/shared/name-entry) so all four scoring games
// share the VERB. The existing typing contracts live in tests/framing.test.ts
// and must keep passing untouched; this file adds only the NEW contracts:
//
//  - enterInitial(state, 'Backspace') deletes the last typed initial, cannot
//    delete past an empty buffer, and obeys the same mode/phase guards as
//    letters (AC-2).
//  - Holding start across the entry-screen transition does not auto-confirm
//    (AC-4 — the tempest 6-2 / battlezone held-fire regression class). The
//    startPrev shift-register already pins this for a press held across
//    confirm->attract (framing.test.ts); here we pin the INBOUND direction.
//  - The mechanism is the SHARED one: some core module imports
//    '@arcade/shared/name-entry' (AC-3), and the shell forwards Backspace
//    (src/main.ts today forwards only /^[a-zA-Z]$/).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stepGame, enterInitial } from '../src/core/sim'
import { initialState, type GameState } from '../src/core/state'
import { NO_INPUT, type Input } from '../src/core/input'

const DT = 1 / 60
const START: Input = { ...NO_INPUT, start: true }

/** A qualifying gameover: score 2500 on wave 4, one existing board entry
 *  (the framing.test.ts fixture, kept in lockstep). */
function qualifyingGameOver(seed = 3): GameState {
  return {
    ...initialState(seed),
    mode: 'gameover',
    score: 2500,
    wave: 4,
    lives: 0,
    shipDestroyed: true,
    gameOver: { qualifies: true, initials: '', confirmed: false, displayTimer: 10 },
    highScoreTable: [{ name: 'AAA', score: 9000, wave: 6, date: '2026-07-01T00:00:00.000Z' }],
  }
}

const typeAll = (s: GameState, chars: string[]): GameState =>
  chars.reduce((acc, ch) => enterInitial(acc, ch), s)

// ---- Backspace: the missing half of the reference flow (AC-2) -----------------

describe('enterInitial — Backspace deletes the last typed initial', () => {
  it('removes the last character', () => {
    const s = typeAll(qualifyingGameOver(), ['a', 'c'])
    const out = enterInitial(s, 'Backspace')
    expect(out.gameOver?.initials).toBe('A')
  })

  it('cannot delete past an empty buffer', () => {
    const s = qualifyingGameOver()
    const out = enterInitial(s, 'Backspace')
    expect(out.gameOver?.initials).toBe('')
    expect(out).toEqual(s) // a no-op, not a mutated sibling
  })

  it('deletes from a FULL buffer and allows a corrected retype', () => {
    const typo = typeAll(qualifyingGameOver(), ['a', 'c', 'x'])
    const fixed = enterInitial(enterInitial(typo, 'Backspace'), 'e')
    expect(fixed.gameOver?.initials).toBe('ACE')
  })

  it('a corrected entry commits under the corrected name, not the typo', () => {
    const typo = typeAll(qualifyingGameOver(), ['a', 'c', 'x'])
    const fixed = enterInitial(enterInitial(typo, 'Backspace'), 'e')
    const s1 = stepGame(fixed, START, DT)
    expect(s1.mode).toBe('attract')
    expect(s1.highScoreTable.some((e) => e.name === 'ACE')).toBe(true)
    expect(s1.highScoreTable.some((e) => e.name === 'ACX')).toBe(false)
  })
})

describe('enterInitial — Backspace obeys the same guards as letters', () => {
  it('is inert in attract', () => {
    const attract = initialState(5)
    expect(enterInitial(attract, 'Backspace')).toEqual(attract)
  })

  it('is inert while playing', () => {
    const playing: GameState = { ...initialState(5), mode: 'playing' }
    expect(enterInitial(playing, 'Backspace')).toEqual(playing)
  })

  it('is inert on a NON-qualifying game-over', () => {
    const nonQualifying: GameState = {
      ...qualifyingGameOver(),
      gameOver: { qualifies: false, initials: '', confirmed: false, displayTimer: 5 },
    }
    expect(enterInitial(nonQualifying, 'Backspace')).toEqual(nonQualifying)
  })
})

// ---- Held confirm across the transition (AC-4) --------------------------------

describe('stepGame — a start press HELD into the entry screen cannot confirm (AC-4)', () => {
  it('held start (startPrev latched) never edges, even with a full buffer', () => {
    // The strong form of the inbound guard: even if three initials are already
    // typed, a start that has been DOWN since before this frame (startPrev
    // true) must not confirm — only a fresh press may.
    const ready: GameState = { ...typeAll(qualifyingGameOver(), ['a', 'c', 'e']), startPrev: true }
    let s = ready
    for (let i = 0; i < 120; i++) s = stepGame(s, START, DT) // 2 s of held start
    expect(s.mode).toBe('gameover')
    expect(s.gameOver?.initials).toBe('ACE')
    expect(s.highScoreTable).toHaveLength(1) // no phantom insert
  })

  it('release-then-press confirms exactly once', () => {
    const ready: GameState = { ...typeAll(qualifyingGameOver(), ['a', 'c', 'e']), startPrev: true }
    let s = stepGame(ready, START, DT) // still held — inert
    s = stepGame(s, NO_INPUT, DT) // released
    s = stepGame(s, START, DT) // fresh press — commits
    expect(s.mode).toBe('attract')
    expect(s.highScoreTable).toHaveLength(2)
    expect(s.highScoreTable[1]).toMatchObject({ name: 'ACE', score: 2500 })
  })
})

// ---- The shared VERB (AC-3): mechanism lives in @arcade/shared ----------------

const coreDir = fileURLToPath(new URL('../src/core', import.meta.url))
const coreSources = (): string =>
  readdirSync(coreDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(`${coreDir}/${f}`, 'utf8'))
    .join('\n')

describe('the entry mechanism is the SHARED reducer, not a local fork (AC-3)', () => {
  it('some core module imports @arcade/shared/name-entry', () => {
    expect(coreSources()).toContain('@arcade/shared/name-entry')
  })
})

describe('the shell forwards Backspace to the core entry path (AC-2 wiring)', () => {
  it('src/main.ts names the Backspace key', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')
    expect(main).toContain('Backspace')
  })
})
