// tests/saucer-small.test.ts
//
// A-12: the SMALL SAUCER — the second saucer variant. It reuses A-11's spawn
// director, crossing/zigzag movement, fire cadence, bullet cap, and lifecycle
// VERBATIM (all still pinned by tests/saucer.test.ts); A-12 changes only three
// observable things:
//
//   1. Saucer gains a `size: 'large' | 'small'` discriminant, chosen by the
//      spawn director. A-11's director was large-only ("A-12 owns the type
//      selection entirely" — A-11 context, Scope).
//   2. The SMALL saucer AIMS its shots at the ship (the large saucer keeps
//      firing at random headings — the A-11 differentiator, preserved here as a
//      regression guard). A-11's Dev note: "aimed fire swaps the random-heading
//      draw in fireShot for an aimed one."
//   3. The small saucer's aim ACCURACY RAMPS with the score, reaching dead-on
//      (zero error) once the score reaches 35000 points (the story title).
//
// PROVISIONALITY. There is no Architect research pass for A-12 (its story
// context is a title-only stub; contrast A-11/A-13, which were Architect-
// enriched). These tests therefore pin the BEHAVIOURAL CONTRACT the title
// mandates — aimed cone toward the ship, monotonic accuracy ramp, dead-on at
// 35000 — using NAMED, ISOLATED constants, exactly as A-11 did for its ROM
// magnitudes. Only SAUCER_AIM_PERFECT_SCORE (35000) is pinned to an exact value,
// because it IS the story's spec; every other magnitude (the score-0 aim cone
// half-width, the small-saucer spawn floor) is asserted by STRUCTURE only and
// carries a `verify vs ROM quarry (A-17)` note. See the TEA Delivery Findings.
//
// Test design mirrors tests/saucer.test.ts:
//   * Spawn-SELECTION is observed through the real updateSpawnDirector (no
//     saucer is hand-built for those tests — the director produces it).
//   * Aimed-FIRE is probed by driving stepSaucer directly on a state that
//     already holds a small saucer whose fireTimer is due (the same controlled-
//     state technique A-11 used for its cap test), so the fired bullet's heading
//     is a clean function of (saucer pos, ship pos, score) with no crossing/
//     cadence noise. The saucer is given zero velocity so its fire origin is
//     exactly its position (no pre-fire move), and a fresh course timer so no
//     zigzag reroll perturbs the single rng draw the aim consumes.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  initialState,
  WORLD_W,
  WORLD_H,
  type GameState,
  type Saucer,
  type SaucerSize,
  type Bullet,
  type Vec2,
} from '../src/core/state'
import {
  updateSpawnDirector,
  stepSaucer,
  SAUCER_SPEED,
  SAUCER_FIRE_INTERVAL,
  SAUCER_COURSE_CHANGE_INTERVAL,
  SAUCER_SPAWN_TIMER_INITIAL,
  // A-12 — provisional; verify vs ROM quarry in A-17 (except the perfect-aim
  // score, which is the story spec). These do not exist yet → RED (the suite
  // fails to resolve them until Dev adds them in GREEN).
  SAUCER_AIM_PERFECT_SCORE,
  SAUCER_AIM_ERROR_MAX,
  SAUCER_SMALL_MIN_SCORE,
} from '../src/core/saucer'
import { stepGame } from '../src/core/sim'
import { NO_INPUT } from '../src/core/input'

const DT = 1 / 60

/** A playing-mode state (attract → playing) with optional field overrides. */
function playing(seed: number, over: Partial<GameState> = {}): GameState {
  return { ...initialState(seed), mode: 'playing', ...over }
}

/** Narrow `state.saucer` to a non-null Saucer without a `!` assertion (the TS
 * review checklist bans non-null assertions on runtime-nullable values). */
function requireSaucer(s: GameState): Saucer {
  const sc = s.saucer
  if (sc === null) throw new Error('expected a live saucer, got null')
  return sc
}

/** Ticks to run a spawn director before giving up — a few full initial cadences,
 * so an arm-on-first-tick or a pre-armed timer both land a spawn in the window. */
