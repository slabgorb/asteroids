// tests/highscore.table.test.ts
//
// RED-phase suite for Story A-16 (attract/game-over/high-score framing), Part A:
// the PURE high-score TABLE helpers `qualifiesForHighScore` and `insertHighScore`,
// plus the MAX_HIGH_SCORES constant. These live in the deterministic core
// (src/core/highscore.ts) so the framing state machine can depend on them without
// importing shell/; the localStorage seam (src/shell/storage.ts) imports these
// TYPES — the dependency points shell -> core, never the reverse.
//
// This MIRRORS star-wars' tests/core/highscore.table.test.ts (the explicit
// port-near-verbatim mandate in context-story-A-16.md), itself a mirror of
// tempest's. No terminology adaptation is even needed this time: asteroids
// already calls its level counter `wave` (state.ts, A-2), the exact field
// star-wars records.
//
// src/core/highscore.ts does NOT exist pre-GREEN, so this file fails to LOAD
// (module resolution error) until Dev creates it. That import failure IS the RED
// signal for this suite; once the module ships with the two helpers + constant,
// the file loads and these behaviour assertions take over.
//
// TEA decisions pinned here (mirroring the ported suite exactly):
//  - MAX_HIGH_SCORES = 10 (arcade convention), exported from highscore.ts.
//  - Qualify, board NOT full (< 10): the score must be STRICTLY POSITIVE (> 0).
//    A score of 0 does NOT qualify, even on an empty board.
//  - Qualify, board FULL (== 10): the score must be STRICTLY GREATER than the
//    lowest entry. A score EQUAL to the 10th does NOT qualify.
//  - Tie placement on insert: a new entry sorts AFTER existing entries of equal
//    score (existing holders keep the higher rank).
//  - Truncation: after insert the table is descending and truncated to
//    MAX_HIGH_SCORES; length never exceeds 10 and the lowest overflow is dropped.
//  - insertHighScore is PURE: returns a NEW array and never mutates its inputs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { HighScoreEntry, HighScoreTable } from '../src/core/highscore'
import { qualifiesForHighScore, insertHighScore, MAX_HIGH_SCORES } from '../src/core/highscore'

const MAX = 10 // local copy so the table builders below don't couple to the constant

const entry = (name: string, score: number, wave = 1): HighScoreEntry => ({ name, score, wave })

// A descending table of `n` entries, scores n*100 .. 100 (lowest = 100).
const tableOf = (n: number): HighScoreTable =>
  Array.from({ length: n }, (_, i) => entry(`E${i}`, (n - i) * 100))

describe('MAX_HIGH_SCORES', () => {
  // The board is a 10-deep arcade ladder; the constant is the public contract
  // both the table helpers and the renderer read.
  it('is the 10-deep arcade convention', () => {
    expect(MAX_HIGH_SCORES).toBe(10)
  })
})

describe('qualifiesForHighScore — partial/empty board (fewer than 10 entries)', () => {
  it('qualifies any strictly-positive score when the table is empty', () => {
    expect(qualifiesForHighScore([], 1)).toBe(true)
    expect(qualifiesForHighScore([], 5000)).toBe(true)
  })

  // TEA decision: a 0 score never makes the board, even with empty slots.
  it('does NOT qualify a score of 0, even on an empty board', () => {
    expect(qualifiesForHighScore([], 0)).toBe(false)
  })

  // Negative is below zero — a wiped run must never claim a slot.
  it('does NOT qualify a negative score on an empty board', () => {
    expect(qualifiesForHighScore([], -10)).toBe(false)
  })

  // Room remains -> any positive score qualifies, even below every entry.
  it('qualifies a positive score below every existing entry while the table is not full', () => {
    expect(qualifiesForHighScore(tableOf(3), 50)).toBe(true) // 300/200/100, not full
  })

  it('still rejects a 0 score on a partial board', () => {
    expect(qualifiesForHighScore(tableOf(3), 0)).toBe(false)
  })
})

describe('qualifiesForHighScore — full board (exactly 10 entries)', () => {
  it('qualifies a score STRICTLY GREATER than the lowest entry', () => {
    expect(qualifiesForHighScore(tableOf(MAX), 101)).toBe(true) // lowest = 100
  })

  // TEA decision: strict boundary — equal to the 10th does NOT qualify.
  it('does NOT qualify a score EQUAL to the lowest entry', () => {
    expect(qualifiesForHighScore(tableOf(MAX), 100)).toBe(false)
  })

  it('does NOT qualify a score below the lowest entry', () => {
    expect(qualifiesForHighScore(tableOf(MAX), 99)).toBe(false)
  })
})

