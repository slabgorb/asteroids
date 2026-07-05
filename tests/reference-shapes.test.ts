// tests/reference-shapes.test.ts
//
// A-17: ROM-exact SHAPE tables ported under reference/.
//
// The player ship, the four asteroid outlines, and the saucer are drawn by the
// cabinet's Digital Vector Generator (DVG) from a Vector ROM at $5000-$57FF.
// This suite pins those shapes as the *raw* DVG picture data — an ordered list
// of SVEC (short vector) / VEC (long vector) moves — so the committed
// `reference/shapes.ts` tables are byte-faithful to the ROM rather than the
// hand-drawn unit-radius polygons currently living in src/shell/render.ts.
//
// SOURCE of the decoded move lists below:
//   - computerarcheology.com/Arcade/Asteroids/VectorROM.html (DVG picture decode)
//   - 6502disassembly.com/va-asteroids/Asteroids.html (rev-4 program ROM)
// The raw Vector ROM itself lives in the gitignored `reference/` quarry. These
// fixtures are the decode as published by computerarcheology; GREEN/verify MUST
// re-confirm them against the raw Vector ROM ($5000-$57FF) and correct any
// fixture here if the authoritative byte-decode differs (see session Design
// Deviations / Delivery Findings).
//
// Shape schema (one entry per DVG move):
//   { op: 'SVEC' | 'VEC', scale: number, x: number, y: number }
//   - op    — 'SVEC' short-vector opcode, 'VEC' long-vector opcode
//   - scale — the raw ROM scale field (SVEC: 2 or 3; VEC: 6 here)
//   - x, y  — the signed delta as decoded (SVEC: small units; VEC: 13-bit)
// Decoding scale/deltas into screen vertices is render's job (GREEN); these
// tables carry the ROM data, not the rasterised polygon.
//
// ⚠ Rocks do NOT rotate (confirmed absent in the ROM — no rock angle field;
// only the ship has ShipDir). Each rock table is a single fixed outline.

import { describe, it, expect } from 'vitest'
// Reference tables do not exist yet (RED). Loaded dynamically so each spec fails
// with a clear "Cannot find module '../reference/shapes'" until Dev creates them.
const loadShapes = () => import('../reference/shapes')

// core cross-check: the ROM offers exactly four asteroid outlines.
import { ROCK_SHAPE_VARIANT_COUNT } from '../src/core/rocks'

type Move = { op: 'SVEC' | 'VEC'; scale: number; x: number; y: number }
const svec = (scale: number, x: number, y: number): Move => ({ op: 'SVEC', scale, x, y })
const vec = (scale: number, x: number, y: number): Move => ({ op: 'VEC', scale, x, y })

// ---------------------------------------------------------------------------
// Expected ROM decode (computerarcheology VectorROM.html)
// ---------------------------------------------------------------------------

const ROCK1: Move[] = [
  svec(3, 0, 1), svec(3, 1, 1), svec(3, 1, -1), svec(2, -1, -2), svec(2, 1, -2),
  svec(2, -3, -2), svec(2, -3, 0), svec(3, -1, 1), svec(3, 0, 2), svec(3, 1, 1),
  svec(3, 1, -1),
]
const ROCK2: Move[] = [
  svec(2, 2, 1), svec(2, 2, 1), svec(3, -1, 1), svec(2, -2, -1), svec(2, -2, 1),
  svec(3, -1, -1), svec(2, 1, -2), svec(2, -1, -2), svec(3, 1, -1), svec(2, 1, 1),
  svec(2, 3, -1), svec(2, 2, 3), svec(3, -1, 1),
]
const ROCK3: Move[] = [
  svec(3, -1, 0), svec(2, -2, -1), svec(2, 2, -3), svec(2, 2, 3), svec(2, 0, -3),
  svec(3, 1, 0), svec(2, 2, 3), svec(3, 0, 1), svec(2, -2, 3), svec(2, -3, 0),
  svec(2, -3, -3), svec(2, 2, -1),
]
const ROCK4: Move[] = [
  svec(2, 1, 0), svec(2, 3, 1), svec(2, 0, 1), svec(2, -3, 2), svec(2, -3, 0),
  svec(2, 1, -2), svec(2, -3, 0), svec(2, 0, -3), svec(2, 2, -3), svec(2, 3, 1),
  svec(2, 1, -1), svec(3, 1, 1), svec(2, -3, 2),
]
const ROCK_ADDRS = [0x11e6, 0x11fe, 0x121a, 0x1234]
const ROCK_MOVES = [ROCK1, ROCK2, ROCK3, ROCK4]

