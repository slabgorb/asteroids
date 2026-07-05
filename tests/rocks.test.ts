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
  splitRock,
  ROCK_SHAPE_VARIANT_COUNT,
  ROCK_HITBOX,
  ROCK_SPEED_MIN,
  ROCK_SPEED_MAX,
  SPLIT_SPREAD_ANGLE,
  SPLIT_SPEED_SCALE,
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

  it('exercises the full shape-variant range across a sample (not just >1, catches range-halving)', () => {
    // Ride-along strengthening (A-6 Reviewer finding): `seen.size > 1` would pass
    // a range-halving regression (e.g. nextInt(rng, 2)). Across 100 seeds every
    // one of the ROCK_SHAPE_VARIANT_COUNT variants appears, so pin the exact count.
    const seen = new Set<number>()
    for (let seed = 1; seed <= 100; seed++) {
      seen.add(spawnRock(createRng(seed), 'small', WORLD_BOUNDS).shapeVariant)
    }
    expect(seen.size).toBe(ROCK_SHAPE_VARIANT_COUNT)
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
    // Position clear of the default ship spawn (rock()'s own default pos IS
    // the ship spawn point, {4096, 3072}) — A2-5's ship-death debris also
    // draws rng, so a coincidental ram here would confound this guard with a
    // different rng consumer than the one it means to test.
    const s0 = playing(123, [rock({ pos: { x: 1000, y: 1000 }, velocity: { x: 5, y: -2 } })])
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

// ===========================================================================
// A-7: splitting — large → 2 medium, medium → 2 small, small → gone.
//
// `splitRock(rock, rng) → Rock[]` is the purely GEOMETRIC half of destruction:
// given a rock and the rng, produce its children (or none). It is decoupled
// from what TRIGGERS destruction (A-8 collision calls it) and from SCORING it
// (A-9). Each child inherits the parent's drift heading, gets an independent
// random angular spread, has its speed re-clamped into the CHILD tier's band,
// spawns at the parent's exact position (no offset), and rerolls its shape
// variant. Small rocks despawn (empty array).
//
// Units mirror A-6: velocity is world-units per 60 Hz frame, so the child speed
// band is the per-frame ROCK_SPEED_MIN/MAX[childSize] — asserting the band pins
// the per-frame unit inheritance the whole cabinet shares (session watch-item).
//
// Provisional constants (named + isolated so A-17 is a data-only swap; the ROM
// split-velocity routine was the THINNEST area in both fetches, and the exact
// spread formula was not found — so only RELATIONSHIPS are pinned here, never
// magnitudes, mirroring A-6's "pin relationships, not literals" discipline):
//   SPLIT_SPREAD_ANGLE  — feel-based; the original's children visibly diverge
//     on split, so spread must exist. Only presence + a sane bound are pinned.
//   SPLIT_SPEED_SCALE   — per child tier (~1.0-1.3, smaller scales up). Only
//     positivity is pinned; magnitudes verify vs quarry (A-17).
//
// RED until core/rocks.ts exports splitRock + SPLIT_SPREAD_ANGLE + SPLIT_SPEED_SCALE
// (the failing named imports at the top of this file fail the whole suite until then).
// ===========================================================================

const TINY_BOUNDS: Bounds = { width: 100, height: 50 }

/** Heading of a velocity vector, radians. */
function heading(v: Vec2): number {
  return Math.atan2(v.y, v.x)
}

/** Smallest signed angle a → b, in (-π, π] — wraparound-safe. */
function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

describe('split constants (provisional — verify vs ROM quarry in A-17)', () => {
  it('has a positive, sane spread angle (spread is real; children do not reverse)', () => {
    expect(SPLIT_SPREAD_ANGLE).toBeGreaterThan(0)
    expect(SPLIT_SPREAD_ANGLE).toBeLessThanOrEqual(Math.PI)
  })

  it('offers a positive speed scale for every child tier (medium, small)', () => {
    // Children are only ever medium (from large) or small (from medium).
    expect(SPLIT_SPEED_SCALE.medium).toBeGreaterThan(0)
    expect(SPLIT_SPEED_SCALE.small).toBeGreaterThan(0)
  })
})

describe('splitRock — child count and tier per size (AC-1, AC-2, AC-3)', () => {
  it('splits a large rock into exactly two medium children (AC-1)', () => {
    const kids = splitRock(rock({ size: 'large' }), createRng(1))
    expect(kids).toHaveLength(2)
    expect(kids.every((k) => k.size === 'medium')).toBe(true)
  })

  it('splits a medium rock into exactly two small children (AC-2)', () => {
    const kids = splitRock(rock({ size: 'medium' }), createRng(1))
    expect(kids).toHaveLength(2)
    expect(kids.every((k) => k.size === 'small')).toBe(true)
  })

  it('despawns a small rock — returns [] ("2 small → gone", AC-3)', () => {
    expect(splitRock(rock({ size: 'small' }), createRng(1))).toEqual([])
  })

  it('despawns a small rock WITHOUT consuming randomness (protects A-8 determinism)', () => {
    // A-8 will call splitRock in the collision loop; a wasted draw on every small
    // despawn would silently desync every later spawn. Despawn must draw nothing.
    const rng = createRng(1979)
    const before = rng.seed
    splitRock(rock({ size: 'small' }), rng)
    expect(rng.seed).toBe(before)
  })
})

describe('splitRock — child position inheritance (no offset)', () => {
  it('spawns both children at the parent’s exact position, as fresh objects (AC-1)', () => {
    const parent = rock({ pos: { x: 1234, y: 5678 }, size: 'large' })
    for (const kid of splitRock(parent, createRng(3))) {
      expectVec(kid.pos, { x: 1234, y: 5678 })
      expect(kid.pos).not.toBe(parent.pos) // copied, never aliased
    }
  })
})

describe('splitRock — velocity inheritance + angular spread (AC-5)', () => {
  it('spreads the two children onto different headings — velocity spread is real (AC-5)', () => {
    for (const seed of [1, 7, 13, 42, 99]) {
      const [a, b] = splitRock(rock({ size: 'large', velocity: { x: 6, y: 3 } }), createRng(seed))
      expect(heading(a.velocity).toFixed(6)).not.toBe(heading(b.velocity).toFixed(6))
    }
  })

  it('gives the two children non-identical velocity vectors (AC-5)', () => {
    const [a, b] = splitRock(rock({ size: 'large', velocity: { x: 6, y: 3 } }), createRng(5))
    expect(a.velocity).not.toEqual(b.velocity)
  })

  it('keeps each child’s heading within SPLIT_SPREAD_ANGLE of the parent (inheritance + bounded spread)', () => {
    const parentVel = { x: 6, y: 3 }
    const parentHeading = heading(parentVel)
    for (let seed = 1; seed <= 40; seed++) {
      for (const kid of splitRock(rock({ size: 'large', velocity: parentVel }), createRng(seed))) {
        expect(Math.abs(angleDelta(heading(kid.velocity), parentHeading))).toBeLessThanOrEqual(
          SPLIT_SPREAD_ANGLE + 1e-9,
        )
      }
    }
  })

  it('gives children of a RESTING parent a real drift (never stationary — lower clamp at zero speed)', () => {
    for (const kid of splitRock(rock({ size: 'large', velocity: { x: 0, y: 0 } }), createRng(3))) {
      expect(Math.hypot(kid.velocity.x, kid.velocity.y)).toBeGreaterThanOrEqual(
        ROCK_SPEED_MIN.medium - 1e-9,
      )
    }
  })
})

describe('splitRock — per-tier speed re-clamp (AC-4)', () => {
  it('always lands children within the CHILD tier’s speed band, any seed, both parent tiers', () => {
    const tiers: ReadonlyArray<readonly [RockSize, RockSize]> = [
      ['large', 'medium'],
      ['medium', 'small'],
    ]
    for (const [parentSize, childSize] of tiers) {
      for (let seed = 1; seed <= 40; seed++) {
        const kids = splitRock(rock({ size: parentSize, velocity: { x: 5, y: -2 } }), createRng(seed))
        for (const kid of kids) {
          const speed = Math.hypot(kid.velocity.x, kid.velocity.y)
          expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN[childSize] - 1e-9)
          expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX[childSize] + 1e-9)
        }
      }
    }
  })

  it('re-clamps below the child max even when the parent is absurdly fast (upper clamp, AC-4)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const kid of splitRock(rock({ size: 'large', velocity: { x: 1000, y: 0 } }), createRng(seed))) {
        expect(Math.hypot(kid.velocity.x, kid.velocity.y)).toBeLessThanOrEqual(
          ROCK_SPEED_MAX.medium + 1e-9,
        )
      }
    }
  })

  it('re-clamps above the child min even when the parent is nearly still (lower clamp, AC-4)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const kid of splitRock(rock({ size: 'large', velocity: { x: 1e-4, y: 0 } }), createRng(seed))) {
        expect(Math.hypot(kid.velocity.x, kid.velocity.y)).toBeGreaterThanOrEqual(
          ROCK_SPEED_MIN.medium - 1e-9,
        )
      }
    }
  })

  it('keeps children in-band when the parent is already at its own tier’s max speed (AC-4)', () => {
    // The AC's literal case: parent drifting at ROCK_SPEED_MAX.large; medium
    // children must still re-clamp into [MIN, MAX].medium, not pass a raw multiple.
    for (const kid of splitRock(
      rock({ size: 'large', velocity: { x: ROCK_SPEED_MAX.large, y: 0 } }),
      createRng(9),
    )) {
      const speed = Math.hypot(kid.velocity.x, kid.velocity.y)
      expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN.medium - 1e-9)
      expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX.medium + 1e-9)
    }
  })
})

