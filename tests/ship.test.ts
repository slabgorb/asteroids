// tests/ship.test.ts
//
// A-3: Ship flight model (rotate/thrust/inertia/drag/screen-wrap), ROM-tuned.
//
// Every constant here is sourced from the rev-4 ROM disassembly at
// https://6502disassembly.com/va-asteroids/Asteroids.html (the reference/
// quarry does not exist in this checkout — see session Delivery Findings):
//
//   - Rotation: ChkPlyrInput ($7086) adds +3 (left) / -3 (right) to ShipDir
//     every frame; ShipDir is a byte, so 256 units = full circle. Left is +3
//     and the ship starts pointing up, so +dir is counterclockwise and
//     dir 0 = +x, dir 64 = +y (up).
//   - Thrust: ChkThrust ($709b) updates velocity every OTHER frame: it adds
//     2 * ThrustTbl[dir] (quarter-sine table at $57b9, amplitude 127) to a
//     16-bit velocity (ShipXSpeed:ShipXAccel), sign-folded per quadrant via
//     CalcXThrust/CalcThrustDir ($77d2/$77d5). Net rate: 127/256 world-units
//     per frame^2 along the facing at full alignment.
//   - Drag: ShipDecelerate ($70e1) runs every other non-thrust frame and
//     moves the 16-bit velocity toward zero by 2*hi-byte (+1), i.e. a factor
//     of 127/128 per update (~0.79 per second at 60 Hz).
//   - Max velocity: ChkShipMaxVel ($7125) clamps each axis independently to
//     +$3FFF / -$3FFF (16383 lo-units = 63.99609375 units/frame). The
//     per-axis clamp is a ROM quirk we preserve: diagonal top speed is
//     sqrt(2) times the cardinal top speed.
//   - Playfield: UpdateObjPos ($6fc7) adds velocity to a 16-bit position;
//     X wraps mod $20 hi-units ($6fe0 `and #$1f`) and Y wraps at $18
//     hi-units ($7007) — a toroidal 8192 x 6144 world in lo-units
//     (8 lo-units = 1 screen pixel at 1024x768).
//
// Tolerance bands accept both faithful update cadences (every-other-frame
// like the ROM, or half-rate every frame) — see session Design Deviations.
// Tests drive the sim at the canonical fixed dt = 1/60 except where dt
// scaling itself is under test.

import { describe, it, expect } from 'vitest'
import { stepGame } from '../src/core/sim'
import {
  initialState,
  WORLD_W,
  WORLD_H,
  type GameState,
  type Ship,
} from '../src/core/state'
import {
  SHIP_ROTATION_RATE,
  SHIP_MAX_SPEED,
  SHIP_THRUST_TABLE,
} from '../src/core/ship'
import { NO_INPUT, type Input } from '../src/core/input'

const DT = 1 / 60

const LEFT: Input = { ...NO_INPUT, left: true }
const RIGHT: Input = { ...NO_INPUT, right: true }
const THRUST: Input = { ...NO_INPUT, thrust: true }
const LEFT_THRUST: Input = { ...NO_INPUT, left: true, thrust: true }
const BOTH_ROTATE: Input = { ...NO_INPUT, left: true, right: true }

// ThrustTbl, $57b9: 65-entry quarter sine, amplitude 127. Bytes verbatim
// from the disassembly listing.
const ROM_THRUST_TABLE = [
  0x00, 0x03, 0x06, 0x09, 0x0c, 0x10, 0x13, 0x16,
  0x19, 0x1c, 0x1f, 0x22, 0x25, 0x28, 0x2b, 0x2e,
  0x31, 0x33, 0x36, 0x39, 0x3c, 0x3f, 0x41, 0x44,
  0x47, 0x49, 0x4c, 0x4e, 0x51, 0x53, 0x55, 0x58,
  0x5a, 0x5c, 0x5e, 0x60, 0x62, 0x64, 0x66, 0x68,
  0x6a, 0x6b, 0x6d, 0x6f, 0x70, 0x71, 0x73, 0x74,
  0x75, 0x76, 0x78, 0x79, 0x7a, 0x7a, 0x7b, 0x7c,
  0x7d, 0x7d, 0x7e, 0x7e, 0x7e, 0x7f, 0x7f, 0x7f,
  0x7f,
]

