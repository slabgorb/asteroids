// tests/rocks.test.ts
//
// A-6: asteroid entities — three size tiers, a fixed shape variant, and seeded
// drift around the toroidal playfield. Entity + passive movement ONLY: splitting
// is A-7, collisions A-8, the wave director (spawn timing / 4+2-per-wave / cap 11
// / ship-safe placement) A-10, authentic ROM shape POINT DATA A-17.
//
// ⚠ Rotation is CONFIRMED ABSENT, not deferred. ROM research across two
// independent sources (computerarcheology.com + 6502disassembly.com) found no
// angle field and no angle-update routine for rocks — only the ship has ShipDir;
// rock position updates are pure velocity-accumulation ($6FCA-$7013). The story
// title says "rotation"; the ROM says the rocks never spin. AC-5 below therefore
// proves the ABSENCE (no orientation field; shapeVariant fixed after spawn),
// standing in for the phantom "rotation rate" the title implies.
//
// Units mirror ship.ts / bullet.ts: velocity is world-units per 60 Hz frame, so
// one tick's displacement is `velocity * (dt*60)` (frames = dt*60). AC-3's
// shorthand "velocity * dt" is read here as the cabinet's per-frame convention
// so rock drift shares units with ship flight and inherited bullet momentum
// (see session Design Deviations).
//
// Provisional constants (named + isolated so A-17 is a data-only swap):
//   ROCK_SHAPE_VARIANT_COUNT = 4  — leans-confirmed via a GetRandNum masked
//     %00011000 (2 random bits) near rock spawn/update. Verify vs quarry (A-17).
//   ROCK_HITBOX 132/72/42          — corroborated by both sources; box-vs-radius
//     unresolved. Consumed by A-8; defined here alongside RockSize.
//   ROCK_SPEED_MIN/MAX (per tier)  — feel-based, not found in fetches. Only the
//     RELATIONSHIPS are pinned (positivity, MIN<=MAX, smaller-is-faster), never
//     the magnitudes, so A-17 can swap values without editing this suite.
//
// RED until core/rocks.ts + core/bounds.ts exist and Rock is extended.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  spawnRock,
  spawnRocks,
  updateRock,
  updateRocks,
  ROCK_SHAPE_VARIANT_COUNT,
  ROCK_HITBOX,
  ROCK_SPEED_MIN,
  ROCK_SPEED_MAX,
} from '../src/core/rocks'
import { wrapPosition, type Bounds } from '../src/core/bounds'
import {
  initialState,
  WORLD_W,
  WORLD_H,
  type GameState,
  type Rock,
  type RockSize,
  type Vec2,
} from '../src/core/state'
import { createRng, type Rng } from '../src/core/rng'
import { stepGame } from '../src/core/sim'
import { NO_INPUT } from '../src/core/input'

const DT = 1 / 60
const WORLD_BOUNDS: Bounds = { width: WORLD_W, height: WORLD_H }
const SIZES: readonly RockSize[] = ['large', 'medium', 'small']

/** Assert two positions are equal component-wise (tolerant of float dust). */
function expectVec(actual: Vec2, expected: Vec2, precision = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, precision)
  expect(actual.y).toBeCloseTo(expected.y, precision)
}

/** A rock literal with sensible defaults, overridable per test. */
function rock(overrides: Partial<Rock> = {}): Rock {
  return {
    pos: { x: WORLD_W / 2, y: WORLD_H / 2 },
    size: 'large',
    velocity: { x: 5, y: -2 },
    shapeVariant: 0,
    ...overrides,
  }
}

/** A playing-mode state carrying the given rocks. */
function playing(seed: number, rocks: Rock[]): GameState {
  const s = initialState(seed)
  return { ...s, mode: 'playing', rocks }
}

// ---------------------------------------------------------------------------
// Provisional constants
// ---------------------------------------------------------------------------