describe('splitRock — shape-variant reroll (AC-2)', () => {
  it('gives each child an integer shapeVariant in [0, ROCK_SHAPE_VARIANT_COUNT) (AC-2)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const kid of splitRock(rock({ size: 'large' }), createRng(seed))) {
        expect(Number.isInteger(kid.shapeVariant)).toBe(true)
        expect(kid.shapeVariant).toBeGreaterThanOrEqual(0)
        expect(kid.shapeVariant).toBeLessThan(ROCK_SHAPE_VARIANT_COUNT)
      }
    }
  })

  it('rerolls variants independently per child (variants vary; the pair differs on some seeds)', () => {
    // Parent variant is fixed at 0 (rock() default); a "copy parent" or a single
    // shared draw would fail one of these two guards.
    const allVariants = new Set<number>()
    let sawDifferingPair = false
    for (let seed = 1; seed <= 60; seed++) {
      const [a, b] = splitRock(rock({ size: 'large', shapeVariant: 0 }), createRng(seed))
      allVariants.add(a.shapeVariant)
      allVariants.add(b.shapeVariant)
      if (a.shapeVariant !== b.shapeVariant) sawDifferingPair = true
    }
    expect(allVariants.size).toBeGreaterThan(1) // genuinely rerolled, not the parent's 0
    expect(sawDifferingPair).toBe(true) // the two children draw independently
  })
})

