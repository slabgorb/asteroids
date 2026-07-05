// reference/shapes.ts
//
// A-17: ROM-exact vector SHAPE tables, ported under reference/.
//
// The player ship, the four asteroid outlines, and the saucer are drawn by the
// Atari 1979 Asteroids cabinet's Digital Vector Generator (DVG) from a Vector
// ROM at $5000-$57FF. These tables carry that picture data as the *raw* DVG
// move list — an ordered sequence of SVEC (short vector) and VEC (long vector)
// moves — so this file is byte-faithful to the ROM rather than a hand-drawn
// approximation.
//
// SOURCE of the decoded move lists:
//   - computerarcheology.com/Arcade/Asteroids/VectorROM.html (DVG picture decode)
//   - 6502disassembly.com/va-asteroids/Asteroids.html (rev-4 program ROM)
// The raw copyrighted disassembly quarry lives locally under reference/ and is
// gitignored; only these derived numeric tables are committed (A-17).
//
// ⚠ These move lists are the computerarcheology decode; a later pass should
// re-confirm each SVEC/VEC against the raw Vector ROM ($5000-$57FF).
//
// Decoding scale/deltas into screen vertices is render's job (a later story).
// These tables carry the ROM data, not the rasterised polygon.
//
// Rocks do NOT rotate — the ROM has no rock angle field (only the ship has
// ShipDir), so each rock table is a single fixed outline.

/** A DVG opcode: 'SVEC' short vector, 'VEC' long vector. */
export type DvgOp = 'SVEC' | 'VEC'

/** One DVG move: the raw ROM scale field and signed delta. */
export interface DvgMove {
  readonly op: DvgOp
  readonly scale: number
  readonly x: number
  readonly y: number
}

/** A named vector picture: its Vector-ROM address and ordered move list. */
export interface RomShape {
  readonly romAddress: number
  readonly moves: readonly DvgMove[]
}

const svec = (scale: number, x: number, y: number): DvgMove => ({ op: 'SVEC', scale, x, y })
const vec = (scale: number, x: number, y: number): DvgMove => ({ op: 'VEC', scale, x, y })

// ---------------------------------------------------------------------------
// Asteroid outlines — four fixed shapes (Vector ROM $11E6 / $11FE / $121A / $1234)
// ---------------------------------------------------------------------------

export const ROCK_SHAPES: readonly RomShape[] = [
  {
    romAddress: 0x11e6,
    moves: [
      svec(3, 0, 1), svec(3, 1, 1), svec(3, 1, -1), svec(2, -1, -2), svec(2, 1, -2),
      svec(2, -3, -2), svec(2, -3, 0), svec(3, -1, 1), svec(3, 0, 2), svec(3, 1, 1),
      svec(3, 1, -1),
    ],
  },
  {
    romAddress: 0x11fe,
    moves: [
      svec(2, 2, 1), svec(2, 2, 1), svec(3, -1, 1), svec(2, -2, -1), svec(2, -2, 1),
      svec(3, -1, -1), svec(2, 1, -2), svec(2, -1, -2), svec(3, 1, -1), svec(2, 1, 1),
      svec(2, 3, -1), svec(2, 2, 3), svec(3, -1, 1),
    ],
  },
  {
    romAddress: 0x121a,
    moves: [
      svec(3, -1, 0), svec(2, -2, -1), svec(2, 2, -3), svec(2, 2, 3), svec(2, 0, -3),
      svec(3, 1, 0), svec(2, 2, 3), svec(3, 0, 1), svec(2, -2, 3), svec(2, -3, 0),
      svec(2, -3, -3), svec(2, 2, -1),
    ],
  },
  {
    romAddress: 0x1234,
    moves: [
      svec(2, 1, 0), svec(2, 3, 1), svec(2, 0, 1), svec(2, -3, 2), svec(2, -3, 0),
      svec(2, 1, -2), svec(2, -3, 0), svec(2, 0, -3), svec(2, 2, -3), svec(2, 3, 1),
      svec(2, 1, -1), svec(3, 1, 1), svec(2, -3, 2),
    ],
  },
]

// ---------------------------------------------------------------------------
// Ship silhouette — ShipDir0 ($1290). Render rotates this base shape by ship.dir.
// ---------------------------------------------------------------------------

export const SHIP_SHAPE: RomShape = {
  romAddress: 0x1290,
  moves: [
    svec(2, -3, -2), svec(3, 0, 2), svec(3, -1, 1),
    vec(6, 768, -256), vec(6, -768, -256), svec(3, 1, 1),
  ],
}

// ---------------------------------------------------------------------------
// Saucer silhouette ($1252). ONE ROM shape; the large + small saucer differ
// only by a render-time scale, not a second table.
// ---------------------------------------------------------------------------

export const SAUCER_SHAPE: RomShape = {
  romAddress: 0x1252,
  moves: [
    svec(2, -2, 1), svec(3, 2, 0), svec(2, 3, -2), vec(6, -640, 0), svec(2, 3, -2),
    svec(3, 2, 0), svec(2, 3, 2), svec(2, -3, 2), svec(2, -1, 2), svec(3, -1, 0),
    svec(2, -1, -2), svec(2, -3, -2),
  ],
}