const spawnWindow = (): number => Math.ceil(SAUCER_SPAWN_TIMER_INITIAL / DT) * 3 + 20

/** Run the spawn director on a fresh playing field (optionally at a given score)
 * until it lands a live saucer, then return that saucer. Throws if none spawns in
 * the window — loud in RED, exactly what we want. The score override is what
 * drives A-12's size selection. */
function spawnSaucerAt(seed: number, over: Partial<GameState> = {}): Saucer {
  let s = playing(seed, over)
  for (let i = 0; i < spawnWindow(); i++) {
    s = updateSpawnDirector(s, DT)
    if (s.saucer !== null) return requireSaucer(s)
  }
  throw new Error(`no saucer spawned within the window (seed ${seed})`)
}

/** Shortest unsigned angular distance between two headings, in [0, π]. */
function angDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI)
  return d > Math.PI ? 2 * Math.PI - d : d
}

const heading = (b: Bullet): number => Math.atan2(b.vel.y, b.vel.x)
const bearing = (from: Vec2, to: Vec2): number => Math.atan2(to.y - from.y, to.x - from.x)

// A reusable, real (director-produced) saucer, used ONLY for its valid shape
// when hand-building controlled fire states below (its size/pos/velocity/timers
// are all overridden). Reusing a real saucer keeps these fixtures forward-
// compatible if Saucer grows more fields later (the A-11 cap-test technique).
const BASE_SAUCER: Saucer = spawnSaucerAt(1979)

/** Fire exactly one saucer shot from a controlled state and return it.
 *
 * Builds a playing state whose saucer sits at `saucerPos` with ZERO velocity
 * (so stepSaucer's pre-fire integration does not move it — the shot originates
 * exactly at `saucerPos`), a fresh course timer (so no zigzag reroll steals the
 * rng draw), and a DUE fire timer (so it fires this very tick). The ship sits at
 * `shipPos` and the run is at `score`. One stepSaucer tick → one new saucer
 * bullet, whose heading is the thing under test. */
function fireSaucerShot(opts: {
  size: 'large' | 'small'
  score: number
  saucerPos: Vec2
  shipPos: Vec2
  seed: number
}): Bullet {
  const st = initialState(opts.seed)
  const state: GameState = {
    ...st,
    mode: 'playing',
    score: opts.score,
    ship: { ...st.ship, pos: { ...opts.shipPos } },
    saucer: {
      ...BASE_SAUCER,
      pos: { ...opts.saucerPos },
      velocity: { x: 0, y: 0 }, // no pre-fire move → fire origin === saucerPos
      courseTimer: SAUCER_COURSE_CHANGE_INTERVAL, // will not reroll this tick
      fireTimer: 0, // due → fires this tick
      size: opts.size,
    },
    bullets: [], // empty → below the cap, the due shot fires
  }
  const shots = stepSaucer(state, DT).bullets.filter((b) => b.owner === 'saucer')
  if (shots.length !== 1) throw new Error(`expected exactly one saucer shot, got ${shots.length}`)
  return shots[0]
}

// Fixed, mid-field geometry for the aim tests: both entities sit far from every
// wrap seam and the ship is offset from the saucer by a clear, non-axis-aligned
// vector, so the true bearing is unambiguous and the toroidal wrap never enters.
const AIM_SAUCER: Vec2 = { x: WORLD_W / 2, y: WORLD_H / 2 }
const AIM_SHIP: Vec2 = { x: WORLD_W / 2 + 1500, y: WORLD_H / 2 + 800 }
const AIM_BEARING = bearing(AIM_SAUCER, AIM_SHIP)

/** 60 varied, deterministic seeds (no Math.random — banned in core, avoided here
 * too so the suite is reproducible). Coprime-ish stride spreads the first rng
 * draw, which is the aim-error sample. */
const SEEDS: number[] = Array.from({ length: 60 }, (_, i) => 1009 + i * 97)

/** Worst-case (max over seeds) angular error of a SMALL saucer's aimed shot,
 * relative to the true bearing, at a given score. 0 = perfectly aimed. */
