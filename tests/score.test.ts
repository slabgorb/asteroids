// tests/score.test.ts
//
// A-9: scoring + extra-life integration inside stepGame, plus the BCD display
// helper. A-8 wired bullet-vs-rock destruction (splitRock) into the sim but
// awarded no points; A-9 is the first consumer of destruction *events* for
// scoring. The contract, pinned here RED-first:
//
//   * Each rock a bullet destroys awards points by the destroyed rock's tier:
//     large = 20, medium = 50, small = 100 (the faithful 1979 Asteroids values).
//     A large rock scores its OWN tier (20) — its medium children are only
//     scored if they are themselves shot.
//   * The running score rolls over modulo 100000 (max reachable 99990 — the
//     famous Asteroids rollover). score := (score + award) % 100000.
//   * A bonus ship is awarded on every 10000-point boundary crossed, and the
//     award keeps coming after rollover (one ship per 10000 points earned,
//     forever). Landing on OR jumping over a boundary both award.
//   * Scoring is pure arithmetic — it draws NO rng and is deterministic under
//     the (state, input, dt) contract.
//   * Only bullet destructions score. Ramming a rock (ship death) destroys no
//     rock, so it scores nothing. Attract / gameover modes never score (the
//     collision loop is gated to 'playing').
//
// Two carry-forward decisions from A-8's Delivery Findings are settled here as
// TEA design decisions (see session Design Deviations):
//   1. Same-frame chain-split: if a second bullet in one step hits a child
//      spawned by the first bullet, that child is a REAL destruction and is
//      scored by its own tier. No single rock is ever counted twice — the loop
//      removes each rock as it is hit — so "scoring per split" is correct, not a
//      double-count. Pinned by the co-located two-bullet test below.
//   2. One bullet, one rock: A-8's "a shot destroys at most one rock" means each
//      bullet contributes exactly one tier-valued award. Pinned by the
//      two-separate-rocks test (two bullets → two distinct awards).
//
// House conventions mirror collision.test.ts: entities are explicit literals
// with zero velocity (a single step is motion-free, isolating the award from
// step-order), fixtures spread over initialState via a `playing` helper, and
// starting score/lives are injected through the same override seam.
//
// RED until src/core/score.ts exists (SCORE_VALUES + formatScore) and sim.ts
// awards points + bonus ships on destruction.

import { describe, it, expect } from 'vitest'
import { stepGame } from '../src/core/sim'
import {
  initialState,
  type GameState,
  type Rock,
  type RockSize,
  type Bullet,
  type Vec2,
} from '../src/core/state'
import { NO_INPUT } from '../src/core/input'
import { SCORE_VALUES, formatScore } from '../src/core/score'

const DT = 1 / 60

// Interior points well clear of the default ship spawn ({4096, 3072}) so rock
// fixtures never trip an unintended ship-vs-rock collision (same rationale as
// collision.test.ts). CENTER and FAR are far enough apart to hold two
// independent bullet/rock pairs in one frame.
const CENTER: Vec2 = { x: 2000, y: 2000 }
const FAR: Vec2 = { x: 6000, y: 5000 }

/** A motionless rock at `pos` (zero drift → position stable across a step). */
function rockAt(pos: Vec2, size: RockSize, over: Partial<Rock> = {}): Rock {
  return { pos: { ...pos }, velocity: { x: 0, y: 0 }, size, shapeVariant: 0, ...over }
}

/** A motionless, long-lived bullet at `pos` (only a collision should remove it). */
function bulletAt(pos: Vec2, over: Partial<Bullet> = {}): Bullet {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, life: 60, owner: 'player', ...over }
}

/** A `playing`-mode state (scoring only happens during play) seeded and overlaid
 * with the entities / starting score / starting lives under test. */
function playing(seed: number, over: Partial<GameState> = {}): GameState {
  return { ...initialState(seed), mode: 'playing', ...over }
}

/** One step that destroys a single rock of `size` at CENTER with a co-located
 * bullet, from an optional starting score/lives. Returns the post-step state. */
function scoreOne(size: RockSize, over: Partial<GameState> = {}): GameState {
  return stepGame(
    playing(4242, { rocks: [rockAt(CENTER, size)], bullets: [bulletAt(CENTER)], ...over }),
    NO_INPUT,
    DT,
  )
}

