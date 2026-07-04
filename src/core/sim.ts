// src/core/sim.ts
//
// The pure step. Deterministic: identical (state, input, dt) yields identical
// state. Time only ever enters here as `dt`; randomness only ever comes from
// `state.rng`. A-2 wired the loop (tick + RNG passthrough); A-3 added the
// ship's flight model; A-4 added firing; A-6 drifts the rocks. A-16 closes
// A-2's mode loop: attract is a rocks-drift backdrop a start press turns into a
// real game, and a final death runs the game-over/high-score framing before
// returning to attract.

import type { GameState, GameOverPhase, Mode, Rock, Bullet, Vec2 } from './state'
import { WORLD_W, WORLD_H, STARTING_LIVES, initialState } from './state'
import type { Input } from './input'
import type { Rng } from './rng'
import { stepShip, SHIP_HITBOX } from './ship'
import { stepBullets } from './bullet'
import { updateRocks, splitRock, ROCK_HITBOX } from './rocks'
import { updateWaveDirector } from './waves'
import { updateSpawnDirector, stepSaucer } from './saucer'
import { applyScore } from './score'
import { qualifiesForHighScore, insertHighScore } from './highscore'
import { wrappedDelta, type Bounds } from './bounds'

const WORLD_BOUNDS: Bounds = { width: WORLD_W, height: WORLD_H }

/** Seconds the non-qualifying GAME OVER card is displayed before the cabinet
 * returns to attract on its own. Provisional feel value — the ROM's exact
 * attract-page timings are A-17's quarry. verify vs quarry (A-17). */
export const GAME_OVER_DISPLAY_S = 3

/** Wrap-aware overlap: true when `a` and `b` are within `extent` on BOTH axes
 * across the toroidal field (an AABB of half-extent `extent`, measured by the
 * shortest seam-crossing displacement). */
function overlaps(a: Vec2, b: Vec2, extent: number): boolean {
  const d = wrappedDelta(a, b, WORLD_BOUNDS)
  return Math.abs(d.x) < extent && Math.abs(d.y) < extent
}

/** The attract branch: rocks keep drifting through the SAME A-6 mover the play
 * mode uses (never a parallel one), while the ship, guns, scoring, and
 * collisions are all inert regardless of held gameplay inputs. A fresh start
 * press deals a new game from initialState's field defaults — WITHOUT
 * re-seeding the rng: the cabinet draws from one stream across
 * attract→playing→attract cycles; only a hard page reload re-seeds. */
function stepAttract(state: GameState, input: Input, dt: number, startPressed: boolean): GameState {
  const rng: Rng = { seed: state.rng.seed }
  if (startPressed) {
    return {
      ...initialState(),
      rng,
      mode: 'playing',
      tick: state.tick + 1,
      lives: STARTING_LIVES,
      highScoreTable: state.highScoreTable, // the board outlives every run
      startPrev: input.start,
    }
  }
  return {
    ...state,
    rng,
    tick: state.tick + 1,
    rocks: updateRocks(state.rocks, dt, WORLD_BOUNDS),
    startPrev: input.start,
  }
}

/** The game-over branch. Qualifying path: hold for initials (typed via
 * enterInitial), then a fresh start press with all 3 letters confirms — insert
 * the entry and return to attract in the same step. Non-qualifying path: tick
 * the display card down and return to attract when it expires. */
function stepGameOver(
  state: GameState,
  input: Input,
  dt: number,
  startPressed: boolean,
): GameState {
  const rng: Rng = { seed: state.rng.seed }
  const base: GameState = { ...state, rng, tick: state.tick + 1, startPrev: input.start }
  const over = state.gameOver
  // Defensive: a gameover state with no phase (pre-A-16 fixtures) just idles.
  if (over === null) return base

  if (over.qualifies && !over.confirmed) {
    if (startPressed && over.initials.length === 3) {
      // The core builds the entry WITHOUT a date — the pure core never reads
      // the wall clock (core-boundary guard); `date?` is optional by design.
      return {
        ...base,
        mode: 'attract',
        gameOver: null,
        highScoreTable: insertHighScore(state.highScoreTable, {
          name: over.initials,
          score: state.score,
          wave: state.wave,
        }),
      }
    }
    return base
  }

  const displayTimer = over.displayTimer - dt
  if (displayTimer <= 0) return { ...base, mode: 'attract', gameOver: null }
  return { ...base, gameOver: { ...over, displayTimer } }
}

/** Type one initials character on the qualifying game-over screen. A PURE core
 * event function the shell calls per keydown — initials are edge events, not
 * per-frame held state, so they do not ride on Input (which stays the six
 * plain booleans). Uppercases, accepts A–Z only, caps at 3; inert in every
 * other mode/phase. */
export function enterInitial(state: GameState, char: string): GameState {
  if (state.mode !== 'gameover') return state
  const over = state.gameOver
  if (over === null || !over.qualifies || over.confirmed) return state
  if (over.initials.length >= 3) return state
  if (!/^[a-zA-Z]$/.test(char)) return state
  return { ...state, gameOver: { ...over, initials: over.initials + char.toUpperCase() } }
}