describe('rock constants (provisional — verify vs ROM quarry in A-17)', () => {
  it('offers 4 shape variants (GetRandNum masked %00011000 → 2 random bits)', () => {
    expect(ROCK_SHAPE_VARIANT_COUNT).toBe(4)
  })

  it('pins the corroborated hit-box tiers to 132 / 72 / 42 lo-units', () => {
    expect(ROCK_HITBOX.large).toBe(132)
    expect(ROCK_HITBOX.medium).toBe(72)
    expect(ROCK_HITBOX.small).toBe(42)
  })

  it('orders hit boxes strictly large > medium > small', () => {
    expect(ROCK_HITBOX.large).toBeGreaterThan(ROCK_HITBOX.medium)
    expect(ROCK_HITBOX.medium).toBeGreaterThan(ROCK_HITBOX.small)
  })

  it('gives every tier a positive, well-ordered speed band (MIN <= MAX)', () => {
    for (const size of SIZES) {
      expect(ROCK_SPEED_MIN[size]).toBeGreaterThan(0)
      expect(ROCK_SPEED_MAX[size]).toBeGreaterThanOrEqual(ROCK_SPEED_MIN[size])
    }
  })

  it('makes smaller rocks faster (small >= medium >= large), tiers actually differ', () => {
    expect(ROCK_SPEED_MAX.small).toBeGreaterThanOrEqual(ROCK_SPEED_MAX.medium)
    expect(ROCK_SPEED_MAX.medium).toBeGreaterThanOrEqual(ROCK_SPEED_MAX.large)
    expect(ROCK_SPEED_MIN.small).toBeGreaterThanOrEqual(ROCK_SPEED_MIN.medium)
    expect(ROCK_SPEED_MIN.medium).toBeGreaterThanOrEqual(ROCK_SPEED_MIN.large)
    // Non-vacuity: the tiers are not all the same speed.
    expect(ROCK_SPEED_MAX.small).toBeGreaterThan(ROCK_SPEED_MAX.large)
  })
})

// ---------------------------------------------------------------------------
// spawnRock / spawnRocks — seeded, deterministic, in-bounds, drifting (AC-1, AC-2, AC-6)
// ---------------------------------------------------------------------------

describe('spawnRocks — count, size, determinism (AC-1, AC-6)', () => {
  it('returns exactly N rocks of the requested tier', () => {
    const rocks = spawnRocks(createRng(1979), 7, 'large', WORLD_BOUNDS)
    expect(rocks).toHaveLength(7)
    expect(rocks.every((r) => r.size === 'large')).toBe(true)
  })

  it('spawns the requested tier for every size', () => {
    for (const size of SIZES) {
      const rocks = spawnRocks(createRng(3), 4, size, WORLD_BOUNDS)
      expect(rocks.every((r) => r.size === size)).toBe(true)
    }
  })

  it('is deterministic: identical seed → deeply-equal rocks (golden by determinism)', () => {
    // The exact byte-values depend on the (unwritten) spawn formula, so RED
    // pins reproducibility + invariants rather than hardcoded literals that
    // would prematurely couple the suite to one implementation.
    const a = spawnRocks(createRng(2626), 5, 'large', WORLD_BOUNDS)
    const b = spawnRocks(createRng(2626), 5, 'large', WORLD_BOUNDS)
    expect(a).toEqual(b)
  })

  it('actually threads the seed: different seeds → different rocks', () => {
    const a = spawnRocks(createRng(1), 5, 'large', WORLD_BOUNDS)
    const b = spawnRocks(createRng(2), 5, 'large', WORLD_BOUNDS)
    expect(a).not.toEqual(b)
  })

  it('returns [] for a zero count', () => {
    expect(spawnRocks(createRng(1), 0, 'large', WORLD_BOUNDS)).toEqual([])
  })
})

