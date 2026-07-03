// src/core/waves.ts
//
// A-10: the WAVE DIRECTOR — how many rocks each wave spawns, where they appear,
// and when the next wave begins. Rocks-only: A-9 scoring, A-11+ saucers, and A-4
// bullets live elsewhere. The saucer half of the spawn gate is a
// forward-compatible no-op until a live saucer exists (A-11+).
//
// Determinism: no wall-clock, no Math.random — all randomness flows through the
// passed Rng, which advances IN PLACE (exactly like spawnRock / splitRock). Any
// caller inside stepGame must therefore clone state.rng before spawning;
// updateWaveDirector does this itself.
//
// Provisional constants carry `verify vs quarry (A-17)` markers where the ROM
// fetch (computerarcheology.com + 6502disassembly.com) was inconclusive.

import type { GameState, Rock, Vec2 } from './state'
import { WORLD_W, WORLD_H } from './state'
import type { Bounds } from './bounds'
import { nextFloat, nextInt, type Rng } from './rng'
import { ROCK_SHAPE_VARIANT_COUNT, ROCK_SPEED_MIN, ROCK_SPEED_MAX } from './rocks'

/** Wave-1 rock count, the per-wave increment, and the hard cap
 * (epic-established; the ROM fetch excerpts were noisy — verify vs quarry (A-17)). */
export const STARTING_ROCKS_BASE = 4
export const STARTING_ROCKS_PER_WAVE = 2
export const STARTING_ROCKS_CAP = 11

/** The engine's on-screen object budget (rocks + ship + saucer + bullets). The
 * ROM-side meaning was ambiguous across sources; retained as our own guard
 * number regardless (verify vs quarry (A-17)). */
export const MAX_OBJECTS_ON_SCREEN = 27

/** Seconds between clearing the field and the next wave appearing. Two
 * differently-addressed ROM timers land near ~2s @ 60Hz; exact cadence
 * unconfirmed — provisional, verify vs quarry (A-17). */
export const WAVE_DELAY_S = 2

/** World-space playfield bounds. Mirrors the per-module local const in sim.ts /
 * ship.ts — the epic hasn't extracted a shared bounds export yet, so this
 * follows the established local-const convention rather than introducing one. */
const WORLD_BOUNDS: Bounds = { width: WORLD_W, height: WORLD_H }

/** How many large rocks wave `wave` spawns: 4, then +2 each wave, capped at 11. */
export function waveRockCount(wave: number): number {
  return Math.min(STARTING_ROCKS_BASE + STARTING_ROCKS_PER_WAVE * (wave - 1), STARTING_ROCKS_CAP)
}

/** A spawn point on the playfield edge, plus a drift heading (radians). */
export interface EdgeSpawn {
  position: Vec2
  heading: number
}

/** Pick a spawn on one of the four playfield edges (uniformly along the chosen
 * edge) with a uniform drift heading in [0, 2π). Edge-only placement keeps new
 * rocks maximally far from the centre-spawned ship — "ship-safe by construction",
 * not an explicit proximity check. Consumes (advances) the passed rng. */
export function pickEdgeSpawn(rng: Rng, bounds: Bounds): EdgeSpawn {
  const edge = nextInt(rng, 4)
  const along = nextFloat(rng)
  const heading = nextFloat(rng) * 2 * Math.PI
  let position: Vec2
  switch (edge) {
    case 0: // top edge — y pinned to 0
      position = { x: along * bounds.width, y: 0 }
      break
    case 1: // bottom edge — y pinned to height
      position = { x: along * bounds.width, y: bounds.height }
      break
    case 2: // left edge — x pinned to 0
      position = { x: 0, y: along * bounds.height }
      break
    default: // right edge — x pinned to width
      position = { x: bounds.width, y: along * bounds.height }
      break
  }
  return { position, heading }
}

/** Spawn a full wave of large rocks at playfield edges: `waveRockCount(wave)` of
 * them, each drifting from its edge at a random heading with a large-tier speed.
 * Splitting into medium/small during play is A-7's job, never wave start.
 * Consumes (advances) the passed rng — deterministic per seed. */
export function spawnWave(wave: number, rng: Rng, bounds: Bounds): Rock[] {
  const count = waveRockCount(wave)
  const rocks: Rock[] = []
  for (let i = 0; i < count; i++) {
    const { position, heading } = pickEdgeSpawn(rng, bounds)
    const speed =
      ROCK_SPEED_MIN.large + nextFloat(rng) * (ROCK_SPEED_MAX.large - ROCK_SPEED_MIN.large)
    const shapeVariant = nextInt(rng, ROCK_SHAPE_VARIANT_COUNT)
    rocks.push({
      pos: position,
      velocity: { x: Math.cos(heading) * speed, y: Math.sin(heading) * speed },
      size: 'large',
      shapeVariant,
    })
  }
  return rocks
}

/** Advance the wave director one tick. Runs during play only (mirrors A-3's
 * updateShip gating). When the field is clear — no rocks AND, forward-compatibly,
 * no saucer — it:
 *   1. ARMS a fresh `WAVE_DELAY_S` countdown the first tick it finds the field
 *      clear (timer at/below 0, i.e. "not counting") — without spawning or
 *      drawing, so a just-cleared field always waits rather than respawning on
 *      the same tick it emptied,
 *   2. counts that timer down each tick thereafter, and
 *   3. once it elapses, spawns the next wave and re-arms the timer — so every
 *      inter-wave gap is a uniform delay.
 * While a wave (or a live saucer) is in progress the director rests.
 *
 * Pure: never mutates the input state. Clones state.rng before spawning (spawnWave
 * advances the rng in place) and threads the advanced clone into the returned
 * state, keeping replays deterministic. */
export function updateWaveDirector(state: GameState, dt: number): GameState {
  if (state.mode !== 'playing') return state
  if (state.rocks.length === 0 && state.saucer === null) {
    // Not counting yet (boot, or the field just cleared): arm a fresh delay,
    // without spawning or drawing rng, so the transition is never instant.
    if (state.waveTransitionTimer <= 0) {
      return { ...state, waveTransitionTimer: WAVE_DELAY_S }
    }
    const remaining = state.waveTransitionTimer - dt
    if (remaining > 0) {
      return { ...state, waveTransitionTimer: remaining }
    }
    const rng: Rng = { seed: state.rng.seed }
    const wave = state.wave + 1
    const rocks = spawnWave(wave, rng, WORLD_BOUNDS)
    return { ...state, rng, wave, rocks, waveTransitionTimer: WAVE_DELAY_S }
  }
  return state
}
