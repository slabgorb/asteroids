// tests/framing.test.ts
//
// RED-phase suite for Story A-16, Part D: the qualifying game-over path —
// 3-letter initials capture, confirm, table insert — plus the STARTING_LIVES
// constant and full-cycle determinism across all three modes.
//
// Originally RED via module-load failure until GREEN created `enterInitial`
// and `STARTING_LIVES`. Review rework (round 1) added: the frozen-timer
// contract pin for a qualifying game-over left idle (the Thought Police found
// the wait-forever behaviour real but unpinned — a regression could silently
// flip it either way; the ROM's initials timeout is forward-carried to
// A-17/A-18), and the multi-character enterInitial no-op pin.
//
// TEA contract decisions pinned here (each logged in the session's Design
// Deviations):
//  - `enterInitial(state, char): GameState` is a PURE core event function the
//    shell calls per keydown. Initials characters are edge events, not per-frame
//    held state, so they do not ride on Input (whose plain-boolean contract
//    input.test.ts pins); Input grows only `start` — the one field the story
//    context names.
//  - Uppercased, A–Z only, capped at 3; non-letters and overflow are ignored.
//  - Confirm = input.start during a qualifying, unconfirmed gameover with
//    EXACTLY 3 initials typed; fewer than 3 leaves the state waiting.
//  - Confirm inserts { name, score, wave } — NO fabricated `date`: the core may
//    not touch the wall clock (core-boundary.test.ts bans Date.now; `date?` is
//    optional and stays absent from core-built entries).
//  - The start press is EDGE-triggered (A-4's firePrev precedent): a press held
//    across the confirm's gameover->attract transition must NOT also start a
//    new game on the next tick — otherwise one Enter press skips the board the
//    player just earned a place on.
//  - STARTING_LIVES: this file pins only the relationship (lives ===
//    STARTING_LIVES on start); the ROM magnitude (3, A-15) is pinned in
//    tests/lives.test.ts.

import { describe, it, expect } from 'vitest'
import { stepGame, enterInitial } from '../src/core/sim'
import { initialState, STARTING_LIVES, type GameState } from '../src/core/state'
import { NO_INPUT, type Input } from '../src/core/input'

const DT = 1 / 60

const START: Input = { ...NO_INPUT, start: true }

/** A qualifying gameover: score 2500 on wave 4, one existing board entry. */
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

// ---- STARTING_LIVES ----------------------------------------------------------

describe('STARTING_LIVES', () => {
  it('is a positive integer (the ROM magnitude, 3, is pinned in tests/lives.test.ts)', () => {
    expect(Number.isInteger(STARTING_LIVES)).toBe(true)
    expect(STARTING_LIVES).toBeGreaterThanOrEqual(1)
  })

  it('is what a start press deals out', () => {
    const attract: GameState = initialState(8)
    const s1 = stepGame(attract, START, DT)
    expect(s1.mode).toBe('playing')
    expect(s1.lives).toBe(STARTING_LIVES)
  })
})

// ---- enterInitial: capture rules ----------------------------------------------

describe('enterInitial — capture rules', () => {
  it('appends an uppercased letter', () => {
    const s1 = (enterInitial(qualifyingGameOver(), 'a'))
    expect(s1.gameOver?.initials).toBe('A')
  })

  it('accepts already-uppercase letters', () => {
    const s1 = (enterInitial(qualifyingGameOver(), 'K'))
    expect(s1.gameOver?.initials).toBe('K')
  })

  it('builds up to three initials in typing order', () => {
    const s = (typeAll(qualifyingGameOver(), ['a', 'c', 'e']))
    expect(s.gameOver?.initials).toBe('ACE')
  })

  it('ignores a fourth letter (capped at 3)', () => {
    const s = (typeAll(qualifyingGameOver(), ['a', 'c', 'e', 'x']))
    expect(s.gameOver?.initials).toBe('ACE')
  })

  it('ignores non-letter characters (digits, space, punctuation)', () => {
    const s = (typeAll(qualifyingGameOver(), ['1', ' ', '!', 'b', '.', '3']))
    expect(s.gameOver?.initials).toBe('B')
  })

  it('is inert outside a qualifying, unconfirmed gameover', () => {
    const attract: GameState = initialState(2)
    expect(enterInitial(attract, 'a')).toEqual(attract)

    const playing: GameState = {
      ...initialState(2),
      mode: 'playing',
      gameOver: null,
      highScoreTable: [],
    }
    expect(enterInitial(playing, 'a')).toEqual(playing)

    const nonQualifying: GameState = {
      ...qualifyingGameOver(),
      gameOver: { qualifies: false, initials: '', confirmed: false, displayTimer: 5 },
    }
    expect((enterInitial(nonQualifying, 'a')).gameOver?.initials).toBe('')
  })

  it('is pure: never mutates the input state', () => {
    const s0 = qualifyingGameOver()
    const snapshot = structuredClone(s0)
    enterInitial(s0, 'a')
    expect(s0).toEqual(snapshot)
  })

  // Review rework pin: the public contract is ONE character per call — a
  // multi-character string is a silent no-op, not a batch append.
  it('ignores multi-character input (single-char contract)', () => {
    const s0 = qualifyingGameOver()
    expect(enterInitial(s0, 'ab')).toEqual(s0)
    expect((enterInitial(s0, 'ab')).gameOver?.initials).toBe('')
  })
})