function aimConeWidth(score: number): number {
  let mx = 0
  for (const seed of SEEDS) {
    const b = fireSaucerShot({ size: 'small', score, saucerPos: AIM_SAUCER, shipPos: AIM_SHIP, seed })
    mx = Math.max(mx, angDiff(heading(b), AIM_BEARING))
  }
  return mx
}

// ---------------------------------------------------------------------------
// Constants — the story spec (35000) is exact; the rest are provisional and
// pinned by STRUCTURE only. verify vs ROM quarry in A-17.
// ---------------------------------------------------------------------------

describe('small saucer constants (A-12 — story spec + provisional, verify vs ROM quarry A-17)', () => {
  it('pins the dead-on-accuracy score to the story spec of 35000 points', () => {
    // This is NOT a provisional ROM byte — it is the number in the story title.
    // (A-17 may still confirm the exact ROM threshold; if it differs that is a
    // spec change, tracked as a Delivery Finding, not a silent constant tweak.)
    expect(SAUCER_AIM_PERFECT_SCORE).toBe(35000)
  })

  it('gives the score-0 aim a real but bounded error cone (aimed, not random)', () => {
    // > 0 so the ramp has somewhere to start (an already-perfect start would make
    // the ramp vacuous); < π/2 so the worst early shot is still within a quarter
    // turn of the ship — genuinely "aimed", unlike the large saucer's full-circle
    // spray. Exact magnitude is provisional. verify vs quarry (A-17).
    expect(SAUCER_AIM_ERROR_MAX).toBeGreaterThan(0)
    expect(SAUCER_AIM_ERROR_MAX).toBeLessThan(Math.PI / 2)
  })

  it('lets small saucers appear below the perfect-aim score (so the ramp has a live domain)', () => {
    // The small saucer must exist at scores where its aim is still ramping,
    // otherwise "accuracy ramp" is unobservable in play. So its spawn floor sits
    // strictly between 0 (large-only start) and the dead-on score. Provisional
    // magnitude — verify vs quarry (A-17).
    expect(SAUCER_SMALL_MIN_SCORE).toBeGreaterThan(0)
    expect(SAUCER_SMALL_MIN_SCORE).toBeLessThan(SAUCER_AIM_PERFECT_SCORE)
  })
})

// ---------------------------------------------------------------------------
// Saucer.size discriminant + score-driven spawn selection (AC).
// ---------------------------------------------------------------------------