// ShipDir0 — the ship's base silhouette (render rotates it by ship.dir).
const SHIP_MOVES: Move[] = [
  svec(2, -3, -2), svec(3, 0, 2), svec(3, -1, 1),
  vec(6, 768, -256), vec(6, -768, -256), svec(3, 1, 1),
]
const SHIP_ADDR = 0x1290

// One saucer silhouette in ROM, scaled for both the large and small saucer.
const SAUCER_MOVES: Move[] = [
  svec(2, -2, 1), svec(3, 2, 0), svec(2, 3, -2), vec(6, -640, 0), svec(2, 3, -2),
  svec(3, 2, 0), svec(2, 3, 2), svec(2, -3, 2), svec(2, -1, 2), svec(3, -1, 0),
  svec(2, -1, -2), svec(2, -3, -2),
]
const SAUCER_ADDR = 0x1252

// ---------------------------------------------------------------------------
// Rock outline tables
// ---------------------------------------------------------------------------

describe('reference/shapes — asteroid outlines (A-17, ROM $5000-$57FF)', () => {
  it('exports exactly four rock outlines (matches core ROCK_SHAPE_VARIANT_COUNT)', async () => {
    const { ROCK_SHAPES } = await loadShapes()
    expect(ROCK_SHAPES).toHaveLength(4)
    // Non-vacuity: the shape count is the same 4 the core spawns.
    expect(ROCK_SHAPES).toHaveLength(ROCK_SHAPE_VARIANT_COUNT)
  })

  it('pins each rock outline to its Vector-ROM address', async () => {
    const { ROCK_SHAPES } = await loadShapes()
    expect(ROCK_SHAPES.map((s: { romAddress: number }) => s.romAddress)).toEqual(ROCK_ADDRS)
  })

  it('ports every rock outline as its exact DVG move list', async () => {
    const { ROCK_SHAPES } = await loadShapes()
    for (let i = 0; i < 4; i++) {
      expect(ROCK_SHAPES[i].moves).toEqual(ROCK_MOVES[i])
    }
  })

  it('gives the four outlines the ROM move counts 11 / 13 / 12 / 13', async () => {
    const { ROCK_SHAPES } = await loadShapes()
    expect(ROCK_SHAPES.map((s: { moves: Move[] }) => s.moves.length)).toEqual([11, 13, 12, 13])
  })

  it('carries no rotation/angle field (rocks never spin in the ROM)', async () => {
    const { ROCK_SHAPES } = await loadShapes()
    for (const shape of ROCK_SHAPES) {
      expect(shape).not.toHaveProperty('angle')
      expect(shape).not.toHaveProperty('rotation')
    }
  })
})

// ---------------------------------------------------------------------------
// Ship + saucer outline tables
// ---------------------------------------------------------------------------

describe('reference/shapes — ship silhouette (A-17, ShipDir0 $1290)', () => {
  it('pins the ship base outline to its exact DVG move list', async () => {
    const { SHIP_SHAPE } = await loadShapes()
    expect(SHIP_SHAPE.romAddress).toBe(SHIP_ADDR)
    expect(SHIP_SHAPE.moves).toEqual(SHIP_MOVES)
  })

  it('uses the two long VEC hull edges (768/-256 wedge)', async () => {
    const { SHIP_SHAPE } = await loadShapes()
    const longs = SHIP_SHAPE.moves.filter((m: Move) => m.op === 'VEC')
    expect(longs).toEqual([vec(6, 768, -256), vec(6, -768, -256)])
  })
})