describe('stepGame — score awarded per destroyed rock by tier (AC-1)', () => {
  it('awards 20 for a destroyed large rock', () => {
    expect(scoreOne('large').score).toBe(SCORE_VALUES.large)
    expect(SCORE_VALUES.large).toBe(20)
  })

  it('awards 50 for a destroyed medium rock', () => {
    expect(scoreOne('medium').score).toBe(SCORE_VALUES.medium)
    expect(SCORE_VALUES.medium).toBe(50)
  })

  it('awards 100 for a destroyed small rock (and the rock despawns)', () => {
    const s1 = scoreOne('small')
    expect(s1.score).toBe(SCORE_VALUES.small)
    expect(SCORE_VALUES.small).toBe(100)
    expect(s1.rocks).toHaveLength(0) // small → gone, but still scored
  })

  it('scores a large by its OWN tier (20), not the value of its two children', () => {
    const s1 = scoreOne('large')
    // A large splits into two mediums; if scoring leaked to children it would be
    // 20 + 2*50 = 120. The award is the destroyed rock's tier only.
    expect(s1.score).toBe(20)
    expect(s1.rocks).toHaveLength(2)
  })

  it('accumulates onto a pre-existing score — never resets it (AC-5)', () => {
    // Score persists across destruction events; a new award adds, not replaces.
    expect(scoreOne('small', { score: 500 }).score).toBe(500 + SCORE_VALUES.small)
  })

  it('preserves the score on a step with no destruction (no per-frame reset)', () => {
    const s1 = stepGame(playing(4242, { score: 4242, rocks: [], bullets: [] }), NO_INPUT, DT)
    expect(s1.score).toBe(4242)
  })

  it('scores NOTHING when the ship rams a rock (ram destroys no rock)', () => {
    const ship = { pos: { ...CENTER }, vel: { x: 0, y: 0 }, dir: 64, visible: true }
    const s1 = stepGame(
      playing(4242, { ship, rocks: [rockAt(CENTER, 'large')], bullets: [], score: 700 }),
      NO_INPUT,
      DT,
    )
    expect(s1.shipDestroyed).toBe(true) // ship died...
    expect(s1.score).toBe(700) // ...but no rock was destroyed, so no points
  })

  it('scores NOTHING in attract mode (collision loop is gated to playing)', () => {
    const s0: GameState = {
      ...initialState(4242),
      mode: 'attract',
      score: 500,
      rocks: [rockAt(CENTER, 'large')],
      bullets: [bulletAt(CENTER)],
    }
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.score).toBe(500)
    expect(s1.rocks).toHaveLength(1) // rock not destroyed in attract
  })

  it('scores NOTHING in gameover mode (collision loop is gated to playing)', () => {
    const s0: GameState = {
      ...initialState(4242),
      mode: 'gameover',
      score: 500,
      rocks: [rockAt(CENTER, 'large')],
      bullets: [bulletAt(CENTER)],
    }
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.score).toBe(500)
    expect(s1.rocks).toHaveLength(1)
  })
})

describe('SCORE_VALUES — exhaustive, positive value per tier (AC-1, rule #3)', () => {
  it('maps every rock tier to its faithful arcade value', () => {
    expect(SCORE_VALUES).toEqual({ large: 20, medium: 50, small: 100 })
  })

  it('defines a positive integer award for every RockSize (no missing tier)', () => {
    // Enforces exhaustive Record<RockSize, number> — a missing tier would surface
    // here as an undefined value, catching a non-exhaustive table.
    const tiers: RockSize[] = ['large', 'medium', 'small']
    for (const tier of tiers) {
      expect(Number.isInteger(SCORE_VALUES[tier])).toBe(true)
      expect(SCORE_VALUES[tier]).toBeGreaterThan(0)
    }
  })
})

describe('stepGame — every destruction in one frame scores (AC-1; A-8 multi-bullet)', () => {
  it('two bullets destroying two separate rocks award both tiers', () => {
    // One bullet, one rock: two bullets → two distinct awards (large + small).
    const s1 = stepGame(
      playing(4242, {
        rocks: [rockAt(CENTER, 'large'), rockAt(FAR, 'small')],
        bullets: [bulletAt(CENTER), bulletAt(FAR)],
      }),
      NO_INPUT,
      DT,
    )
    expect(s1.score).toBe(SCORE_VALUES.large + SCORE_VALUES.small) // 20 + 100
    expect(s1.bullets).toHaveLength(0)
    // large → 2 medium; small → gone → 2 rocks remain
    expect(s1.rocks).toHaveLength(2)
  })

  it('same-frame chain-split scores each real destruction, never one rock twice', () => {
    // Two co-located bullets on ONE large rock: bullet 1 destroys the large
    // (+20) and spawns two mediums AT the same point; bullet 2 then destroys one
    // of those mediums (+50). Two REAL destructions of two DIFFERENT rocks →
    // 70 total. This settles A-8's carry-forward: "scoring per split" is correct
    // and is not a double-count (each rock is removed as it is hit).
    const s1 = stepGame(
      playing(4242, {
        rocks: [rockAt(CENTER, 'large')],
        bullets: [bulletAt(CENTER), bulletAt(CENTER)],
      }),
      NO_INPUT,
      DT,
    )
    expect(s1.score).toBe(SCORE_VALUES.large + SCORE_VALUES.medium) // 20 + 50
    expect(s1.bullets).toHaveLength(0)
    // large → 2 med; one med → 2 small ⇒ 2 small + 1 med = 3 rocks
    expect(s1.rocks).toHaveLength(3)
  })
})