/** Full-alignment thrust rate: 127/256 world-units per frame^2. */
const THRUST_RATE = 127 / 256

/** A playing-mode state with optional ship overrides. */
function playing(seed = 1, ship: Partial<Ship> = {}): GameState {
  const s = initialState(seed)
  return { ...s, mode: 'playing', ship: { ...s.ship, ...ship } }
}

function stepN(s: GameState, input: Input, n: number, dt = DT): GameState {
  for (let i = 0; i < n; i++) s = stepGame(s, input, dt)
  return s
}

describe('ROM-tuned constants (AC-7)', () => {
  it('pins the rotation rate to 3 direction-units per frame (ChkPlyrInput $708b)', () => {
    expect(SHIP_ROTATION_RATE).toBe(3)
  })

  it('pins max velocity to $3FFF lo-units per axis (ChkShipMaxVel $7125)', () => {
    expect(SHIP_MAX_SPEED).toBe(16383 / 256)
  })

  it('ships the ThrustTbl quarter-sine bytes verbatim (ROM $57b9)', () => {
    expect(SHIP_THRUST_TABLE).toHaveLength(65)
    expect(Array.from(SHIP_THRUST_TABLE)).toEqual(ROM_THRUST_TABLE)
  })

  it('thrust table is monotonically non-decreasing from 0 to 127', () => {
    expect(SHIP_THRUST_TABLE[0]).toBe(0)
    expect(SHIP_THRUST_TABLE[64]).toBe(127)
    for (let i = 1; i < 65; i++) {
      expect(SHIP_THRUST_TABLE[i]).toBeGreaterThanOrEqual(SHIP_THRUST_TABLE[i - 1])
    }
  })

  it('pins the toroidal playfield to 8192 x 6144 lo-units (wrap at $20/$18 hi-units)', () => {
    expect(WORLD_W).toBe(8192)
    expect(WORLD_H).toBe(6144)
  })
})

describe('initialState — ship spawn (AC-2, AC-7)', () => {
  it('spawns the ship at the center of the playfield', () => {
    const s = initialState(1)
    expect(s.ship.pos).toEqual({ x: 4096, y: 3072 })
  })

  it('spawns the ship at rest', () => {
    const s = initialState(1)
    expect(s.ship.vel).toEqual({ x: 0, y: 0 })
  })

  it('spawns the ship pointing up (dir 64 of 256)', () => {
    // Canonical spawn orientation (footage + published analyses); byte-level
    // spawn value settles in A-17 with the rest of the table port.
    expect(initialState(1).ship.dir).toBe(64)
  })
})

describe('rotation (AC-1)', () => {
  it('adds 3 direction-units per frame while left is held', () => {
    const s = playing(1, { dir: 0 })
    expect(stepGame(s, LEFT, DT).ship.dir).toBe(3)
    expect(stepN(s, LEFT, 30).ship.dir).toBe(90)
  })

  it('subtracts 3 direction-units per frame while right is held, wrapping mod 256', () => {
    const s = playing(1, { dir: 0 })
    expect(stepGame(s, RIGHT, DT).ship.dir).toBe(253)
    expect(stepN(s, RIGHT, 30).ship.dir).toBe(256 - 90)
  })

  it('wraps dir back into [0, 256) when rotating past a full circle', () => {
    const s = playing(1, { dir: 250 })
    const after = stepN(s, LEFT, 4) // 250 + 12 = 262 -> 6
    expect(after.ship.dir).toBe(6)
    expect(after.ship.dir).toBeGreaterThanOrEqual(0)
    expect(after.ship.dir).toBeLessThan(256)
  })

  it('does not rotate without input', () => {
    const s = playing(1, { dir: 64 })
    expect(stepN(s, NO_INPUT, 10).ship.dir).toBe(64)
  })

  it('left wins when both rotate buttons are held (ROM branch order, $7089)', () => {
    // ChkPlyrInput tests left first and skips the right check entirely.
    const s = playing(1, { dir: 0 })
    expect(stepGame(s, BOTH_ROTATE, DT).ship.dir).toBe(3)
  })

  it('scales rotation linearly with dt (time enters the core only as dt)', () => {
    const s = playing(1, { dir: 0 })
    expect(stepGame(s, LEFT, 1 / 120).ship.dir).toBeCloseTo(1.5, 9)
  })

  it('rotation alone does not translate or accelerate the ship', () => {
    const s = playing(1, { dir: 0 })
    const after = stepN(s, LEFT, 20)
    expect(after.ship.pos).toEqual(s.ship.pos)
    expect(after.ship.vel).toEqual({ x: 0, y: 0 })
  })
})