describe('spawnRock — every field is valid and seeded (AC-1, AC-2)', () => {
  it('places the rock inside [0, W) x [0, H)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = spawnRock(createRng(seed), 'large', WORLD_BOUNDS)
      expect(r.pos.x).toBeGreaterThanOrEqual(0)
      expect(r.pos.x).toBeLessThan(WORLD_W)
      expect(r.pos.y).toBeGreaterThanOrEqual(0)
      expect(r.pos.y).toBeLessThan(WORLD_H)
    }
  })

  it('assigns an integer shapeVariant in [0, ROCK_SHAPE_VARIANT_COUNT) (AC-2)', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = spawnRock(createRng(seed), 'medium', WORLD_BOUNDS)
      expect(Number.isInteger(r.shapeVariant)).toBe(true)
      expect(r.shapeVariant).toBeGreaterThanOrEqual(0)
      expect(r.shapeVariant).toBeLessThan(ROCK_SHAPE_VARIANT_COUNT)
    }
  })

  it('uses more than one shape variant across a sample (not hardcoded to 0)', () => {
    const seen = new Set<number>()
    for (let seed = 1; seed <= 100; seed++) {
      seen.add(spawnRock(createRng(seed), 'small', WORLD_BOUNDS).shapeVariant)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('gives the rock a real drift within its tier speed band', () => {
    for (const size of SIZES) {
      for (let seed = 1; seed <= 40; seed++) {
        const r = spawnRock(createRng(seed), size, WORLD_BOUNDS)
        const speed = Math.hypot(r.velocity.x, r.velocity.y)
        expect(speed).toBeGreaterThan(0) // drift is real, never a stationary rock
        expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN[size] - 1e-9)
        expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX[size] + 1e-9)
      }
    }
  })

  it('varies drift direction across a sample (not one fixed heading)', () => {
    const headings = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) {
      const { velocity } = spawnRock(createRng(seed), 'large', WORLD_BOUNDS)
      headings.add(Math.atan2(velocity.y, velocity.x).toFixed(3))
    }
    expect(headings.size).toBeGreaterThan(1)
  })

  it('consumes randomness from the rng (advances the seed)', () => {
    const rng: Rng = createRng(1979)
    const before = rng.seed
    spawnRock(rng, 'large', WORLD_BOUNDS)
    expect(rng.seed).not.toBe(before)
  })

  it('draws a fresh rock on each successive call from one rng', () => {
    const rng: Rng = createRng(1979)
    const first = spawnRock(rng, 'large', WORLD_BOUNDS)
    const second = spawnRock(rng, 'large', WORLD_BOUNDS)
    expect(first).not.toEqual(second)
  })
})

// ---------------------------------------------------------------------------
// updateRock — pure translation, dt-scaled (AC-3)
// ---------------------------------------------------------------------------

describe('updateRock — pure drift translation (AC-3)', () => {
  it('translates by velocity * (dt*60) each tick, leaving velocity/size/shapeVariant fixed', () => {
    const r0 = rock({ pos: { x: 4096, y: 3072 }, velocity: { x: 5, y: -2 }, size: 'medium', shapeVariant: 2 })
    const r1 = updateRock(r0, DT, WORLD_BOUNDS)
    expectVec(r1.pos, { x: 4101, y: 3070 })
    expect(r1.velocity).toEqual({ x: 5, y: -2 })
    expect(r1.size).toBe('medium')
    expect(r1.shapeVariant).toBe(2)
  })

  it('advances linearly over N ticks', () => {
    let r = rock({ pos: { x: 4096, y: 3072 }, velocity: { x: 5, y: -2 } })
    for (let i = 0; i < 3; i++) r = updateRock(r, DT, WORLD_BOUNDS)
    expectVec(r.pos, { x: 4111, y: 3066 }) // +15, -6
  })

  it('scales displacement with dt (half dt → half the step)', () => {
    const r = updateRock(rock({ pos: { x: 4096, y: 3072 }, velocity: { x: 5, y: -2 } }), 1 / 120, WORLD_BOUNDS)
    expectVec(r.pos, { x: 4098.5, y: 3071 }, 6)
  })

  it('does not move the rock at dt = 0', () => {
    const r = updateRock(rock({ pos: { x: 4096, y: 3072 } }), 0, WORLD_BOUNDS)
    expectVec(r.pos, { x: 4096, y: 3072 })
  })
})