describe('insertHighScore — ordering, ties, truncation, purity', () => {
  it('inserts into an empty table', () => {
    const out = insertHighScore([], entry('AAA', 500))
    expect(out.map((e) => e.name)).toEqual(['AAA'])
    expect(out).toHaveLength(1)
  })

  it('keeps the table sorted descending by score after insert', () => {
    const out = insertHighScore([entry('A', 300), entry('B', 100)], entry('X', 200))
    expect(out.map((e) => e.score)).toEqual([300, 200, 100])
    expect(out.map((e) => e.name)).toEqual(['A', 'X', 'B'])
  })

  // TEA tie decision: a tied new entry sorts AFTER the equal existing one.
  it('places a tied new entry AFTER existing entries of equal score', () => {
    const out = insertHighScore(
      [entry('A', 300), entry('B', 200), entry('C', 100)],
      entry('X', 200), // ties with B
    )
    expect(out.map((e) => e.name)).toEqual(['A', 'B', 'X', 'C'])
  })

  it('truncates to MAX_HIGH_SCORES (10), dropping the overflow on a high insert', () => {
    const out = insertHighScore(tableOf(MAX), entry('TOP', 5000))
    expect(out).toHaveLength(MAX)
    expect(out[0].name).toBe('TOP')
    expect(out.map((e) => e.score)).not.toContain(100) // old lowest dropped
  })

  // A sub-board score passed to insert is dropped by truncation (must not
  // displace anyone). Mirrors the strict full-board qualify boundary.
  it('drops a new entry whose score is below a full board (no displacement)', () => {
    const t = tableOf(MAX) // lowest = 100
    const out = insertHighScore(t, entry('LOW', 50))
    expect(out).toHaveLength(MAX)
    expect(out.map((e) => e.name)).not.toContain('LOW')
    expect(out.map((e) => e.score)).toEqual(t.map((e) => e.score)) // top-10 unchanged
  })

  // Pure helper — does not mutate its inputs (lang-review #2: no surprise mutation).
  it('is pure: does not mutate the input table', () => {
    const t = [entry('A', 300), entry('B', 100)]
    const snapshot = JSON.parse(JSON.stringify(t))
    insertHighScore(t, entry('X', 200))
    expect(t).toEqual(snapshot)
    expect(t).toHaveLength(2)
  })

  // Review rework ([MEDIUM], lang-review #2): purity must live in the SIGNATURE,
  // not just behaviour — both helpers read the table without mutating it, so
  // both take `readonly HighScoreEntry[]`, mirroring saveHighScores' enforced
  // convention (tests/storage.test.ts). Two layers, because vitest (esbuild)
  // strips types while tsc does not:
  //  1. runtime/frozen — a frozen table passes through both helpers untouched;
  //  2. source-text — the declared signatures literally name `readonly`.
  it('accepts a frozen readonly table in both helpers without throwing', () => {
    const frozen: readonly HighScoreEntry[] = Object.freeze([entry('A', 300), entry('B', 100)])
    expect(() => qualifiesForHighScore(frozen, 200)).not.toThrow()
    const out = insertHighScore(frozen, entry('X', 200))
    expect(out.map((e) => e.name)).toEqual(['A', 'X', 'B'])
    expect(frozen).toEqual([entry('A', 300), entry('B', 100)])
  })

  it('declares readonly table parameters in both source signatures', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/core/highscore.ts', import.meta.url)),
      'utf8',
    )
    expect(src).toMatch(/export function qualifiesForHighScore\s*\([^)]*\breadonly\b[^)]*\)/)
    expect(src).toMatch(/export function insertHighScore\s*\([^)]*\breadonly\b[^)]*\)/)
  })

  // The recorded `wave` rides along with the entry (the HUD/board renders it).
  it('preserves the wave reached on the inserted entry', () => {
    const out = insertHighScore([], entry('ACE', 4200, 7))
    expect(out[0]).toMatchObject({ name: 'ACE', score: 4200, wave: 7 })
  })
})