describe('stepGame — score rolls over modulo 100000 (AC-3)', () => {
  it('wraps past 99990 back toward zero: 99950 + 100 → 50', () => {
    expect(scoreOne('small', { score: 99950 }).score).toBe(50) // (99950+100) % 100000
  })

  it('lands exactly on the rollover: 99900 + 100 → 0', () => {
    expect(scoreOne('small', { score: 99900 }).score).toBe(0) // 100000 % 100000
  })

  it('does NOT wrap when the award stays below 100000: 99800 + 100 → 99900', () => {
    expect(scoreOne('small', { score: 99800 }).score).toBe(99900)
  })
})

describe('stepGame — bonus ship every 10000 points (AC-4)', () => {
  it('awards a ship when the score reaches exactly 10000', () => {
    const s1 = scoreOne('small', { score: 9900, lives: 2 }) // 9900 + 100 = 10000
    expect(s1.score).toBe(10000)
    expect(s1.lives).toBe(3)
  })

  it('awards a ship when an award JUMPS OVER a 10000 boundary', () => {
    const s1 = scoreOne('small', { score: 9950, lives: 2 }) // 9950 + 100 = 10050
    expect(s1.score).toBe(10050)
    expect(s1.lives).toBe(3)
  })

  it('awards NO ship when the award stays within a 10000 band', () => {
    const s1 = scoreOne('small', { score: 200, lives: 2 }) // 200 + 100 = 300
    expect(s1.lives).toBe(2)
  })

  it('keeps awarding ships past the rollover (crossing the 100000 boundary)', () => {
    // 99950 + 100 = 100050 → score wraps to 50, but a 10000 boundary (100000)
    // was crossed, so a bonus ship is still earned. One ship per 10000 earned.
    const s1 = scoreOne('small', { score: 99950, lives: 4 })
    expect(s1.score).toBe(50)
    expect(s1.lives).toBe(5)
  })

  it('awards NO ship on a destruction that neither crosses a boundary nor scores much', () => {
    const s1 = scoreOne('large', { score: 100, lives: 3 }) // 100 + 20 = 120
    expect(s1.score).toBe(120)
    expect(s1.lives).toBe(3)
  })
})

describe('stepGame — deterministic score & extra-life progression (AC-6)', () => {
  it('same seed + same collision → identical score, lives, and state', () => {
    // Scenario both scores AND awards a bonus ship AND splits a rock (rng draw),
    // so this pins scoring, extra-life, and seed-stream determinism together.
    const scenario = (): GameState =>
      stepGame(
        playing(777, {
          rocks: [rockAt(CENTER, 'large')],
          bullets: [bulletAt(CENTER)],
          score: 9990,
          lives: 3,
        }),
        NO_INPUT,
        DT,
      )
    const a = scenario()
    const b = scenario()
    expect(a).toEqual(b) // full replay determinism
    // Non-vacuous concrete pins: 9990 + 20 = 10010 crosses 10000 → +1 ship.
    expect(a.score).toBe(10010)
    expect(a.lives).toBe(4)
  })
})

describe('formatScore — 6-digit zero-padded BCD display string (AC-2)', () => {
  it('formats zero as six zeros', () => {
    expect(formatScore(0)).toBe('000000')
  })

  it('zero-pads small scores', () => {
    expect(formatScore(20)).toBe('000020')
    expect(formatScore(70)).toBe('000070')
  })

  it('formats a five-figure and near-rollover score', () => {
    expect(formatScore(10000)).toBe('010000')
    expect(formatScore(99990)).toBe('099990')
  })

  it('renders the AC example progression 0 → 20 → 70', () => {
    expect([0, 20, 70].map(formatScore)).toEqual(['000000', '000020', '000070'])
  })
})
