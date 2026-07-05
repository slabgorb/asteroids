// src/core/lives.ts
//
// A-15: the lives model — death consequences, clear-center safe respawn, and
// the post-respawn invulnerability window. Replaces A-16's terminal-death
// stub (any destruction ended the run, reserves forfeit) with the real 1979
// rules. Pure: no DOM, no wall-clock, no entropy — respawn is a deterministic
// function of the field, so replays stay bit-identical.
//
// ROM research (6502disassembly.com/va-asteroids + computerarcheology.com —
// the same two sources as A-14's pass; full citations in
// sprint/context/context-story-A-15.md):
//  - Lives: 3 per game (init $6ED8, "Assume A 3 Ship Game"; a DIP at $2802
//    selects 4 — this free-play cabinet has no settings UI, so state.ts pins
//    STARTING_LIVES at 3).
//  - Respawn at the screen center (CenterShip; position bytes $0284/$02A7).
//  - The ROM gates reappearance on a position-dependent rock-count check
//    ($6EBB–$6EC4) whose exact semantics are unconfirmed; this clone ships a
//    GEOMETRIC clear-zone instead (nothing dangerous within a radius of the
//    center) as a deliberate, context-flagged deviation — the A-17 quarry
//    settles geometric-vs-count.
//  - Post-respawn invulnerability: the spawn timer at $02FA is set to $81
//    (129 frames) after a death, and "while non-zero, ship cannot be hit"
//    (routine $6980) — a SECOND mechanism layered on top of the clear-center
//    wait, not a restatement of it.

import type { GameState, Vec2 } from './state'
import { WORLD_W, WORLD_H, GAME_OVER_DISPLAY_S } from './state'
import { qualifiesForHighScore } from './highscore'

/** The respawn point: the world center (CenterShip, $0284/$02A7). */
const CENTER: Vec2 = { x: WORLD_W / 2, y: WORLD_H / 2 }

/** Radius of the geometric clear-zone around the center that must be free of
 * rocks / the saucer / saucer shots before a dead ship may reappear. Sized to
 * roughly a large rock's diameter (2 × ROCK_HITBOX.large), comfortably above
 * the instant-death floor (SHIP_HITBOX + ROCK_HITBOX.large) that
 * tests/lives.test.ts pins as the minimum. Provisional — the ROM's own check
 * appears count-based, not geometric. verify vs quarry (A-17). */
export const RESPAWN_CLEAR_RADIUS = 264

/** Seconds the respawned ship cannot be hit: spawn timer $02FA = $81 = 129
 * frames at 60 Hz, per the $6980 "while non-zero, ship cannot be hit" read.
 * The mechanism is corroborated by both sources; the byte value rests on one
 * routine-address citation. verify vs quarry (A-17). */
export const RESPAWN_INVULNERABILITY_S = 129 / 60

/** Nonzero spawn timer ⇒ the ship cannot be hit. The sim's ship-vs-rock check
 * (A-8) consults this before killing; A-14 (hyperspace) will reuse the same
 * field with its own $30 (48-frame) window. */
export function isInvulnerable(state: GameState): boolean {
  return state.shipSpawnTimer > 0
}

/** True when nothing dangerous sits within `radius` of the playfield center:
 * no rock, no saucer, no saucer shot. PLAYER shots are excluded by design —
 * A-4's finite bullet lifetime means a stale player shot never lingers long
 * enough to matter. Straight Euclidean distance is correct here: the center
 * is the one point a shortest path to which never crosses the toroidal seam. */
export function isCenterClear(state: GameState, radius: number): boolean {
  const within = (p: Vec2): boolean => Math.hypot(p.x - CENTER.x, p.y - CENTER.y) < radius
  if (state.rocks.some((r) => within(r.pos))) return false
  if (state.saucer !== null && within(state.saucer.pos)) return false
  return !state.bullets.some((b) => b.owner === 'saucer' && within(b.pos))
}

/** Consume one ship death — the single consumption point for every death
 * signal (A-8's rock collision today; A-13's saucer collisions and A-14's
 * failed hyperspace jump when they land). Called once per death EDGE, never
 * per tick. With ships in reserve: decrement and stay in play, the ship left
 * dead where it fell until tryRespawnShip revives it. On the last ship: end
 * the run exactly as A-16's gameover entry did — 'gameover' in the same step,
 * the phase initialised off the persisted board. */
export function handleShipDeath(state: GameState): GameState {
  const lives = state.lives - 1
  if (lives <= 0) {
    return {
      ...state,
      lives: 0,
      shipDestroyed: true,
      mode: 'gameover',
      // A2-3: the run end takes any live saucer with it. Once mode leaves
      // 'playing', stepSaucer/updateSpawnDirector mode-gate to no-ops and can
      // never remove it — clearing it HERE is what makes sim.ts's
      // withSirenEdge see the saucer leave on this final frame and emit the
      // saucer-siren-stop that silences the shell's siren loop (and stops the
      // renderer painting a frozen saucer under the GAME OVER card).
      saucer: null,
      gameOver: {
        qualifies: qualifiesForHighScore(state.highScoreTable, state.score),
        initials: '',
        confirmed: false,
        displayTimer: GAME_OVER_DISPLAY_S,
      },
    }
  }
  return { ...state, lives, shipDestroyed: true }
}

/** Revive a dead ship once it is safe: in play, ships in reserve, and the
 * center clear-zone empty. The ship reappears at the exact center, at rest,
 * nose-up (dir 64 — the same heading initialState deals), with the
 * invulnerability window armed. Anything else — blocked center, no reserves,
 * wrong mode, or a ship already alive — returns the state untouched; the
 * caller retries next tick, and the wait is deliberately unbounded. */
export function tryRespawnShip(state: GameState): GameState {
  if (state.mode !== 'playing') return state
  if (!state.shipDestroyed || state.lives <= 0) return state
  if (!isCenterClear(state, RESPAWN_CLEAR_RADIUS)) return state
  return {
    ...state,
    shipDestroyed: false,
    ship: { pos: { ...CENTER }, vel: { x: 0, y: 0 }, dir: 64, visible: true },
    shipSpawnTimer: RESPAWN_INVULNERABILITY_S,
  }
}
