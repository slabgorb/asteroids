// tests/modes.test.ts
//
// RED-phase suite for Story A-16, Part C: the mode machine inside stepGame —
// attract as a live rocks-drift backdrop, attract -> playing on a start press,
// playing -> gameover when the ship is destroyed with no lives remaining, and
// gameover -> attract on the non-qualifying display-timer path. (The qualifying
// initials-entry path and the STARTING_LIVES constant live in
// tests/framing.test.ts, which imports A-16 exports that don't exist pre-GREEN
// and so REDs as a module-load failure; THIS file imports only pre-A-16 symbols
// so each behaviour below fails individually and legibly.)
//
// Contract pinned here (context-story-A-16.md, Technical Approach + ACs):
//  - GameState grows `gameOver: { qualifies; initials; confirmed; displayTimer }
//    | null` (null outside 'gameover' — A-2's Mode union is NOT extended) and
//    `highScoreTable: HighScoreEntry[]` (loaded by the shell at boot; [] default).
//  - 'attract': rocks drift via the EXISTING A-6 movement (pinned by equality
//    with updateRocks, not golden values); ship/bullets/score/lives are inert
//    regardless of held gameplay inputs; input.start begins a fresh game using
//    initialState's field defaults WITHOUT re-seeding the rng.
//  - 'gameover' entry (A-16's stub of the A-15 seam, see session Design
//    Deviations): a ship destroyed during play with no lives remaining flips
//    mode to 'gameover' in the SAME step and initialises `gameOver` with
//    qualifies = qualifiesForHighScore(highScoreTable, score) semantics.
//  - 'gameover', non-qualifying: displayTimer counts down by dt; on reaching
//    zero the state returns to 'attract' with gameOver cleared to null and
//    initials never touched.
//
// The local Framed* intersection types mirror the target contract so this file
// typechecks both pre-GREEN (fields absent from GameState) and post-GREEN
// (fields present — any drift between these locals and the real declarations
// then fails tsc, which is exactly the alarm we want).

import { describe, it, expect } from 'vitest'
import { stepGame } from '../src/core/sim'
import { initialState, WORLD_W, WORLD_H, type GameState, type Ship } from '../src/core/state'
import { NO_INPUT, type Input } from '../src/core/input'
import { spawnRocks, updateRocks } from '../src/core/rocks'
import { createRng, nextFloat } from '../src/core/rng'
import type { Bounds } from '../src/core/bounds'

const DT = 1 / 60
const BOUNDS: Bounds = { width: WORLD_W, height: WORLD_H }

// ---- A-16 contract shims (mirror the target declarations; see header) -------

type GameOverPhase = {
  qualifies: boolean
  initials: string
  confirmed: boolean
  displayTimer: number
}
type Entry = { name: string; score: number; wave: number; date?: string }
type FramedState = GameState & { gameOver: GameOverPhase | null; highScoreTable: Entry[] }
type FramedInput = Input & { start: boolean }

const framed = (s: GameState): FramedState => s as FramedState

const START: FramedInput = { ...NO_INPUT, start: true }
// Every gameplay control held at once — attract must ignore ALL of them.
const MASHED: FramedInput = {
  left: true,
  right: true,
  thrust: true,
  fire: true,
  hyperspace: true,
  start: false,
}

/** An attract-mode field with drifting rocks and a deliberately ADVANCED rng
 * (two draws off the boot seed), so "the stream continues" is distinguishable
 * from "the rng was re-seeded to the boot value". */
function attractWithRocks(seed = 42): FramedState {
  const rockRng = createRng(seed + 1000) // rock spawns draw from their own rng
  const rng = createRng(seed)
  nextFloat(rng)
  nextFloat(rng)
  return {
    ...initialState(seed),
    rng: { seed: rng.seed },
    rocks: spawnRocks(rockRng, 3, 'large', BOUNDS),
    gameOver: null,
    highScoreTable: [],
  }
}

/** A mid-game 'playing' state: some score, a live ship, no rocks/bullets. */
function playingState(seed = 7): FramedState {
  return {
    ...initialState(seed),
    mode: 'playing',
    score: 300,
    lives: 2,
    wave: 3,
    gameOver: null,
    highScoreTable: [],
  }
}

/** A 'playing' state one tick from death: 1 life, a stationary rock parked on
 * the ship. The next step latches shipDestroyed and must enter 'gameover'. */
function aboutToDie(score: number, table: Entry[] = [], seed = 11): FramedState {
  const s = initialState(seed)
  return {
    ...s,
    mode: 'playing',
    score,
    lives: 1,
    wave: 2,
    rocks: [{ pos: { ...s.ship.pos }, velocity: { x: 0, y: 0 }, size: 'large', shapeVariant: 0 }],
    gameOver: null,
    highScoreTable: table,
  }
}

