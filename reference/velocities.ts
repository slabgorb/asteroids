// reference/velocities.ts
//
// A-17: ROM-exact VELOCITY / physics constant tables, ported under reference/.
//
// The raw ROM value for each cabinet physics constant, sourced from the rev-4
// disassembly. `reference/` holds the RAW ROM value; `src/core` holds the value
// converted into the sim's units (e.g. core SHIP_MAX_SPEED = MAX_ABS_VELOCITY_RAW
// / 256). The test suite (tests/reference-velocities.test.ts) pins core to these
// tables so the two never drift.
//
// SOURCE:
//   - 6502disassembly.com/va-asteroids/Asteroids.html (rev-4 program ROM)
//   - computerarcheology.com/Arcade/Asteroids/Code.html
// The raw copyrighted disassembly quarry lives locally under reference/ and is
// gitignored; only these derived numeric tables are committed.

/**
 * ThrustTbl ($57b9): the 65-entry quarter-sine (amplitude 127), bytes verbatim
 * from the ROM. Index 0..64 spans a quarter circle; the other quadrants are
 * folded onto it by sign/index reflection (CalcXThrust/CalcThrustDir).
 */
export const THRUST_TABLE: readonly number[] = [
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

/**
 * Per-axis velocity clamp: the ROM caps ship X/Y speed at ±$3FFF lo-units
 * (ChkShipMaxVel $7125). Core converts to world-units/frame by ÷256.
 */
export const MAX_ABS_VELOCITY_RAW = 0x3fff // 16383

/**
 * Ship rotation rate: ChkPlyrInput ($708b) adds ±3 to ShipDir each frame; the
 * byte-sized ShipDir gives 256 units = one full circle.
 */
export const ROTATION_RATE = 3

/**
 * Saucer Y-speed reroll table ($6CD1: F0 00 00 10) — the ROM picks one of
 * these four signed vertical speeds (−16, 0, 0, +16) via a 2-bit random index.
 */
export const SAUCER_Y_SPEEDS: readonly number[] = [-16, 0, 0, 16]

/** Saucer bullet speed: $6F (111) lo-units/frame. */
export const SAUCER_BULLET_SPEED = 111

/** Saucer fire cadence: reload every $0A (10) frames (ScrTimer $6C54). */
export const SAUCER_FIRE_INTERVAL_FRAMES = 10

/** Shot lifetime: 18 frames (ShpShotTimer $6d01: lda #18). */
export const SHOT_LIFETIME_FRAMES = 18