describe('splitRock — determinism, purity, rng threading (AC-6)', () => {
  it('is deterministic: same parent + identically-seeded rng → deeply-equal children', () => {
    const parent = rock({ size: 'large' })
    expect(splitRock(parent, createRng(2626))).toEqual(splitRock(parent, createRng(2626)))
  })

  it('does not mutate the input rock', () => {
    const parent = rock({ size: 'large', velocity: { x: 6, y: 3 } })
    const snapshot = structuredClone(parent)
    splitRock(parent, createRng(4))
    expect(parent).toEqual(snapshot)
  })

  it('returns fresh, distinct child + pos objects (no aliasing to parent or each other)', () => {
    const parent = rock({ size: 'large' })
    const [a, b] = splitRock(parent, createRng(8))
    expect(a).not.toBe(b)
    expect(a.pos).not.toBe(parent.pos)
    expect(b.pos).not.toBe(parent.pos)
    expect(a.pos).not.toBe(b.pos)
  })

  it('consumes randomness from the rng (advances the seed)', () => {
    const rng = createRng(1979)
    const before = rng.seed
    splitRock(rock({ size: 'large' }), rng)
    expect(rng.seed).not.toBe(before)
  })

  it('draws fresh children on successive calls from one rng', () => {
    const rng = createRng(1979)
    const first = splitRock(rock({ size: 'large' }), rng)
    const second = splitRock(rock({ size: 'large' }), rng)
    expect(first).not.toEqual(second)
  })

  it('exposes exactly {pos, shapeVariant, size, velocity} on each child — no rotation key (AC-5 parity)', () => {
    for (const kid of splitRock(rock({ size: 'large' }), createRng(7))) {
      expect(Object.keys(kid).sort()).toEqual(['pos', 'shapeVariant', 'size', 'velocity'])
    }
  })
})