// ---- qualifying game-over left idle: the wait-forever contract ------------------

describe('stepGame — qualifying game-over waits indefinitely for initials', () => {
  // Review rework pin ([MEDIUM]): the qualifying branch deliberately does NOT
  // tick displayTimer — the cabinet holds the ENTER YOUR INITIALS screen until
  // the player types and confirms. Pinned so a refactor can't silently regress
  // it in either direction (auto-expiring a qualifying screen would eat the
  // player's board slot; the ROM-faithful default-entry timeout is a separate,
  // forward-carried A-17/A-18 concern — see session Delivery Findings).
  it('holds the phase unchanged across idle ticks: timer frozen, mode pinned', () => {
    let s: GameState = qualifyingGameOver()
    const before = qualifyingGameOver()
    for (let i = 0; i < 300; i++) s = stepGame(s, NO_INPUT, DT) // 5 idle seconds
    expect(s.mode).toBe('gameover')
    expect(s.gameOver).toEqual(before.gameOver) // qualifies/initials/confirmed/displayTimer all untouched
    expect(s.highScoreTable).toEqual(before.highScoreTable) // no phantom insert
  })
})

// ---- confirm: insert + return to attract ---------------------------------------

describe('stepGame — qualifying confirm (start with 3 initials)', () => {
  it('waits (stays in gameover, no insert) while fewer than 3 initials are typed', () => {
    const partial = typeAll(qualifyingGameOver(), ['a', 'c'])
    const s1 = (stepGame(partial, START, DT))
    expect(s1.mode).toBe('gameover')
    expect(s1.gameOver?.initials).toBe('AC')
    expect(s1.highScoreTable).toHaveLength(1) // untouched
  })

  it('inserts { name, score, wave } into the table and returns to attract', () => {
    const ready = typeAll(qualifyingGameOver(), ['a', 'c', 'e'])
    const s1 = (stepGame(ready, START, DT))
    expect(s1.mode).toBe('attract')
    expect(s1.gameOver).toBeNull()
    expect(s1.highScoreTable).toHaveLength(2)
    // Descending order: the existing 9000 entry keeps rank 1, ACE lands at 2.
    expect(s1.highScoreTable[0]).toMatchObject({ name: 'AAA', score: 9000 })
    expect(s1.highScoreTable[1]).toMatchObject({ name: 'ACE', score: 2500, wave: 4 })
  })

  it('builds the entry WITHOUT a date: the pure core never reads the wall clock', () => {
    const ready = typeAll(qualifyingGameOver(), ['a', 'c', 'e'])
    const s1 = (stepGame(ready, START, DT))
    expect(s1.highScoreTable[1].date).toBeUndefined()
  })

  it('preserves the final score/wave through the transition for the entry', () => {
    const ready = (typeAll(qualifyingGameOver(), ['z', 'z', 'z']))
    const s1 = (stepGame(ready, START, DT))
    const inserted = s1.highScoreTable.find((e) => e.name === 'ZZZ')
    expect(inserted).toMatchObject({ score: ready.score, wave: ready.wave })
  })

  it('does not mutate the caller state on confirm (no in-place table push)', () => {
    const ready = typeAll(qualifyingGameOver(), ['a', 'c', 'e'])
    const snapshot = structuredClone(ready)
    stepGame(ready, START, DT)
    expect(ready).toEqual(snapshot)
  })
})

// ---- edge-triggered start ------------------------------------------------------

describe('stepGame — start is edge-triggered across transitions', () => {
  it('a press held across confirm does NOT immediately start a new game', () => {
    const ready = typeAll(qualifyingGameOver(), ['a', 'c', 'e'])
    let s = stepGame(ready, START, DT) // confirm -> attract (press consumed)
    expect(s.mode).toBe('attract')
    s = stepGame(s, START, DT) // STILL held — must not read as a new press
    expect(s.mode).toBe('attract')
    s = stepGame(s, NO_INPUT, DT) // released…
    s = stepGame(s, START, DT) // …then a fresh press
    expect(s.mode).toBe('playing')
  })
})

// ---- full-cycle determinism ----------------------------------------------------

describe('mode machine — full-cycle determinism (AC: deep-equal replay)', () => {
  it('an identical script of steps and initials events replays to a deep-equal state', () => {
    const runCycle = (): GameState => {
      let s: GameState = qualifyingGameOver(77)
      s = stepGame(s, NO_INPUT, DT)
      s = enterInitial(s, 'a')
      s = stepGame(s, NO_INPUT, DT)
      s = enterInitial(s, 'c')
      s = enterInitial(s, 'e')
      s = stepGame(s, START, DT) // confirm -> attract
      s = stepGame(s, NO_INPUT, DT) // release
      s = stepGame(s, START, DT) // fresh press -> playing
      for (let i = 0; i < 30; i++) s = stepGame(s, NO_INPUT, DT)
      return s
    }
    expect(runCycle()).toEqual(runCycle())
  })
})