/** A 'gameover' state on the non-qualifying display path. */
function nonQualifyingGameOver(displayTimer: number, seed = 5): FramedState {
  return {
    ...initialState(seed),
    mode: 'gameover',
    score: 0,
    lives: 0,
    shipDestroyed: true,
    gameOver: { qualifies: false, initials: '', confirmed: false, displayTimer },
    highScoreTable: [{ name: 'AAA', score: 900, wave: 1 }],
  }
}

// ---- boot shape --------------------------------------------------------------

describe('initialState — A-16 framing fields', () => {
  it('boots in attract mode with no game-over phase and an empty table', () => {
    const s = framed(initialState(1))
    expect(s.mode).toBe('attract')
    expect(s.gameOver).toBeNull()
    expect(s.highScoreTable).toEqual([])
  })
})

// ---- attract: a live backdrop, inert everything else -------------------------

describe("stepGame — 'attract' branch", () => {
  it('advances rock positions via the existing A-6 drift (no parallel mover)', () => {
    const s0 = attractWithRocks()
    const s1 = stepGame(s0, NO_INPUT, DT)
    // Reuse-pin: attract drift IS updateRocks — same wrap, same units, same
    // bounds — so the ROM drift model never forks between modes.
    expect(s1.rocks).toEqual(updateRocks(s0.rocks, DT, BOUNDS))
    // And it actually moved (guard the guard: rocks spawn with nonzero drift).
    expect(s1.rocks).not.toEqual(s0.rocks)
  })

  it('keeps drifting deterministically across many ticks (fixed seed, fixed dt)', () => {
    const run = (): GameState => {
      let s: GameState = attractWithRocks(99)
      for (let i = 0; i < 120; i++) s = stepGame(s, NO_INPUT, DT)
      return s
    }
    const a = run()
    expect(a).toEqual(run())
    // Expected drift iterates updateRocks per tick exactly as the sim does —
    // one 120*DT mega-step would diverge in accumulated float rounding.
    let expected = attractWithRocks(99).rocks
    for (let i = 0; i < 120; i++) expected = updateRocks(expected, DT, BOUNDS)
    expect(a.rocks).toEqual(expected)
  })

  it('ignores every held gameplay input: ship, bullets, score, lives all inert', () => {
    let s: GameState = attractWithRocks()
    const before = framed(s)
    for (let i = 0; i < 30; i++) s = stepGame(s, MASHED, DT)
    const after = framed(s)
    expect(after.ship).toEqual(before.ship) // no thrust, no rotation
    expect(after.bullets).toEqual([]) // fire spawns nothing without a player
    expect(after.score).toBe(before.score)
    expect(after.lives).toBe(before.lives)
    expect(after.shipDestroyed).toBe(false) // no collision path runs in attract
    expect(after.saucer).toBeNull()
    expect(after.highScoreTable).toEqual(before.highScoreTable)
  })

  it('never collides or splits: rock count is stable with a rock over the ship', () => {
    const s0 = attractWithRocks()
    // Park one rock exactly on the (inert) ship to prove collision is off.
    const parked: FramedState = {
      ...s0,
      rocks: [
        ...s0.rocks,
        { pos: { x: WORLD_W / 2, y: WORLD_H / 2 }, velocity: { x: 0, y: 0 }, size: 'large', shapeVariant: 1 },
      ],
    }
    let s: GameState = parked
    for (let i = 0; i < 10; i++) s = stepGame(s, MASHED, DT)
    expect(s.rocks).toHaveLength(parked.rocks.length)
    expect(s.shipDestroyed).toBe(false)
  })
})

// ---- attract -> playing: the start press --------------------------------------