describe('reference/shapes — saucer silhouette (A-17, $1252)', () => {
  it('pins the saucer outline to its exact DVG move list', async () => {
    const { SAUCER_SHAPE } = await loadShapes()
    expect(SAUCER_SHAPE.romAddress).toBe(SAUCER_ADDR)
    expect(SAUCER_SHAPE.moves).toEqual(SAUCER_MOVES)
  })

  it('is a single silhouette (large + small saucer share one ROM shape, scaled)', async () => {
    const shapes = await loadShapes()
    // The ROM defines ONE saucer picture; size is a render-time scale, not a
    // second shape table. Guard against a stray SMALL_SAUCER_SHAPE export.
    expect(shapes).not.toHaveProperty('SMALL_SAUCER_SHAPE')
    expect(shapes.SAUCER_SHAPE.moves.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Schema + provenance invariants (apply to every shape)
// ---------------------------------------------------------------------------

describe('reference/shapes — schema invariants (A-17)', () => {
  it('every move is a well-formed DVG op with integer deltas', async () => {
    const { ROCK_SHAPES, SHIP_SHAPE, SAUCER_SHAPE } = await loadShapes()
    const all = [...ROCK_SHAPES, SHIP_SHAPE, SAUCER_SHAPE]
    expect(all.length).toBe(6)
    for (const shape of all) {
      expect(shape.moves.length).toBeGreaterThan(0)
      for (const m of shape.moves as Move[]) {
        expect(['SVEC', 'VEC']).toContain(m.op)
        expect(Number.isInteger(m.scale)).toBe(true)
        expect(Number.isInteger(m.x)).toBe(true)
        expect(Number.isInteger(m.y)).toBe(true)
      }
    }
  })

  it('cites its ROM provenance in the source file', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const src = readFileSync(
      fileURLToPath(new URL('../reference/shapes.ts', import.meta.url)),
      'utf8',
    )
    // The port must record where the shapes came from — matches the ROM-citation
    // discipline used across src/core.
    expect(/computerarcheology\.com|6502disassembly\.com/.test(src)).toBe(true)
    expect(/\$?5000|VectorROM|Vector ROM/i.test(src)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// reference/ stays typed (lang-review #1: no type-safety escapes)
// ---------------------------------------------------------------------------

describe('reference/ stays typed (lang-review #1)', () => {
  it('reference/*.ts contains no `as any`, @ts-ignore, or @ts-expect-error', async () => {
    const { readFileSync, readdirSync, existsSync, statSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const refDir = fileURLToPath(new URL('../reference/', import.meta.url))
    expect(existsSync(refDir)).toBe(true)
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = dir + name
        if (statSync(full).isDirectory()) walk(full + '/')
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) files.push(full)
      }
    }
    walk(refDir)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      expect(/\bas\s+any\b/.test(src), `${file} must not use \`as any\``).toBe(false)
      expect(/@ts-ignore/.test(src), `${file} must not use @ts-ignore`).toBe(false)
      expect(/@ts-expect-error/.test(src), `${file} must not use @ts-expect-error`).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// The tables must be COMMITTED under reference/ (A-17 un-ignore decision)
// ---------------------------------------------------------------------------

describe('reference/shapes — committed, not gitignored (A-17)', () => {
  it('reference/shapes.ts is tracked, not swept up by the reference/ ignore', async () => {
    const { execFileSync } = await import('node:child_process')
    const { fileURLToPath } = await import('node:url')
    const repoRoot = fileURLToPath(new URL('../', import.meta.url))
    let ignored = false
    try {
      // exit 0 => path IS ignored; exit 1 => NOT ignored (throws)
      execFileSync('git', ['check-ignore', '-q', 'reference/shapes.ts'], { cwd: repoRoot })
      ignored = true
    } catch {
      ignored = false
    }
    expect(ignored).toBe(false)
  })
})
