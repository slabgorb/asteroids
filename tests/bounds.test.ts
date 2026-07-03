// tests/bounds.test.ts
//
// A-6: the shared toroidal-wrap module. A-3 (ship) and A-4 (bullet) each carry
// an identical private `wrap(v, size)` helper — the same UpdateObjPos ($6fc7)
// mod-into-[0,size) math (X mod $20 hi-units, Y at $18). A-6 hoists the
// position-only core into `core/bounds.ts` as
//   wrapPosition(position: Vec2, bounds: Bounds): Vec2
// so rocks wrap bit-for-bit identically to the ship BY CONSTRUCTION (same
// function) rather than by convention (parallel copies that can drift).
//
// This file pins two things (Story AC-4):
//   1. wrapPosition is a correct toroidal fold into [0, width) x [0, height)
//      for the passed bounds — not a WORLD-hardcoded fold.
//   2. The extraction is REUSE, not duplication: both `core/ship.ts` and the
//      new `core/rocks.ts` consume the shared module. A dev could make the
//      behavioural tests pass by copy-pasting wrap logic into rocks.ts; the
//      source-scan tests below forbid that.
//
// RED until `core/bounds.ts` exports `wrapPosition`/`Bounds` and ship.ts/rocks.ts
// are rewired to it.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { wrapPosition, type Bounds } from '../src/core/bounds'
import { WORLD_W, WORLD_H, type Vec2 } from '../src/core/state'

const WORLD_BOUNDS: Bounds = { width: WORLD_W, height: WORLD_H }

/** Assert two positions are equal component-wise (tolerant of float dust). */
function expectVec(actual: Vec2, expected: Vec2, precision = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, precision)
  expect(actual.y).toBeCloseTo(expected.y, precision)
}

const coreFile = (name: string): string =>
  fileURLToPath(new URL(`../src/core/${name}`, import.meta.url))

describe('wrapPosition — toroidal fold into [0, w) x [0, h) (AC-4)', () => {
  it('leaves an in-bounds position unchanged', () => {
    expectVec(wrapPosition({ x: 100, y: 200 }, WORLD_BOUNDS), { x: 100, y: 200 })
  })

  it('wraps x across the right edge (UpdateObjPos $6fc7)', () => {
    // WORLD_W + 8 -> 8, matching the ship's right-seam wrap (ship.test.ts).
    expectVec(wrapPosition({ x: WORLD_W + 8, y: 3000 }, WORLD_BOUNDS), { x: 8, y: 3000 })
  })

  it('wraps x across the left edge', () => {
    expectVec(wrapPosition({ x: -8, y: 3000 }, WORLD_BOUNDS), { x: WORLD_W - 8, y: 3000 })
  })

  it('wraps y across the top edge', () => {
    expectVec(wrapPosition({ x: 4000, y: WORLD_H + 6 }, WORLD_BOUNDS), { x: 4000, y: 6 })
  })

  it('wraps y across the bottom edge', () => {
    expectVec(wrapPosition({ x: 4000, y: -6 }, WORLD_BOUNDS), { x: 4000, y: WORLD_H - 6 })
  })

  it('folds arbitrarily-far positions back into range on both axes', () => {
    const samples: Vec2[] = [
      { x: 3 * WORLD_W + 5, y: -2 * WORLD_H - 5 },
      { x: -5 * WORLD_W - 1, y: 4 * WORLD_H + 1 },
      { x: 10 * WORLD_W, y: 10 * WORLD_H },
    ]
    for (const p of samples) {
      const w = wrapPosition(p, WORLD_BOUNDS)
      expect(w.x).toBeGreaterThanOrEqual(0)
      expect(w.x).toBeLessThan(WORLD_W)
      expect(w.y).toBeGreaterThanOrEqual(0)
      expect(w.y).toBeLessThan(WORLD_H)
    }
  })

  it('is toroidal: adding a full width/height leaves the wrapped result unchanged', () => {
    const base: Vec2 = { x: 1234, y: 5678 }
    const shifted: Vec2 = { x: base.x + WORLD_W, y: base.y + WORLD_H }
    expectVec(wrapPosition(shifted, WORLD_BOUNDS), wrapPosition(base, WORLD_BOUNDS))
  })

  it('honours the PASSED bounds, not a hardcoded WORLD size', () => {
    // A WORLD-hardcoded implementation would return the input unchanged here.
    const tiny: Bounds = { width: 10, height: 10 }
    expectVec(wrapPosition({ x: 12, y: 12 }, tiny), { x: 2, y: 2 })
    expectVec(wrapPosition({ x: -1, y: -1 }, tiny), { x: 9, y: 9 })
  })
})

describe('wrapPosition — purity', () => {
  it('does not mutate the input position', () => {
    const p: Vec2 = { x: WORLD_W + 3, y: -4 }
    const snapshot = structuredClone(p)
    wrapPosition(p, WORLD_BOUNDS)
    expect(p).toEqual(snapshot)
  })

  it('returns a fresh Vec2, not the input reference', () => {
    const p: Vec2 = { x: 100, y: 200 }
    expect(wrapPosition(p, WORLD_BOUNDS)).not.toBe(p)
  })
})

describe('wrapPosition is SHARED, not duplicated (AC-4 — reuse over convention)', () => {
  // The story extracts wrap so ship + rocks fold identically by construction.
  // These scans forbid re-copying wrap logic instead of importing the module.
  it('core/bounds.ts exists', () => {
    expect(existsSync(coreFile('bounds.ts'))).toBe(true)
  })

  it('core/ship.ts consumes the shared bounds module (A-3 wrap becomes a thin wrapper)', () => {
    const src = readFileSync(coreFile('ship.ts'), 'utf8')
    expect(
      /from\s*['"]\.\/bounds['"]/.test(src),
      'ship.ts must import from ./bounds after the extraction',
    ).toBe(true)
    expect(/wrapPosition/.test(src), 'ship.ts must reference the shared wrapPosition').toBe(true)
  })

  it('core/rocks.ts wraps via the shared bounds module, not a private copy', () => {
    const src = readFileSync(coreFile('rocks.ts'), 'utf8')
    expect(
      /from\s*['"]\.\/bounds['"]/.test(src),
      'rocks.ts must import from ./bounds, not reimplement wrap',
    ).toBe(true)
    expect(/wrapPosition/.test(src), 'rocks.ts must reference the shared wrapPosition').toBe(true)
  })
})