describe("stepGame — start press ('attract' -> 'playing')", () => {
  it('transitions to playing within one tick', () => {
    const s1 = stepGame(attractWithRocks(), START, DT)
    expect(s1.mode).toBe('playing')
  })

  it('starts a fresh game from initialState field defaults', () => {
    const s1 = framed(stepGame(attractWithRocks(), START, DT))
    const fresh = initialState(1) // any seed — only the mode-independent defaults matter
    expect(s1.score).toBe(0)
    expect(s1.wave).toBe(0)
    expect(s1.lives).toBeGreaterThanOrEqual(1) // === STARTING_LIVES, pinned exactly in framing.test.ts
    expect(s1.ship).toEqual(fresh.ship) // centred, at rest, nose-up (dir 64)
    expect(s1.rocks).toEqual([]) // field cleared; the A-10 wave director owns respawn
    expect(s1.bullets).toEqual([])
    expect(s1.saucer).toBeNull()
    expect(s1.shipDestroyed).toBe(false)
    expect(s1.gameOver).toBeNull()
  })

  it('continues the SAME rng stream across the transition (no re-seed)', () => {
    const s0 = attractWithRocks(42) // rng deliberately advanced 2 draws past boot
    expect(s0.rng.seed).not.toBe(createRng(42).seed) // guard the guard
    const s1 = stepGame(s0, START, DT)
    // Attract consumes no draws, so the advanced seed passes through untouched —
    // NOT reset to the boot seed and NOT reset to the default-seed value.
    expect(s1.rng.seed).toBe(s0.rng.seed)
  })

  it('preserves the persisted high-score table across the reset', () => {
    const table: Entry[] = [{ name: 'AAA', score: 900, wave: 1 }]
    const s0: FramedState = { ...attractWithRocks(), highScoreTable: table }
    const s1 = framed(stepGame(s0, START, DT))
    expect(s1.highScoreTable).toEqual(table)
  })

  it('does NOT reset a game in progress (start is inert while playing)', () => {
    const s0 = playingState()
    const s1 = framed(stepGame(s0, START, DT))
    expect(s1.mode).toBe('playing')
    expect(s1.score).toBe(300) // no fresh-game wipe mid-run
    expect(s1.lives).toBe(2)
    expect(s1.wave).toBe(3)
  })
})

// ---- playing -> gameover: the A-16 stub of the A-15 death seam ----------------

describe("stepGame — 'gameover' entry (ship destroyed, no lives remaining)", () => {
  it('enters gameover in the same step the last ship is destroyed', () => {
    const s1 = framed(stepGame(aboutToDie(500), NO_INPUT, DT))
    expect(s1.shipDestroyed).toBe(true)
    expect(s1.lives).toBe(0)
    expect(s1.mode).toBe('gameover')
  })

  it('initialises the gameOver phase: no initials, unconfirmed, timer armed', () => {
    const over = framed(stepGame(aboutToDie(500), NO_INPUT, DT)).gameOver
    expect(over).not.toBeNull()
    expect(over).toMatchObject({ initials: '', confirmed: false })
    expect((over as GameOverPhase).displayTimer).toBeGreaterThan(0)
  })

  it('computes qualifies=true for a positive score with room on the board', () => {
    const over = framed(stepGame(aboutToDie(500, []), NO_INPUT, DT)).gameOver
    expect(over?.qualifies).toBe(true)
  })

  it('computes qualifies=false for a 0 score (a scoreless run never charts)', () => {
    const over = framed(stepGame(aboutToDie(0, []), NO_INPUT, DT)).gameOver
    expect(over?.qualifies).toBe(false)
  })

  it('computes qualifies=false when a full board is not strictly beaten', () => {
    const fullBoard: Entry[] = Array.from({ length: 10 }, (_, i) => ({
      name: `E${i}`,
      score: (10 - i) * 1000, // lowest = 1000
      wave: 1,
    }))
    const over = framed(stepGame(aboutToDie(1000, fullBoard), NO_INPUT, DT)).gameOver
    expect(over?.qualifies).toBe(false) // ties the 10th — strict boundary
  })
})

// ---- gameover -> attract: the non-qualifying display path ---------------------

describe("stepGame — 'gameover' non-qualifying countdown", () => {
  it('ticks displayTimer down by dt', () => {
    const s0 = nonQualifyingGameOver(2.5 * DT)
    const s1 = framed(stepGame(s0, NO_INPUT, DT))
    expect(s1.mode).toBe('gameover')
    expect(s1.gameOver?.displayTimer).toBeCloseTo(1.5 * DT, 10)
  })

  it('returns to attract when the timer runs out, clearing the phase', () => {
    let s: GameState = nonQualifyingGameOver(2.5 * DT)
    s = stepGame(s, NO_INPUT, DT) // 1.5 dt
    s = stepGame(s, NO_INPUT, DT) // 0.5 dt
    expect(s.mode).toBe('gameover')
    s = stepGame(s, NO_INPUT, DT) // expired
    expect(s.mode).toBe('attract')
    expect(framed(s).gameOver).toBeNull()
  })

  it('never touches initials and never inserts into the table', () => {
    let s: GameState = nonQualifyingGameOver(2.5 * DT)
    for (let i = 0; i < 5; i++) {
      const f = framed(s)
      if (f.gameOver !== null) expect(f.gameOver.initials).toBe('')
      s = stepGame(s, NO_INPUT, DT)
    }
    expect(s.mode).toBe('attract')
    expect(framed(s).highScoreTable).toEqual([{ name: 'AAA', score: 900, wave: 1 }])
  })

  it('does not mutate the caller state while in gameover (purity holds off the happy path)', () => {
    const s0 = nonQualifyingGameOver(2.5 * DT)
    const snapshot = structuredClone(s0)
    stepGame(s0, NO_INPUT, DT)
    expect(s0).toEqual(snapshot)
  })
})