describe('splitRock — children are valid, drift-ready rocks (per-frame units)', () => {
  it('a split child fed to updateRock drifts by velocity*(dt*60) then wraps (units match A-6)', () => {
    const parent = rock({ pos: { x: 4096, y: 3072 }, velocity: { x: 5, y: -2 }, size: 'large' })
    const [child] = splitRock(parent, createRng(11))
    const frames = DT * 60
    const raw: Vec2 = {
      x: child.pos.x + child.velocity.x * frames,
      y: child.pos.y + child.velocity.y * frames,
    }
    expectVec(updateRock(child, DT, WORLD_BOUNDS).pos, wrapPosition(raw, WORLD_BOUNDS))
  })
})

// ---------------------------------------------------------------------------
// Ride-along coverage (A-6 Reviewer finding): the A-6 suite only ever passed
// WORLD-sized bounds, so a spawn/update that ignored `bounds` and closed over
// WORLD_W/H would have passed the whole file. Exercise a non-WORLD Bounds.
// ---------------------------------------------------------------------------

describe('non-WORLD Bounds — A-6 functions honor the PASSED bounds, not a hardcoded WORLD', () => {
  it('spawnRock places the rock inside the passed (tiny) bounds', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = spawnRock(createRng(seed), 'large', TINY_BOUNDS)
      expect(r.pos.x).toBeGreaterThanOrEqual(0)
      expect(r.pos.x).toBeLessThan(TINY_BOUNDS.width)
      expect(r.pos.y).toBeGreaterThanOrEqual(0)
      expect(r.pos.y).toBeLessThan(TINY_BOUNDS.height)
    }
  })

  it('updateRock wraps into the passed (tiny) bounds, matching wrapPosition', () => {
    const r0 = rock({ pos: { x: 95, y: 45 }, velocity: { x: 10, y: 10 } })
    const r1 = updateRock(r0, DT, TINY_BOUNDS)
    const frames = DT * 60
    const raw: Vec2 = { x: r0.pos.x + r0.velocity.x * frames, y: r0.pos.y + r0.velocity.y * frames }
    expectVec(r1.pos, wrapPosition(raw, TINY_BOUNDS))
    // Non-vacuity: raw (105, 55) exceeded the tiny bounds, so it actually wrapped.
    expect(r1.pos.x).toBeLessThan(TINY_BOUNDS.width)
    expect(r1.pos.y).toBeLessThan(TINY_BOUNDS.height)
  })

  it('updateRocks forwards the passed (tiny) bounds to every rock', () => {
    const rocks = [
      rock({ pos: { x: 98, y: 48 }, velocity: { x: 10, y: 10 } }),
      rock({ pos: { x: 2, y: 2 }, velocity: { x: -10, y: -10 } }),
    ]
    const stepped = updateRocks(rocks, DT, TINY_BOUNDS)
    expect(stepped[0]).toEqual(updateRock(rocks[0], DT, TINY_BOUNDS))
    expect(stepped[1]).toEqual(updateRock(rocks[1], DT, TINY_BOUNDS))
    for (const s of stepped) {
      expect(s.pos.x).toBeGreaterThanOrEqual(0)
      expect(s.pos.x).toBeLessThan(TINY_BOUNDS.width)
      expect(s.pos.y).toBeGreaterThanOrEqual(0)
      expect(s.pos.y).toBeLessThan(TINY_BOUNDS.height)
    }
  })
})
