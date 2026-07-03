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

/** The player's ship. Position only for now; heading/velocity arrive in A-3. */
export interface Ship {
  pos: Vec2
}

/** A rock's size tier — large rocks split into medium, medium into small. */
export type RockSize = 'large' | 'medium' | 'small'

export interface Rock {
  pos: Vec2
  size: RockSize
}

/** A player (or saucer) shot in flight. */
export interface Bullet {
  pos: Vec2
}

/** The flying-saucer enemy. */
export interface Saucer {
  pos: Vec2
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
    ship: { pos: { x: 0, y: 0 } },
    rocks: [],
    bullets: [],
    saucer: null,
  }
}
