// src/core/state.ts
//
// The complete game state. Everything stepGame() needs lives here — including
// the RNG seed — so the simulation is a pure function of (state, input, dt).
//
// A-2 lays the spine only: the full shape is declared now so later stories
// extend fields rather than restructure the type, but entity contents stay
// minimal (a position, and for a rock a size tier) since flight/physics/
// splitting/firing arrive in A-3+.

import { createRng, type Rng } from './rng'

/** Screen-space position. 2D, top-down — no third axis in this cabinet. */
export interface Vec2 {
  x: number
  y: number
}

// The toroidal playfield, in ROM lo-units (8 per screen pixel at 1024x768).
// UpdateObjPos ($6fc7) wraps X mod $20 hi-units and Y at $18 hi-units:
// 32*256 x 24*256. Wrap is a sim concern — never a render trick.
export const WORLD_W = 8192
export const WORLD_H = 6144

/** The player's ship (A-3). `vel` is world-units per 60 Hz frame; `dir` is a
 * 256-unit circle (ShipDir byte), 0 = +x, counterclockwise positive. */
export interface Ship {
  pos: Vec2
  vel: Vec2
  dir: number
}

/** A rock's size tier — large rocks split into medium, medium into small. */
export type RockSize = 'large' | 'medium' | 'small'

/** An asteroid (A-6). ROM-confirmed: rocks never turn — their position
 * updates are pure velocity accumulation ($6FCA-$7013) and only the ship has
 * a facing byte — so there is deliberately no such field here. */
export interface Rock {
  pos: Vec2
  /** Drift, world-units per 60 Hz frame — the same unit as Ship.vel/Bullet.vel. */
  velocity: Vec2
  size: RockSize
  /** Fixed visual identity in [0, ROCK_SHAPE_VARIANT_COUNT), chosen at spawn
   * and never changed afterwards (rocks.ts owns the count). */
  shapeVariant: number
}

/** A player (or saucer) shot in flight (A-4). `vel` is world-units per 60 Hz
 * frame (the ship's velocity plus the muzzle velocity — momentum is inherited);
 * `life` is the remaining lifetime in frames, counting down to removal. */
export interface Bullet {
  pos: Vec2
  vel: Vec2
  life: number
  /** Who fired it (A-11). Player and saucer shots share one `state.bullets`
   * array; the discriminant keeps their caps independent (A-4's 4-shot cap vs
   * SAUCER_MAX_BULLETS) and lets collision routing filter by owner (A-13). */
  owner: 'player' | 'saucer'
}

/** The flying-saucer enemy (A-11: the large variant). `velocity` is world-units
 * per 60 Hz frame — a constant horizontal crossing speed plus a vertical
 * component rerolled on the course cadence. `courseTimer`/`fireTimer` are the
 * per-saucer countdowns (seconds) to the next vertical-course reroll and the
 * next shot. A-12 adds a `size` discriminant; this story is large-only. */
export interface Saucer {
  pos: Vec2
  velocity: Vec2
  courseTimer: number
  fireTimer: number
}

/** Run lifecycle: the cabinet idles on attract, plays a run, then game-over. */
export type Mode = 'attract' | 'playing' | 'gameover'

export interface GameState {
  rng: Rng
  mode: Mode
  /** Integer step counter — advances by 1 each `stepGame` call. This story's
   * stand-in for "elapsed time"; no entity behaviour reads it yet. */
  tick: number
  wave: number
  score: number
  lives: number
  ship: Ship
  rocks: Rock[]
  bullets: Bullet[]
  saucer: Saucer | null
  /** Previous frame's fire-button state — the shift-register debounce that makes
   * firing edge-triggered (A-4, ShipBulletSR $63): a shot spawns only on a fresh
   * low→high press, so holding fire does not auto-fire. */
  firePrev: boolean
  /** A-8: latched true once the ship is destroyed by a rock collision. Sticky —
   * a dead ship is out of the collision-active set until A-15 (respawn/invuln)
   * clears it. `ship` stays non-null (a single-ship model, not a list), so this
   * flag is the "removed from the active list" signal. */
  shipDestroyed: boolean
  /** A-10: seconds remaining before the wave director spawns the next wave.
   * `0` means "not counting" (boot, or a wave in progress). The director arms it
   * to `WAVE_DELAY_S` the first tick it finds the field clear, counts it down each
   * tick after, and re-arms it when a wave spawns — so every inter-wave gap is a
   * uniform delay, never an instant respawn. */
  waveTransitionTimer: number
  /** A-11: seconds remaining before the spawn director may spawn the next large
   * saucer. `0` means "not counting" (boot, or a saucer just cleared); the
   * director arms it to a wave-scaled reload the first tick it finds no saucer +
   * a live ship, counts it down, and spawns one saucer when it elapses. Only one
   * saucer lives at a time, so the timer rests while `saucer !== null`. */
  saucerSpawnTimer: number
}

const DEFAULT_SEED = 1979

export function initialState(seed: number = DEFAULT_SEED): GameState {
  return {
    rng: createRng(seed),
    mode: 'attract',
    tick: 0,
    wave: 0,
    score: 0,
    lives: 0,
    // Center spawn, pointing up (dir 64 of 256), at rest — the ROM zeroes
    // ShipXSpeed/ShipYSpeed on spawn ($6b30).
    ship: {
      pos: { x: WORLD_W / 2, y: WORLD_H / 2 },
      vel: { x: 0, y: 0 },
      dir: 64,
    },
    rocks: [],
    bullets: [],
    saucer: null,
    // Fire not held at boot, so the very first press reads as a rising edge.
    firePrev: false,
    // Ship starts alive; a rock collision (A-8) latches this true.
    shipDestroyed: false,
    // `0` = not counting; once play begins the wave director arms this and counts
    // it down, spawning wave 1 after WAVE_DELAY_S via the same path as every later
    // transition (no special first-spawn branch) (A-10).
    waveTransitionTimer: 0,
    // `0` = not counting; the spawn director arms/counts/spawns the first saucer
    // the same way once play begins with the ship alive (A-11).
    saucerSpawnTimer: 0,
  }
}