describe('thrust and inertia (AC-2)', () => {
  it('accelerates along +x at ~127/256 units/frame^2 when facing dir 0', () => {
    const after = stepN(playing(1, { dir: 0 }), THRUST, 60)
    expect(after.ship.vel.x).toBeGreaterThan(29.2) // no drag while thrusting
    expect(after.ship.vel.x).toBeLessThan(30.4)
    expect(Math.abs(after.ship.vel.y)).toBeLessThanOrEqual(1e-9)
  })

  it('matches the per-frame thrust rate over a short window', () => {
    const after = stepN(playing(1, { dir: 0 }), THRUST, 2)
    expect(Math.abs(after.ship.vel.x - 2 * THRUST_RATE)).toBeLessThan(0.02)
  })

  it('thrusts with equal magnitude along all four cardinal directions', () => {
    const speeds = [0, 64, 128, 192].map((dir) => {
      const v = stepN(playing(1, { dir }), THRUST, 60).ship.vel
      return { dir, v, mag: Math.hypot(v.x, v.y) }
    })
    for (const { mag } of speeds) {
      expect(mag).toBeGreaterThan(29.2)
      expect(mag).toBeLessThan(30.4)
    }
    // Sign conventions: dir 0 -> +x, 64 -> +y, 128 -> -x, 192 -> -y.
    expect(speeds[0].v.x).toBeGreaterThan(0)
    expect(speeds[1].v.y).toBeGreaterThan(0)
    expect(speeds[2].v.x).toBeLessThan(0)
    expect(speeds[3].v.y).toBeLessThan(0)
  })

  it('uses the ROM table for diagonals: dir 32 gives 90/256 per axis, not cos(45°)', () => {
    // ThrustTbl[32] = $5a = 90; a Math.cos implementation would give
    // 127*cos(pi/4) ~ 89.8 and land at ~21.05 — outside this band.
    const v = stepN(playing(1, { dir: 32 }), THRUST, 60).ship.vel
    expect(v.x).toBeGreaterThan(21.074)
    expect(v.x).toBeLessThan(21.114)
    expect(Math.abs(v.x - v.y)).toBeLessThan(0.02)
  })

  it('keeps velocity when thrust is released (inertia)', () => {
    const thrusting = stepN(playing(1, { dir: 0 }), THRUST, 30)
    const vx = thrusting.ship.vel.x
    expect(vx).toBeGreaterThan(10)
    const coasting = stepN(thrusting, NO_INPUT, 5)
    // Only drag (~1/256 per frame) may shave it — no hard stop, no reset.
    expect(coasting.ship.vel.x).toBeGreaterThan(vx * 0.97)
    expect(coasting.ship.pos.x).toBeGreaterThan(thrusting.ship.pos.x)
  })

  it('can rotate and thrust in the same frame', () => {
    const after = stepN(playing(1, { dir: 0 }), LEFT_THRUST, 2)
    expect(after.ship.dir).toBe(6)
    expect(Math.hypot(after.ship.vel.x, after.ship.vel.y)).toBeGreaterThan(0)
  })

  it('integrates position from velocity (units are per 60 Hz frame)', () => {
    const s = playing(1, {
      pos: { x: 1000, y: 3000 },
      vel: { x: 10, y: -5 },
      dir: 0,
    })
    const after = stepN(s, NO_INPUT, 3)
    // Coasting, so up to ~3 frames of drag (~1/128 per update) may apply.
    expect(after.ship.pos.x).toBeGreaterThan(1029.2)
    expect(after.ship.pos.x).toBeLessThanOrEqual(1030.001)
    expect(after.ship.pos.y).toBeLessThan(2985.4)
    expect(after.ship.pos.y).toBeGreaterThanOrEqual(2984.999)
  })
})