describe('updateRock — purity / immutable return', () => {
  it('does not mutate the input rock', () => {
    const r0 = rock({ pos: { x: 4096, y: 3072 }, velocity: { x: 5, y: -2 } })
    const snapshot = structuredClone(r0)
    updateRock(r0, DT, WORLD_BOUNDS)
    expect(r0).toEqual(snapshot)
  })

  it('returns fresh rock + pos objects, not the input references', () => {
    const r0 = rock({ velocity: { x: 5, y: -2 } })
    const r1 = updateRock(r0, DT, WORLD_BOUNDS)
    expect(r1).not.toBe(r0)
    expect(r1.pos).not.toBe(r0.pos)
  })
})

// ---------------------------------------------------------------------------
// updateRock — toroidal wrap via the shared bounds module (AC-4)
// ---------------------------------------------------------------------------

describe('updateRock — wraps toroidally, matching wrapPosition bit-for-bit (AC-4)', () => {
  it('wraps across the right edge to the shared-module value', () => {
    const r0 = rock({ pos: { x: 8190, y: 3000 }, velocity: { x: 5, y: 0 } })
    const r1 = updateRock(r0, DT, WORLD_BOUNDS)
    // raw x = 8190 + 5 = 8195 -> 8195 - 8192 = 3
    expectVec(r1.pos, wrapPosition({ x: 8195, y: 3000 }, WORLD_BOUNDS))
    expectVec(r1.pos, { x: 3, y: 3000 })
  })

  it('wraps across the left / bottom edges to the shared-module value', () => {
    const r0 = rock({ pos: { x: 3, y: 2 }, velocity: { x: -5, y: -6 } })
    const r1 = updateRock(r0, DT, WORLD_BOUNDS)
    expectVec(r1.pos, wrapPosition({ x: -2, y: -4 }, WORLD_BOUNDS))
    expect(r1.pos.x).toBeGreaterThanOrEqual(0)
    expect(r1.pos.x).toBeLessThan(WORLD_W)
    expect(r1.pos.y).toBeGreaterThanOrEqual(0)
    expect(r1.pos.y).toBeLessThan(WORLD_H)
  })

  it('lands on wrapPosition(raw) for a batch of edge-crossing drifts (rock uses the shared fold)', () => {
    const cases: Rock[] = [
      rock({ pos: { x: 8191, y: 6143 }, velocity: { x: 40, y: 30 } }),
      rock({ pos: { x: 1, y: 1 }, velocity: { x: -40, y: -30 } }),
      rock({ pos: { x: 4096, y: 6100 }, velocity: { x: 0, y: 60 } }),
    ]
    const frames = DT * 60
    for (const r0 of cases) {
      const raw: Vec2 = { x: r0.pos.x + r0.velocity.x * frames, y: r0.pos.y + r0.velocity.y * frames }
      expectVec(updateRock(r0, DT, WORLD_BOUNDS).pos, wrapPosition(raw, WORLD_BOUNDS))
    }
  })
})

// ---------------------------------------------------------------------------
// updateRocks — maps over the array (AC-3)
// ---------------------------------------------------------------------------

