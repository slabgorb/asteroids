// src/core/ship.ts
//
// A-3: the player ship's flight model — rotation, thrust, inertia, drag,
// max-velocity clamp, and toroidal screen wrap. Pure: no DOM, no wall-clock
// or entropy globals; time enters only as `dt`, randomness only from the
// seeded RNG (flight consumes none).
//
// Every constant is ROM-tuned against the rev-4 disassembly at
// https://6502disassembly.com/va-asteroids/Asteroids.html (the reference/
// quarry is absent from this checkout, so the extracted values live here,
// cited by ROM address). World units are ROM "lo-units" (8 per screen pixel
// at 1024x768); velocity is world-units per 60 Hz frame; `dir` is a 256-unit
// circle, 0 = +x, counterclockwise positive.
//
// Cadence note (see session Design Deviations): the ROM updates thrust/drag
// every OTHER frame (ChkThrust $709b gates on FrameTimer parity). This clone
// applies the half-rate per-frame equivalent — trajectory-identical at
// gameplay granularity and cleanly scalable by dt.

import type { Ship } from './state'
import { WORLD_W, WORLD_H } from './state'
import type { Input } from './input'
import { wrapPosition, type Bounds } from './bounds'

/** Direction-units added per 60 Hz frame while a rotate button is held
 * (ChkPlyrInput $708b: `lda #$03`; $7094: `lda #$fd`). 256 units = full
 * circle, so a full revolution takes ~85 frames. */
export const SHIP_ROTATION_RATE = 3

/** Per-axis velocity clamp (ChkShipMaxVel $7125): the ROM caps the 16-bit
 * velocity at +/-$3FFF lo-units. Per-axis, NOT vector-norm — diagonal top
 * speed is legitimately sqrt(2) times this. */
export const SHIP_MAX_SPEED = 16383 / 256

/** ThrustTbl ($57b9): 65-entry quarter sine, amplitude 127, bytes verbatim
 * from the ROM. Index 0..64 spans a quarter circle; the other quadrants are
 * folded onto it by sign/index reflection (CalcXThrust/CalcThrustDir). */
export const SHIP_THRUST_TABLE: readonly number[] = [
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

/** Coasting drag: the ROM subtracts 2x the velocity hi-byte every other
 * frame (ShipDecelerate $70e1), i.e. x127/128 per update; per-frame
 * equivalent is x255/256. */
const DRAG_PER_FRAME = 255 / 256

/** Quarter-wave sine lookup over the full 256-unit circle
 * (GetVelocityVal $77df): fold the low 7 bits onto the 0..64 table, negate
 * when bit 7 is set. Y-thrust reads sinLookup(dir); X-thrust reads
 * sinLookup(dir + 64) — the ROM's cosine-by-phase-shift (CalcXThrust $77d2
 * adds #$40). Bitwise ops truncate fractional dt-scaled directions the same
 * way the ROM's byte math would. Exported so firing (bullet.ts) resolves a
 * shot's heading through the same ROM routine, not a private copy. */
export function sinLookup(d: number): number {
  const b = d & 255
  const i = b & 127
  const mag = SHIP_THRUST_TABLE[i <= 64 ? i : 128 - i]
  return b & 128 ? -mag : mag
}

function clampAxis(v: number): number {
  return Math.min(SHIP_MAX_SPEED, Math.max(-SHIP_MAX_SPEED, v))
}

// Toroidal screen wrap (UpdateObjPos $6fc7) lives in the shared ./bounds
// module since A-6, so ship and rocks fold identically by construction.
const WORLD_BOUNDS: Bounds = { width: WORLD_W, height: WORLD_H }

/** Advance the ship one step. `dt` is seconds; rates are ROM-per-frame, so
 * they scale by dt*60 (the fixed-timestep loop feeds exactly 1/60). */
export function stepShip(ship: Ship, input: Input, dt: number): Ship {
  const frames = dt * 60

  // Rotation first, thrust reads the updated direction — ROM order
  // (ChkPlyrInput updates ShipDir at $7097 before ChkThrust runs). Left
  // wins over right: the ROM checks left first and skips the right check
  // entirely (branch at $7089).
  let dir = ship.dir
  if (input.left) dir += SHIP_ROTATION_RATE * frames
  else if (input.right) dir -= SHIP_ROTATION_RATE * frames
  // Fold onto the 256-unit circle (a heading, not a position — the shared
  // wrapPosition handles the playfield; this stays a plain mod).
  dir = ((dir % 256) + 256) % 256

  let vx = ship.vel.x
  let vy = ship.vel.y
  if (input.thrust) {
    // Full ROM rate is 2*table/256 per 2 frames (UpdateShipXVel $70b4
    // doubles the byte) — table/256 per frame here.
    vx += (sinLookup(dir + 64) / 256) * frames
    vy += (sinLookup(dir) / 256) * frames
  } else {
    // Thrust and deceleration are mutually exclusive ($70a3 branches to
    // ShipDecelerate only when thrust is up).
    const decay = Math.pow(DRAG_PER_FRAME, frames)
    vx *= decay
    vy *= decay
  }
  vx = clampAxis(vx)
  vy = clampAxis(vy)

  return {
    pos: wrapPosition(
      { x: ship.pos.x + vx * frames, y: ship.pos.y + vy * frames },
      WORLD_BOUNDS,
    ),
    vel: { x: vx, y: vy },
    dir,
  }
}