export function stepGame(state: GameState, input: Input, dt: number): GameState {
  // Start is edge-triggered (the firePrev pattern): a press held across a mode
  // transition is consumed by the transition and must not fire again.
  const startPressed = input.start && !state.startPrev

  if (state.mode === 'attract') return stepAttract(state, input, dt, startPressed)
  if (state.mode === 'gameover') return stepGameOver(state, input, dt, startPressed)

  // Clone the RNG so this step never mutates the caller's state — the one
  // exception to "never touch `state`, only read it": the clone is a fresh
  // mutable value threaded into the returned state, never the original.
  const rng: Rng = { seed: state.rng.seed }

  // Fire in the direction the ship now faces, inheriting its updated velocity.
  const ship = stepShip(state.ship, input, dt)
  const { bullets, firePrev } = stepBullets(state.bullets, ship, state.firePrev, input, dt)

  let rocks = updateRocks(state.rocks, dt, WORLD_BOUNDS)
  let liveBullets: Bullet[] = bullets
  let shipDestroyed = state.shipDestroyed
  let score = state.score
  let lives = state.lives

  // Collision + destruction runs on the post-move positions. (Attract and
  // gameover take the early branches above, so this path IS play mode.)
  //
  // Bullet-vs-rock: a shot destroys the FIRST rock it overlaps (one shot, one
  // rock) and is consumed. A large/medium rock becomes splitRock's children;
  // a small rock despawns to nothing (drawing no rng). splitRock mutates `rng`
  // — this step's own clone of state.rng — so the advanced seed is threaded
  // forward in the returned state, keeping the replay deterministic.
  const working: Rock[] = [...rocks]
  const survivors: Bullet[] = []
  for (const bullet of liveBullets) {
    // Only PLAYER shots destroy rocks; saucer shots (A-11) pass through — their
    // collisions (saucer-bullet vs ship, etc.) are A-13, not this story.
    if (bullet.owner !== 'player') {
      survivors.push(bullet)
      continue
    }
    const hit = working.findIndex((r) => overlaps(bullet.pos, r.pos, ROCK_HITBOX[r.size]))
    if (hit === -1) {
      survivors.push(bullet)
    } else {
      // A-9: score the destroyed rock's OWN tier (children are scored only
      // when they are later shot), then split it. applyScore also grants a
      // bonus ship for every 10000-point boundary this award crosses. A child
      // spawned this frame that a later bullet hits is a real, separate
      // destruction and scores its own tier — no rock is ever counted twice.
      const destroyed = working[hit]
      const awarded = applyScore(score, lives, destroyed.size)
      score = awarded.score
      lives = awarded.lives
      working.splice(hit, 1, ...splitRock(destroyed, rng))
    }
  }
  rocks = working
  liveBullets = survivors

  // Ship-vs-rock: overlapping any rock destroys the ship. Rocks are unaffected
  // — ramming does not split them (that is a bullet's job). Sticky: once true
  // it stays true until A-15's respawn/invuln clears it.
  if (!shipDestroyed) {
    shipDestroyed = rocks.some((r) => overlaps(ship.pos, r.pos, SHIP_HITBOX + ROCK_HITBOX[r.size]))
  }

  // A-16's stub of the A-15 death seam: on the destruction EDGE (not the sticky
  // latch), spend a ship; with none left, enter 'gameover' in this same step,
  // deciding the qualifying path off the persisted board. The `lives > 0` guard
  // keeps legacy lives-0 free-play states (every pre-A-16 fixture) latching the
  // old sticky flag without a mode change. A-15 replaces the no-respawn part —
  // decrement + safe-respawn while ships remain — keeping this lives-0 edge.
  let mode: Mode = state.mode
  let gameOver: GameOverPhase | null = state.gameOver
  if (!state.shipDestroyed && shipDestroyed && lives > 0) {
    lives -= 1
    if (lives === 0) {
      mode = 'gameover'
      gameOver = {
        qualifies: qualifiesForHighScore(state.highScoreTable, score),
        initials: '',
        confirmed: false,
        displayTimer: GAME_OVER_DISPLAY_S,
      }
    }
  }

  const stepped: GameState = {
    ...state,
    rng,
    tick: state.tick + 1,
    mode,
    gameOver,
    ship,
    rocks,
    bullets: liveBullets,
    score,
    lives,
    firePrev,
    startPrev: input.start,
    shipDestroyed,
  }

  // The saucer subsystem (play only): move/fire/despawn the live saucer, then let
  // the spawn director bring the next one when none is alive. Each clones the rng
  // itself, so draws thread forward without touching the caller's rng. Runs BEFORE
  // the wave director, whose "field clear" gate includes `saucer === null` — so a
  // live saucer holds off the next wave (A-10 forward-compat gate).
  const withSaucer = updateSpawnDirector(stepSaucer(stepped, dt), dt)

  // The wave director spawns the next wave once the field is clear (play only).
  // It runs on the post-step state and clones the rng itself, so any spawn draws
  // are threaded into the returned state without touching the caller's rng.
  return updateWaveDirector(withSaucer, dt)
}
