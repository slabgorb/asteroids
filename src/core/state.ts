// src/core/state.ts
//
// The complete game state. Everything stepGame() needs lives here — including
// the RNG seed — so the simulation is a pure function of (state, input, dt).
//
// A-2 lays the spine only: the full shape is declared now so later stories
// extend fields rather than restructure the type, but entity contents stay
// minimal (a position, and for a rock a size tier) since flight/physics/
// splitting/firing arrive in A-3+.

import { createRng, type Rng } from '@arcade/shared/rng'
import type { HighScoreTable } from './highscore'
import type { GameEvent } from './events'

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
  /** A-14: false while a hyperspace jump is in flight (the ship is gone from the
   * playfield during its reappearance window, GameState.shipSpawnTimer); true
   * otherwise. A-15's respawn-invulnerability window keeps the ship visible, so
   * only hyperspace sets this false. The renderer skips a hidden ship. */
  visible: boolean
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

/** A2-5: one drifting, fading piece of the ship's silhouette, spawned when the
 * ship is destroyed — one per rendered polygon edge (shipShape.ts). `p1`/`p2`
 * are the segment's two endpoints (world-space); `vel` is world-units per 60
 * Hz frame, the same unit as Ship.vel/Rock.velocity; `life` is remaining
 * seconds before the piece is dropped. */
export interface ShipDebrisSegment {
  p1: Vec2
  p2: Vec2
  vel: Vec2
  life: number
}

/** A2-8: one dot of the rock-break shrapnel scatter (core/shrapnel.ts). The ROM
 * draws this dim, short-lived burst on EVERY object explosion. `pos` is the dot's
 * world-space position (it starts at the impact point and spreads outward);
 * `vel` is world-units per 60 Hz frame (the Ship.vel/Rock.velocity unit) — a
 * small outward drift, NOT the destroyed rock's velocity, so the burst stays
 * anchored; `life` is remaining seconds before the dot is dropped. A POINT, not
 * a p1/p2 segment (contrast ShipDebrisSegment). */
export interface Shrapnel {
  pos: Vec2
  vel: Vec2
  life: number
}

/** A saucer's size tier. The LARGE variant (A-11) crosses and fires at random
 * headings; the SMALL variant (A-12) aims at the ship with an accuracy that
 * ramps up with the score. A-13 scores the two differently (200 vs 990/1000)
 * and drives the siren pitch from which one is alive. */
export type SaucerSize = 'large' | 'small'

/** The flying-saucer enemy. `velocity` is world-units per 60 Hz frame — a
 * constant horizontal crossing speed plus a vertical component rerolled on the
 * course cadence. `size` is fixed at spawn (A-12): 'large' sprays random shots,
 * 'small' aims at the ship. `courseTimer`/`fireTimer` are the per-saucer
 * countdowns (seconds) to the next vertical-course reroll and the next shot. */
export interface Saucer {
  pos: Vec2
  velocity: Vec2
  size: SaucerSize
  courseTimer: number
  fireTimer: number
}

/** Run lifecycle: the cabinet idles on attract, plays a run, then game-over. */
export type Mode = 'attract' | 'playing' | 'gameover'

/** Ships dealt out on a start press. The ROM default is 3 (init $6ED8,
 * "Assume A 3 Ship Game"); a DIP switch at $2802 (CentCMShipsSw) selects a
 * 4-ship game instead — this free-play cabinet has no settings UI, so the
 * value is fixed at 3 rather than configurable. A-15 landed the lives model
 * that spends these (decrement + clear-center respawn + invulnerability —
 * core/lives.ts). */
export const STARTING_LIVES = 3

/** Seconds the non-qualifying GAME OVER card is displayed before the cabinet
 * returns to attract on its own. Provisional feel value — the ROM's exact
 * attract-page timings are A-17's quarry. verify vs quarry (A-17). Lives here
 * (not sim.ts) so core/lives.ts can initialise the gameover phase without a
 * sim <-> lives import cycle; sim.ts re-exports it. */
export const GAME_OVER_DISPLAY_S = 3

/** The game-over phase, nested under GameState (A-16) — A-2's Mode union is NOT
 * extended for "entering initials"; that sub-state lives here instead. `null`
 * outside 'gameover' mode. On the qualifying path the player types up to 3
 * initials (sim.ts enterInitial) and confirms with the start button; on the
 * non-qualifying path `displayTimer` counts down (seconds) and the cabinet
 * returns to attract on its own. */
