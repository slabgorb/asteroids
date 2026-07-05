// tests/reference-velocities.test.ts
//
// A-17: ROM-exact VELOCITY / physics tables ported under reference/.
//
// The ship's flight physics were already ROM-tuned in A-3 (see ship.test.ts),
// with the constants sourced from the rev-4 disassembly. A-17 consolidates the
// *raw ROM* velocity data into committed `reference/velocities.ts` tables so the
// core derives from a single source of truth instead of carrying its own
// literals. This suite pins the reference values to the ROM and then asserts the
// core constants are derived from them.
//
// SOURCE:
//   - 6502disassembly.com/va-asteroids/Asteroids.html (rev-4 program ROM)
//   - computerarcheology.com/Arcade/Asteroids/Code.html
//
// Convention: `reference/` holds the RAW ROM value; `src/core` holds the value
// converted into the sim's units. The wiring specs below prove the conversion
// (e.g. SHIP_MAX_SPEED === MAX_ABS_VELOCITY_RAW / 256), which is what makes the
// reference table the authority rather than a parallel copy.

import { describe, it, expect } from 'vitest'
const loadVel = () => import('../reference/velocities')

// Core constants that must derive from the reference tables.
import { SHIP_THRUST_TABLE, SHIP_MAX_SPEED, SHIP_ROTATION_RATE } from '../src/core/ship'
import {
  SAUCER_VERTICAL_SPEEDS,
  SAUCER_BULLET_SPEED as CORE_SAUCER_BULLET_SPEED,
  SAUCER_FIRE_INTERVAL,
} from '../src/core/saucer'
import { BULLET_LIFETIME_FRAMES } from '../src/core/bullet'

// ---------------------------------------------------------------------------
// Thrust table (ThrustTbl $57b9 — the 65-byte quarter-sine, amplitude 127)
// ---------------------------------------------------------------------------

describe('reference/velocities — thrust table (A-17, ROM $57b9)', () => {
  it('ships the 65-entry quarter-sine, 0 → 127, monotonic non-decreasing', async () => {
    const { THRUST_TABLE } = await loadVel()
    expect(THRUST_TABLE).toHaveLength(65)
    expect(THRUST_TABLE[0]).toBe(0)
    expect(THRUST_TABLE[64]).toBe(127)
    for (let i = 1; i < 65; i++) {
      expect(THRUST_TABLE[i]).toBeGreaterThanOrEqual(THRUST_TABLE[i - 1])
    }
  })

  it('is the single source of truth for core/ship SHIP_THRUST_TABLE', async () => {
    const { THRUST_TABLE } = await loadVel()
    expect(Array.from(SHIP_THRUST_TABLE)).toEqual(Array.from(THRUST_TABLE))
  })
})

// ---------------------------------------------------------------------------
// Scalar ship physics constants
// ---------------------------------------------------------------------------

describe('reference/velocities — ship scalars (A-17)', () => {
  it('pins the per-axis velocity clamp to raw $3FFF (ChkShipMaxVel $7125)', async () => {
    const { MAX_ABS_VELOCITY_RAW } = await loadVel()
    expect(MAX_ABS_VELOCITY_RAW).toBe(0x3fff) // 16383
  })

  it('derives core SHIP_MAX_SPEED from the raw clamp (÷256 to world-units)', async () => {
    const { MAX_ABS_VELOCITY_RAW } = await loadVel()
    expect(SHIP_MAX_SPEED).toBe(MAX_ABS_VELOCITY_RAW / 256)
  })

  it('pins the rotation rate to 3 dir-units/frame (ChkPlyrInput $708b) and wires core', async () => {
    const { ROTATION_RATE } = await loadVel()
    expect(ROTATION_RATE).toBe(3)
    expect(SHIP_ROTATION_RATE).toBe(ROTATION_RATE)
  })
})

// ---------------------------------------------------------------------------
// Saucer velocity table + scalars
// ---------------------------------------------------------------------------

describe('reference/velocities — saucer (A-17)', () => {
  it('ports the saucer Y-speed reroll table [-16, 0, 0, 16] ($6CD1: F0 00 00 10)', async () => {
    const { SAUCER_Y_SPEEDS } = await loadVel()
    expect(Array.from(SAUCER_Y_SPEEDS)).toEqual([-16, 0, 0, 16])
  })

  it('is the single source of truth for core SAUCER_VERTICAL_SPEEDS', async () => {
    const { SAUCER_Y_SPEEDS } = await loadVel()
    expect(Array.from(SAUCER_VERTICAL_SPEEDS)).toEqual(Array.from(SAUCER_Y_SPEEDS))
  })

  it('pins the saucer bullet speed to 111 ($6F) and wires core', async () => {
    const { SAUCER_BULLET_SPEED } = await loadVel()
    expect(SAUCER_BULLET_SPEED).toBe(111)
    expect(CORE_SAUCER_BULLET_SPEED).toBe(SAUCER_BULLET_SPEED)
  })

  it('pins the saucer fire interval to 10 frames ($0A) — core carries it in seconds', async () => {
    const { SAUCER_FIRE_INTERVAL_FRAMES } = await loadVel()
    expect(SAUCER_FIRE_INTERVAL_FRAMES).toBe(10)
    expect(SAUCER_FIRE_INTERVAL).toBeCloseTo(SAUCER_FIRE_INTERVAL_FRAMES / 60, 10)
  })
})

// ---------------------------------------------------------------------------
// Bullet lifetime (ShpShotTimer $6d01: lda #18)
// ---------------------------------------------------------------------------

describe('reference/velocities — bullet lifetime (A-17, ROM $6d01)', () => {
  it('pins the shot lifetime to 18 frames and wires core/bullet', async () => {
    const { SHOT_LIFETIME_FRAMES } = await loadVel()
    expect(SHOT_LIFETIME_FRAMES).toBe(18)
    expect(BULLET_LIFETIME_FRAMES).toBe(SHOT_LIFETIME_FRAMES)
  })
})

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

describe('reference/velocities — provenance (A-17)', () => {
  it('cites the ROM disassembly source in the file', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const src = readFileSync(
      fileURLToPath(new URL('../reference/velocities.ts', import.meta.url)),
      'utf8',
    )
    expect(/6502disassembly\.com|computerarcheology\.com/.test(src)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Committed under reference/ (A-17 un-ignore decision)
// ---------------------------------------------------------------------------

describe('reference/velocities — committed, not gitignored (A-17)', () => {
  it('reference/velocities.ts is tracked, not swept up by the reference/ ignore', async () => {
    const { execFileSync } = await import('node:child_process')
    const { fileURLToPath } = await import('node:url')
    const repoRoot = fileURLToPath(new URL('../', import.meta.url))
    let ignored = false
    try {
      execFileSync('git', ['check-ignore', '-q', 'reference/velocities.ts'], { cwd: repoRoot })
      ignored = true
    } catch {
      ignored = false
    }
    expect(ignored).toBe(false)
  })
})