describe('Saucer.size discriminant & score-driven spawn selection (AC)', () => {
  it('tags every spawned saucer with a size drawn from the {large, small} union', () => {
    const sc = spawnSaucerAt(1979)
    expect(sc.size === 'large' || sc.size === 'small').toBe(true)
  })

  it('spawns ONLY large saucers at score 0 (A-11 stays large-only; keeps its random-fire suite valid)', () => {
    // A-11's whole suite spawns at score 0 and asserts random (non-aimed) fire.
    // If a small saucer could spawn at score 0 it would aim and flip those tests
    // red, so score 0 MUST remain large-only. Many seeds, all large.
    const sizes = new Set<string>()
    for (const seed of [1979, 2024, 4242, 777, 31337, 90210, 5, 8675309, 12, 65535, 101, 2600]) {
      sizes.add(spawnSaucerAt(seed, { score: 0 }).size)
    }
    expect([...sizes]).toEqual(['large']) // exclusively large — no 'small', no undefined
  })

  it('DOES spawn small saucers once the score is high (the variant actually appears)', () => {
    // Well above SAUCER_SMALL_MIN_SCORE: the director must be able to pick 'small'.
    // A schedule that never produces a small saucer would make the whole story
    // unreachable in play — this catches that.
    const highScore = SAUCER_AIM_PERFECT_SCORE * 3
    const sizes = new Set<string>()
    for (const seed of [1979, 2024, 4242, 777, 31337, 90210, 5, 8675309, 12, 65535, 101, 2600, 314, 2718]) {
      sizes.add(spawnSaucerAt(seed, { score: highScore }).size)
    }
    expect(sizes.has('small')).toBe(true)
  })

  it('fixes a saucer size at spawn — it never changes while alive, for BOTH variants', () => {
    // Drive a real director-spawned saucer across most of its crossing and assert its
    // size is invariant tick to tick. Run it for a large saucer (score 0) AND a small
    // saucer (score above the small-only ceiling) so the `size: saucer.size` carry in
    // stepSaucer is exercised on both branches — a small-only regression that dropped or
    // re-rolled the field would otherwise hide (the score-0-only version never spawned
    // a small saucer to catch it).
    const assertStableFor = (score: number, expected: SaucerSize): void => {
      let s = playing(1979, { score })
      for (let i = 0; i < spawnWindow(); i++) {
        s = updateSpawnDirector(s, DT)
        if (s.saucer !== null) break
      }
      const size0 = requireSaucer(s).size
      expect(size0).toBe(expected) // this score really produced the variant under test
      let stepped = 0
      for (let i = 0; i < Math.ceil(WORLD_W / SAUCER_SPEED) + 50; i++) {
        s = stepGame(s, NO_INPUT, DT)
        if (s.saucer === null) break
        expect(requireSaucer(s).size).toBe(size0) // stable identity, never re-rolled or dropped
        stepped++
      }
      expect(stepped).toBeGreaterThan(0) // the carry-through was actually exercised (non-vacuous)
    }

    assertStableFor(0, 'large') // large branch
    assertStableFor(SAUCER_AIM_PERFECT_SCORE * 3, 'small') // small branch (score ≥ small-only → always small)
  })

  it('selects size deterministically from the seed at a MID-RAMP score (rng-decided, not a probability-1 tautology)', () => {
    // The score MUST sit strictly inside the ramp (SAUCER_SMALL_MIN_SCORE < score <
    // the small-only ceiling) so `smallProbability ∈ (0,1)` and the variant genuinely
    // depends on the seeded rng draw. A score at/above the small-only ceiling would make
    // pickSize return 'small' unconditionally, so "same seed → same variant" would hold
    // for ANY source (even Math.random) — a vacuous tautology. `SAUCER_SMALL_MIN_SCORE *
    // 2` (= 20000) is comfortably mid-ramp; the `sizes.size === 2` guard below fails loudly
    // if that ever stops being true.
    const midScore = SAUCER_SMALL_MIN_SCORE * 2
    const sizes = new Set<SaucerSize>()
    for (const seed of SEEDS) {
      const a = spawnSaucerAt(seed, { score: midScore }).size
      const b = spawnSaucerAt(seed, { score: midScore }).size
      expect(a === 'large' || a === 'small').toBe(true) // a real variant, not undefined
      expect(b).toBe(a) // identical seed + score → identical variant (determinism)
      sizes.add(a)
    }
    // Non-vacuity: at a mid-ramp score the variant IS rng-decided, so both occur across
    // the seed set. This makes the determinism check above binding — a non-seeded source
    // (Math.random) would make same-seed spawns disagree and fail `b === a`; a constant
    // (probability-1) score would collapse this set to one element and fail here.
    expect(sizes.size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Aimed fire — the small saucer shoots AT the ship (AC). Contrast the large
// saucer, which sprays randomly (its own A-11 test, re-guarded below).
// ---------------------------------------------------------------------------

describe('small saucer — aimed fire toward the ship (AC)', () => {
  it('fires DEAD-ON at the ship once the score reaches 35000 (zero error, every seed)', () => {
    // At/above the perfect-aim score the heading equals the exact bearing to the
    // ship, independent of the rng seed — the defining behaviour of the ramp's
    // top. Several seeds + a score above the threshold prove it is not seed luck.
    for (const seed of [1979, 4242, 90210, 314, 2718, 8675309]) {
      const atThreshold = fireSaucerShot({
        size: 'small',
        score: SAUCER_AIM_PERFECT_SCORE,
        saucerPos: AIM_SAUCER,
        shipPos: AIM_SHIP,
        seed,
      })
      expect(angDiff(heading(atThreshold), AIM_BEARING)).toBeLessThan(1e-9)

      const aboveThreshold = fireSaucerShot({
        size: 'small',
        score: SAUCER_AIM_PERFECT_SCORE + 25000,
        saucerPos: AIM_SAUCER,
        shipPos: AIM_SHIP,
        seed,
      })
      expect(angDiff(heading(aboveThreshold), AIM_BEARING)).toBeLessThan(1e-9)
    }
  })

  it('tracks the ship: the dead-on heading follows the ship to a new position', () => {
    const score = SAUCER_AIM_PERFECT_SCORE * 2 // firmly in the dead-on regime
    const shipA: Vec2 = { x: AIM_SAUCER.x + 2000, y: AIM_SAUCER.y - 500 }
    const shipB: Vec2 = { x: AIM_SAUCER.x - 1200, y: AIM_SAUCER.y + 1800 }

    const hA = heading(fireSaucerShot({ size: 'small', score, saucerPos: AIM_SAUCER, shipPos: shipA, seed: 1979 }))
    const hB = heading(fireSaucerShot({ size: 'small', score, saucerPos: AIM_SAUCER, shipPos: shipB, seed: 1979 }))

    expect(angDiff(hA, bearing(AIM_SAUCER, shipA))).toBeLessThan(1e-9) // aims at A
    expect(angDiff(hB, bearing(AIM_SAUCER, shipB))).toBeLessThan(1e-9) // aims at B
    expect(angDiff(hA, hB)).toBeGreaterThan(0.1) // and the two are genuinely different directions
  })

  it('keeps every sub-threshold shot inside the aim cone around the ship bearing', () => {
    // Below the dead-on score the aim scatters, but only WITHIN the bounded cone
    // (SAUCER_AIM_ERROR_MAX each side of the true bearing) — never the large
    // saucer's full-circle spray. Checked across all seeds at score 0 (the widest
    // cone). A tiny epsilon absorbs float error at the exact cone edge.
    for (const seed of SEEDS) {
      const b = fireSaucerShot({ size: 'small', score: 0, saucerPos: AIM_SAUCER, shipPos: AIM_SHIP, seed })
      expect(angDiff(heading(b), AIM_BEARING)).toBeLessThanOrEqual(SAUCER_AIM_ERROR_MAX + 1e-9)
    }
    // Non-vacuous: score 0 really does scatter (it is not already dead-on).
    expect(aimConeWidth(0)).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Accuracy ramp — the cone narrows monotonically with score, closing to dead-on
// at 35000 (AC — the story's headline behaviour).
// ---------------------------------------------------------------------------

describe('small saucer — accuracy ramp culminating at 35000 pts (AC)', () => {
  it('closes the aim cone to exactly zero at and beyond the perfect-aim score', () => {
    expect(aimConeWidth(SAUCER_AIM_PERFECT_SCORE)).toBeLessThan(1e-9) // dead-on at 35000
    expect(aimConeWidth(SAUCER_AIM_PERFECT_SCORE + 40000)).toBeLessThan(1e-9) // stays dead-on above
  })

  it('narrows the aim cone monotonically as the score climbs toward 35000', () => {
    const w0 = aimConeWidth(0)
    const wMid = aimConeWidth(Math.round(SAUCER_AIM_PERFECT_SCORE / 2))
    const wTop = aimConeWidth(SAUCER_AIM_PERFECT_SCORE)
    expect(w0).toBeGreaterThanOrEqual(wMid)
    expect(wMid).toBeGreaterThanOrEqual(wTop)
    expect(wTop).toBeLessThan(1e-9) // reaches dead-on
  })

  it('is a genuine gradual ramp, not a single switch at 35000 (accuracy improves in between)', () => {
    // A binary "random until 35000, then perfect" implementation would leave the
    // cone constant below the threshold and fail this: a lower score must aim
    // STRICTLY worse than a higher (still sub-threshold) score.
    const wLow = aimConeWidth(5000)
    const wHigh = aimConeWidth(30000)
    expect(wLow).toBeGreaterThan(wHigh)
    expect(wHigh).toBeGreaterThan(0) // still imperfect just below the threshold
  })
})

// ---------------------------------------------------------------------------
// Regression: the LARGE saucer must NOT aim — the accuracy ramp is small-only.
// ---------------------------------------------------------------------------

describe('large saucer stays random even at high score (A-11 differentiator preserved)', () => {
  it('sprays a large saucer across a wide arc, not clustered on the ship, at score > 35000', () => {
    const score = SAUCER_AIM_PERFECT_SCORE * 2
    const headings: number[] = []
    for (const seed of SEEDS) {
      const b = fireSaucerShot({ size: 'large', score, saucerPos: AIM_SAUCER, shipPos: AIM_SHIP, seed })
      headings.push(heading(b))
    }

    const distinct = [...new Set(headings.map((h) => Math.round(h * 1000) / 1000))]
    expect(distinct.length).toBeGreaterThanOrEqual(3) // many directions, not one fixed aim

    let maxSpread = 0
    for (let i = 0; i < distinct.length; i++) {
      for (let j = i + 1; j < distinct.length; j++) {
        maxSpread = Math.max(maxSpread, angDiff(distinct[i], distinct[j]))
      }
    }
    expect(maxSpread).toBeGreaterThan(Math.PI / 2) // wide spray — the ramp did not leak into 'large'

    // And it is NOT dead-on: at least one large shot misses the ship bearing by
    // far more than any aimed cone would allow.
    const worst = Math.max(...headings.map((h) => angDiff(h, AIM_BEARING)))
    expect(worst).toBeGreaterThan(SAUCER_AIM_ERROR_MAX)
  })
})

// ---------------------------------------------------------------------------
// stepGame wiring & whole-state determinism with an aiming small saucer (AC).
// ---------------------------------------------------------------------------

describe('stepGame — small saucer aimed fire wiring & determinism (AC)', () => {
  it('runs a small saucer through stepGame identically for identical seed + input (and it fires)', () => {
    // Hand-build a crossing small saucer at a high score so its aimed fire is
    // exercised through the real stepGame path, independent of the spawn
    // schedule. Two identical runs must produce deeply-equal state.
    const small: Saucer = {
      ...BASE_SAUCER,
      size: 'small',
      pos: { x: 100, y: WORLD_H / 2 },
      velocity: { x: SAUCER_SPEED, y: 0 },
      courseTimer: SAUCER_COURSE_CHANGE_INTERVAL,
      fireTimer: SAUCER_FIRE_INTERVAL,
    }
    const mk = (seed: number): GameState =>
      playing(seed, { score: SAUCER_AIM_PERFECT_SCORE + 5000, saucer: { ...small }, rocks: [] })

    let a = mk(2626)
    let b = mk(2626)
    let sawSaucerShot = false
    for (let i = 0; i < 250; i++) {
      a = stepGame(a, NO_INPUT, DT)
      b = stepGame(b, NO_INPUT, DT)
      if (a.bullets.some((bl) => bl.owner === 'saucer')) sawSaucerShot = true
    }
    expect(sawSaucerShot).toBe(true) // the small saucer actually fired (non-vacuous)
    expect(a).toEqual(b) // deterministic replay
  })
})

// ---------------------------------------------------------------------------
// Source hygiene — the A-12 changes to saucer.ts stay deterministic + type-safe
// (rule: TS review checklist #1 + epic banned-globals). core-boundary.test.ts
// scans every core/*.ts too; this pins it against the specific new fire path.
// ---------------------------------------------------------------------------

describe('core/saucer.ts source hygiene after A-12 (determinism + type safety) (rule)', () => {
  const src = (): string =>
    readFileSync(fileURLToPath(new URL('../src/core/saucer.ts', import.meta.url)), 'utf8')

  it('threads aim through state.rng only — no wall-clock or entropy globals', () => {
    const s = src()
    expect(/\bMath\s*\.\s*random\s*\(/.test(s)).toBe(false)
    expect(/\bDate\s*\.\s*now\s*\(/.test(s)).toBe(false)
    expect(/\bperformance\s*\.\s*now\s*\(/.test(s)).toBe(false)
  })

  it('uses no `as any` type-safety escape (typescript review checklist #1)', () => {
    expect(/\bas\s+any\b/.test(src())).toBe(false)
  })
})