describe('drag (AC-2, AC-3)', () => {
  it('decays coasting velocity by ~127/128 per two frames (~0.79 over 1s)', () => {
    // 51.2 units/frame = $3333 lo-units — large enough that byte rounding
    // in a fixed-point implementation stays inside the band.
    const s = playing(1, { vel: { x: 51.2, y: 0 }, dir: 0 })
    const vx = stepN(s, NO_INPUT, 60).ship.vel.x
    expect(vx).toBeGreaterThan(40.1) // no-drag (51.2) and 1/64-rate (~32) both fail
    expect(vx).toBeLessThan(40.8)
  })

  it('is not applied while thrust is held (ROM: thrust and decelerate are exclusive)', () => {
    // With drag wrongly applied during thrust, 60 frames from rest reach
    // ~26.6 units/frame — below this floor.
    const after = stepN(playing(1, { dir: 0 }), THRUST, 60)
    expect(after.ship.vel.x).toBeGreaterThan(29.2)
  })

  it('never reverses direction and brings the ship to rest (AC-3)', () => {
    let s = playing(1, { vel: { x: 1.5, y: -1.5 }, dir: 0 })
    let prevMagX = Math.abs(s.ship.vel.x)
    let prevMagY = Math.abs(s.ship.vel.y)
    for (let i = 0; i < 2400; i++) {
      s = stepGame(s, NO_INPUT, DT)
      const { x, y } = s.ship.vel
      expect(x).toBeGreaterThanOrEqual(-1e-9) // started positive, never flips
      expect(y).toBeLessThanOrEqual(1e-9) // started negative, never flips
      expect(Math.abs(x)).toBeLessThanOrEqual(prevMagX + 1e-9)
      expect(Math.abs(y)).toBeLessThanOrEqual(prevMagY + 1e-9)
      prevMagX = Math.abs(x)
      prevMagY = Math.abs(y)
    }
    // Effectively at rest: below one lo-unit (1/256 world unit) per frame.
    expect(Math.abs(s.ship.vel.x)).toBeLessThan(1 / 256)
    expect(Math.abs(s.ship.vel.y)).toBeLessThan(1 / 256)
  })
})

describe('max velocity (AC-3)', () => {
  it('clamps +x velocity at SHIP_MAX_SPEED under sustained thrust', () => {
    // Uncapped, 300 frames would reach ~149 units/frame.
    const vx = stepN(playing(1, { dir: 0 }), THRUST, 300).ship.vel.x
    expect(vx).toBeLessThanOrEqual(SHIP_MAX_SPEED + 1e-9)
    expect(vx).toBeGreaterThan(63)
  })

  it('clamps -x velocity symmetrically (ROM clamps to -$3FFF)', () => {
    const vx = stepN(playing(1, { dir: 128 }), THRUST, 300).ship.vel.x
    expect(vx).toBeGreaterThanOrEqual(-SHIP_MAX_SPEED - 1e-9)
    expect(vx).toBeLessThan(-63)
  })

  it('clamps each axis independently — diagonal top speed exceeds the cardinal cap (ROM quirk)', () => {
    // A vector-norm clamp would hold each component near 45.25 — outside
    // this band. The ROM clamps x and y separately.
    const v = stepN(playing(1, { dir: 32 }), THRUST, 400).ship.vel
    for (const c of [v.x, v.y]) {
      expect(c).toBeGreaterThan(63)
      expect(c).toBeLessThanOrEqual(SHIP_MAX_SPEED + 1e-9)
    }
    expect(Math.hypot(v.x, v.y)).toBeGreaterThan(SHIP_MAX_SPEED)
  })
})