describe('updateRocks — advances every rock', () => {
  it('advances each element exactly as updateRock would, preserving order and length', () => {
    const rocks = [
      rock({ pos: { x: 1000, y: 1000 }, velocity: { x: 5, y: -2 } }),
      rock({ pos: { x: 2000, y: 4000 }, velocity: { x: -3, y: 6 }, size: 'small', shapeVariant: 1 }),
    ]
    const stepped = updateRocks(rocks, DT, WORLD_BOUNDS)
    expect(stepped).toHaveLength(2)
    expect(stepped[0]).toEqual(updateRock(rocks[0], DT, WORLD_BOUNDS))
    expect(stepped[1]).toEqual(updateRock(rocks[1], DT, WORLD_BOUNDS))
  })

  it('does not mutate the input array or its rocks; returns a fresh array', () => {
    const rocks = [rock({ velocity: { x: 5, y: -2 } })]
    const snapshot = structuredClone(rocks)
    const stepped = updateRocks(rocks, DT, WORLD_BOUNDS)
    expect(rocks).toEqual(snapshot)
    expect(stepped).not.toBe(rocks)
  })

  it('returns [] for an empty field', () => {
    expect(updateRocks([], DT, WORLD_BOUNDS)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Rotation is CONFIRMED ABSENT — verified, not merely untested (AC-5)
// ---------------------------------------------------------------------------

describe('rotation absence — the rocks never spin (AC-5, ROM-confirmed)', () => {
  it('Rock carries no angle/orientation/spin field at the type level', () => {
    // Source-scan the Rock interface: the ROM has no angle field for rocks, so
    // neither may the type. shapeVariant is fixed visual identity, NOT rotation.
    const stateSrc = readFileSync(
      fileURLToPath(new URL('../src/core/state.ts', import.meta.url)),
      'utf8',
    )
    const match = stateSrc.match(/interface\s+Rock\s*\{([^}]*)\}/)
    if (match === null) throw new Error('Rock interface must be declared in state.ts')
    const body = match[1]
    // Non-vacuity: the extension actually happened.
    expect(/velocity/.test(body)).toBe(true)
    expect(/shapeVariant/.test(body)).toBe(true)
    // The forbidden fields — any of these would reintroduce the phantom spin.
    expect(/\bangle\b|rotation|orient|\bspin\b|angular|\bdir\b/i.test(body)).toBe(false)
  })

  it('a spawned rock exposes exactly {pos, size, velocity, shapeVariant} — no rotation key', () => {
    const r = spawnRock(createRng(7), 'large', WORLD_BOUNDS)
    expect(Object.keys(r).sort()).toEqual(['pos', 'shapeVariant', 'size', 'velocity'])
  })

  it('shapeVariant + size never change across many drift ticks (stands in for "rotation rate")', () => {
    let r = rock({ pos: { x: 4096, y: 3072 }, velocity: { x: 7, y: -11 }, size: 'medium', shapeVariant: 3 })
    for (let i = 0; i < 600; i++) {
      r = updateRock(r, DT, WORLD_BOUNDS)
      expect(r.shapeVariant).toBe(3)
      expect(r.size).toBe('medium')
    }
    // Non-vacuity: the rock genuinely moved over those ticks.
    expect(Math.hypot(r.pos.x - 4096, r.pos.y - 3072)).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// stepGame wiring + determinism (AC-6)
// ---------------------------------------------------------------------------

describe('stepGame drifts rocks each tick in play (AC-6)', () => {
  it('advances state.rocks via updateRocks with world bounds', () => {
    const r0 = rock({ pos: { x: 4096, y: 3072 }, velocity: { x: 5, y: -2 }, shapeVariant: 1 })
    const s1 = stepGame(playing(1, [r0]), NO_INPUT, DT)
    expect(s1.rocks).toHaveLength(1)
    expect(s1.rocks[0]).toEqual(updateRock(r0, DT, WORLD_BOUNDS))
  })

  it('leaves the drift consuming no randomness (rocks move by pure translation)', () => {
    // Rocks integrate deterministically with no rng draw, so the seed is
    // untouched per tick — spawn is the only rng consumer (A-10 wave director).
    const s0 = playing(123, [rock({ velocity: { x: 5, y: -2 } })])
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.rng.seed).toBe(s0.rng.seed)
  })

  it('is deterministic with rocks present: same state + input → deeply-equal after N ticks', () => {
    const build = (): GameState =>
      playing(2626, [
        rock({ pos: { x: 1000, y: 1000 }, velocity: { x: 5, y: -2 } }),
        rock({ pos: { x: 7000, y: 5000 }, velocity: { x: -6, y: 3 }, size: 'small', shapeVariant: 2 }),
      ])
    let a = build()
    let b = build()
    for (let i = 0; i < 200; i++) {
      a = stepGame(a, NO_INPUT, DT)
      b = stepGame(b, NO_INPUT, DT)
    }
    expect(a.rocks).toEqual(b.rocks)
  })

  it('does not mutate the input state rocks', () => {
    const s0 = playing(42, [rock({ velocity: { x: 5, y: -2 } })])
    const snapshot = structuredClone(s0.rocks)
    stepGame(s0, NO_INPUT, DT)
    expect(s0.rocks).toEqual(snapshot)
  })
})