export interface GameOverPhase {
  /** qualifiesForHighScore(highScoreTable, score), computed once on entry. */
  qualifies: boolean
  /** Initials typed so far (0-3 chars, uppercase A-Z). */
  initials: string
  /** Reserved for a confirmed-but-still-displaying state; the current flow
   * returns to attract in the same step as the confirm. */
  confirmed: boolean
  /** Seconds left on the non-qualifying GAME OVER display. */
  displayTimer: number
}

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
  /** A2-5: the ship's breakup debris, live between destruction and full fade.
   * Purely cosmetic — never consulted by collision or the respawn clear-zone
   * check (lives.ts isCenterClear). */
  shipDebris: ShipDebrisSegment[]
  /** A2-8: the rock-break shrapnel scatter, live between a rock's destruction and
   * its full fade. Purely cosmetic — never consulted by collision or the respawn
   * clear-zone check. Spawned RNG-free so a break never perturbs the spawn stream. */
  shrapnel: Shrapnel[]
  /** A-21: the saucer's breakup debris, live between a destroyed saucer and its
   * full fade — the same drifting/fading line segments the ship fractures into
   * (ShipDebrisSegment reused). Spawned RNG-FREE (a saucer death must not perturb
   * the wave/saucer spawn stream, cf. shrapnel/A2-8). Purely cosmetic — never
   * consulted by collision or the respawn clear-zone check (lives.ts isCenterClear). */
  saucerDebris: ShipDebrisSegment[]
  saucer: Saucer | null
  /** Previous frame's fire-button state — the shift-register debounce that makes
   * firing edge-triggered (A-4, ShipBulletSR $63): a shot spawns only on a fresh
   * low→high press, so holding fire does not auto-fire. */
  firePrev: boolean
  /** A-8: latched true once the ship is destroyed by a rock collision. Sticky
   * while dead: a dead ship is out of the collision-active set, deaf to input,
   * and gun-silent until A-15's tryRespawnShip revives it at a clear center
   * (or the run ends). `ship` stays non-null (a single-ship model, not a
   * list), so this flag is the "removed from the active list" signal. */
  shipDestroyed: boolean
  /** A-15: seconds of post-respawn invulnerability remaining — while nonzero
   * the ship cannot be hit (the ROM spawn timer at $02FA; armed to
   * RESPAWN_INVULNERABILITY_S by tryRespawnShip, decays by dt, clamped at 0).
   * A-14 (hyperspace) will reuse this field with its own $30 window. */
  shipSpawnTimer: number
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
  /** A-16: previous frame's start-button state — the same shift-register
   * debounce as firePrev, so attract-start and initials-confirm each consume a
   * fresh press and a button held across a mode transition fires only once. */
  startPrev: boolean
  /** A-16: the game-over phase; `null` outside 'gameover' mode. */
  gameOver: GameOverPhase | null
  /** A-16: the high-score board. The shell loads it from localStorage at boot
   * and persists it on change; inside the core it is ordinary deterministic
   * state (qualify on gameover entry, insert on confirm). */
  highScoreTable: HighScoreTable
  /** A-18: previous frame's thrust-button state — the same shift-register
   * debounce as firePrev/startPrev, so the shell can loop a sustained engine
   * hum spanning exactly the held interval instead of retriggering every
   * frame. Always tracks the physical button (even while the ship is dead),
   * mirroring firePrev's precedent; the emitted thrust-start/stop EVENT is
   * separately gated on ship-alive in sim.ts. */
  thrustPrev: boolean
  /** A-14: previous frame's hyperspace-button state — the same shift-register
   * debounce as firePrev/thrustPrev/startPrev. Makes the jump EDGE-triggered: a
   * held key fires one jump, not a fresh jump every tick once the reappearance
   * window closes. */
  hyperspacePrev: boolean
  /** A-18: seconds remaining before the next ambient heartbeat beat (play
   * only). `0` means "not counting" (boot, or just beat) — the same
   * arm-then-count convention as waveTransitionTimer/saucerSpawnTimer. Tempo
   * is a function of live rock count, recomputed each time it re-arms. */
  heartbeatTimer: number
  /** A-18: this frame's gameplay-event channel, drained by the shell's audio
   * dispatch. Fresh every step — never accumulates across frames. */
  events: GameEvent[]
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
      // A boot ship is on the playfield; only a hyperspace jump hides it (A-14).
      visible: true,
    },
    rocks: [],
    bullets: [],
    // No ship has died yet at boot (A2-5).
    shipDebris: [],
    // No rock has broken yet at boot (A2-8).
    shrapnel: [],
    // No saucer has been destroyed yet at boot (A-21).
    saucerDebris: [],
    saucer: null,
    // Fire not held at boot, so the very first press reads as a rising edge.
    firePrev: false,
    // Ship starts alive; a rock collision (A-8) latches this true.
    shipDestroyed: false,
    // Boot ship is dealt alive and mortal — the invulnerability window arms
    // only on a respawn (A-15).
    shipSpawnTimer: 0,
    // `0` = not counting; once play begins the wave director arms this and counts
    // it down, spawning wave 1 after WAVE_DELAY_S via the same path as every later
    // transition (no special first-spawn branch) (A-10).
    waveTransitionTimer: 0,
    // `0` = not counting; the spawn director arms/counts/spawns the first saucer
    // the same way once play begins with the ship alive (A-11).
    saucerSpawnTimer: 0,
    // Start not held at boot, so the very first press reads as a rising edge (A-16).
    startPrev: false,
    // Boot idles on attract with no game-over phase; the shell replaces the empty
    // board with whatever localStorage holds (A-16).
    gameOver: null,
    highScoreTable: [],
    // Thrust not held at boot, so the very first press reads as a rising edge (A-18).
    thrustPrev: false,
    // Hyperspace not held at boot, so the very first press reads as a rising edge (A-14).
    hyperspacePrev: false,
    // `0` = not counting; the first playing tick arms it without beating, exactly
    // like saucerSpawnTimer's first-eligible-frame convention (A-18).
    heartbeatTimer: 0,
    // No event fires before the first step (A-18).
    events: [],
  }
}