describe('screen wrap — toroidal, in the sim (AC-4)', () => {
  it('wraps x across the right edge', () => {
    const s = playing(1, { pos: { x: 8190, y: 3000 }, vel: { x: 10, y: 0 } })
    const after = stepGame(s, NO_INPUT, DT)
    expect(Math.abs(after.ship.pos.x - 8)).toBeLessThanOrEqual(0.5)
    expect(after.ship.pos.y).toBeCloseTo(3000, 6)
  })

  it('wraps x across the left edge', () => {
    const s = playing(1, { pos: { x: 5, y: 3000 }, vel: { x: -10, y: 0 } })
    const after = stepGame(s, NO_INPUT, DT)
    expect(Math.abs(after.ship.pos.x - 8187)).toBeLessThanOrEqual(0.5)
  })

  it('wraps y across the top edge', () => {
    const s = playing(1, { pos: { x: 4000, y: 6140 }, vel: { x: 0, y: 10 } })
    const after = stepGame(s, NO_INPUT, DT)
    expect(Math.abs(after.ship.pos.y - 6)).toBeLessThanOrEqual(0.5)
  })

  it('wraps y across the bottom edge', () => {
    const s = playing(1, { pos: { x: 4000, y: 4 }, vel: { x: 0, y: -10 } })
    const after = stepGame(s, NO_INPUT, DT)
    expect(Math.abs(after.ship.pos.y - 6138)).toBeLessThanOrEqual(0.5)
  })

  it('keeps the ship inside [0, WORLD_W) x [0, WORLD_H) across a spiralling max-speed run', () => {
    let s = playing(7)
    for (let i = 0; i < 600; i++) {
      s = stepGame(s, i % 3 === 0 ? LEFT_THRUST : THRUST, DT)
      const { x, y } = s.ship.pos
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(WORLD_W)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThan(WORLD_H)
    }
    // The run must actually have crossed edges, or this proved nothing:
    // at cap speed (~64/frame) 600 frames cover >4 widths of the world.
    const v = s.ship.vel
    expect(Math.hypot(v.x, v.y)).toBeGreaterThan(60)
  })
})

describe('flight model purity & determinism (AC-5, AC-6)', () => {
  const FLIGHT_SCRIPT: Input[] = [THRUST, LEFT, LEFT_THRUST, NO_INPUT, RIGHT]

  function flightRun(seed: number, ticks: number): GameState {
    let s = playing(seed)
    for (let i = 0; i < ticks; i++) {
      s = stepGame(s, FLIGHT_SCRIPT[i % FLIGHT_SCRIPT.length], DT)
    }
    return s
  }

  it('does not mutate the input state while flying', () => {
    const s0 = playing(42, { vel: { x: 3, y: 4 }, dir: 17 })
    const snapshot = structuredClone(s0)
    stepGame(s0, LEFT_THRUST, DT)
    expect(s0).toEqual(snapshot)
  })

  it('returns fresh ship objects when the ship moves (no aliasing)', () => {
    const s0 = playing(42, { vel: { x: 3, y: 4 } })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.ship).not.toBe(s0.ship)
    expect(s1.ship.pos).not.toBe(s0.ship.pos)
    expect(s1.ship.pos).not.toEqual(s0.ship.pos)
  })

  it('replays deterministically: same seed + script -> deeply equal state', () => {
    expect(flightRun(123, 120)).toEqual(flightRun(123, 120))
  })

  it('consumes no randomness: flight leaves the RNG seed untouched', () => {
    const s0 = playing(99)
    expect(flightRun(99, 100).rng.seed).toBe(s0.rng.seed)
  })
})

describe('core stays typed (lang-review #1: no type-safety escapes in core/)', () => {
  // Mechanical guard for the TypeScript review checklist: the pure core
  // must not paper over type errors. Mirrors core-boundary.test.ts.
  it('core/ contains no `as any`, @ts-ignore, or @ts-expect-error', async () => {
    const { readFileSync, readdirSync, existsSync, statSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const coreDir = fileURLToPath(new URL('../src/core/', import.meta.url))
    expect(existsSync(coreDir)).toBe(true)
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = dir + name
        if (statSync(full).isDirectory()) walk(full + '/')
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) files.push(full)
      }
    }
    walk(coreDir)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      expect(/\bas\s+any\b/.test(src), `${file} must not use \`as any\``).toBe(false)
      expect(/@ts-ignore/.test(src), `${file} must not use @ts-ignore`).toBe(false)
      expect(/@ts-expect-error/.test(src), `${file} must not use @ts-expect-error`).toBe(false)
    }
  })
})
