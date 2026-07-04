// src/core/sim.ts
//
// The pure step. Deterministic: identical (state, input, dt) yields identical
// state. Time only ever enters here as `dt`; randomness only ever comes from
// `state.rng`. A-2 wired the loop (tick + RNG passthrough); A-3 added the
// ship's flight model; A-4 added firing; A-6 drifts the rocks. A-16 closes
// A-2's mode loop: attract is a rocks-drift backdrop a start press turns into a
// real game, and a final death runs the game-over/high-score framing before
// returning to attract. A-15 replaces A-16's terminal-death stub with the real
// lives model: a death with ships in reserve decrements and waits for a clear
// center to respawn (core/lives.ts) instead of ending the run.

import type { GameState, Rock, Bullet, Vec2 } from './state'
import { WORLD_W, WORLD_H, STARTING_LIVES, GAME_OVER_DISPLAY_S, initialState } from './state'
import type { Input } from './input'
import type { Rng } from './rng'
import { stepShip, SHIP_HITBOX } from './ship'
import { stepBullets } from './bullet'
import { updateRocks, splitRock, ROCK_HITBOX } from './rocks'
import { updateWaveDirector } from './waves'
import { updateSpawnDirector, stepSaucer, SAUCER_HITBOX, SAUCER_ROCK_COLLISION_ENABLED } from './saucer'
import { applyScore, addScore, SAUCER_SCORE } from './score'
import { insertHighScore } from './highscore'
import { handleShipDeath, tryRespawnShip } from './lives'
import { wrappedDelta, type Bounds } from './bounds'
import type { GameEvent } from './events'

/** A-18: the ambient heartbeat's tempo — fewer live rocks, faster beats. Pins
 * the RELATIONSHIP, not a ROM magnitude (no heartbeat quarry exists in this
 * checkout). verify vs quarry (A-17). */
const HEARTBEAT_INTERVAL_MAX_S = 1.0
const HEARTBEAT_INTERVAL_MIN_S = 0.3
const HEARTBEAT_ROCKS_FOR_MAX = 8

/** Interval until the next beat for a given live rock count — linearly
 * interpolated between the MIN (field nearly clear) and MAX (field full,
 * HEARTBEAT_ROCKS_FOR_MAX or more) tempos. */
function heartbeatInterval(rockCount: number): number {
  const t = Math.min(1, rockCount / HEARTBEAT_ROCKS_FOR_MAX)
  return HEARTBEAT_INTERVAL_MIN_S + t * (HEARTBEAT_INTERVAL_MAX_S - HEARTBEAT_INTERVAL_MIN_S)
}

/** Advance the ambient heartbeat one tick (play only) — the same arm/count/
 * fire-and-rearm shape as updateSpawnDirector/updateWaveDirector, so the
 * first eligible tick arms without beating rather than firing instantly. */
function withHeartbeat(state: GameState, dt: number): GameState {
  if (state.mode !== 'playing') return state
  if (state.heartbeatTimer <= 0) {
    return { ...state, heartbeatTimer: heartbeatInterval(state.rocks.length) }
  }
  const remaining = state.heartbeatTimer - dt
  if (remaining > 0) {
    return { ...state, heartbeatTimer: remaining }
  }
  const event: GameEvent = { type: 'heartbeat' }
  return { ...state, heartbeatTimer: heartbeatInterval(state.rocks.length), events: [...state.events, event] }
}

/** Append a saucer-siren start/stop event when the live saucer appears or
 * disappears between `before` (this frame's pre-saucer-step state) and
 * `after` (post spawn-director/stepSaucer). Scope note (A-18): only the
 * spawn/far-edge-despawn lifecycle is covered — a bullet-kill stop is A-13's
 * territory (see session Design Deviations). */
function withSirenEdge(before: GameState, after: GameState): GameState {
  const hadSaucer = before.saucer !== null
  const hasSaucer = after.saucer !== null
  if (hadSaucer === hasSaucer) return after
  const event: GameEvent = hadSaucer ? { type: 'saucer-siren-stop' } : { type: 'saucer-siren-start' }
  return { ...after, events: [...after.events, event] }
}

const WORLD_BOUNDS: Bounds = { width: WORLD_W, height: WORLD_H }

// Re-exported for compatibility: the constant moved to state.ts (A-15) so
// core/lives.ts can initialise the gameover phase without an import cycle.
export { GAME_OVER_DISPLAY_S }

/** Wrap-aware overlap: true when `a` and `b` are within `extent` on BOTH axes
 * across the toroidal field (an AABB of half-extent `extent`, measured by the
 * shortest seam-crossing displacement). */
function overlaps(a: Vec2, b: Vec2, extent: number): boolean {
  const d = wrappedDelta(a, b, WORLD_BOUNDS)
  return Math.abs(d.x) < extent && Math.abs(d.y) < extent
}

/** Does the segment p0→p1 pass through the origin-centred AABB of half-extent
 * `e` (|x| < e AND |y| < e)? Parametric slab clip: for each axis, narrow t to the
 * sub-interval of [0, 1] where that axis stays inside [−e, e]; a hit is a non-empty
 * intersection of the two axes' intervals. An axis with no motion (d === 0) is a
 * pass/fail on whether its constant coordinate is already inside the slab. */
function segmentHitsBox(p0: Vec2, p1: Vec2, e: number): boolean {
  let t0 = 0
  let t1 = 1
  for (const axis of ['x', 'y'] as const) {
    const a = p0[axis]
    const d = p1[axis] - a
    if (d === 0) {
      if (a <= -e || a >= e) return false // parallel to this slab and outside it
    } else {
      const ta = (-e - a) / d
      const tb = (e - a) / d
      t0 = Math.max(t0, Math.min(ta, tb))
      t1 = Math.min(t1, Math.max(ta, tb))
      if (t0 > t1) return false
    }
  }
  return true
}

/** Wrap-aware SWEPT overlap: true when the segment a bullet traversed THIS frame —
 * from its pre-move to its post-move position — comes within `extent` on both axes
 * of `target` (an AABB of half-extent `extent`). Endpoint-only testing tunnels: a
 * shot steps 111+ lo-units/frame, wider than a small rock's 84-unit window, so a
 * fast shot can start and end outside the box while its path crosses the rock.
 * Bullets fly at constant velocity, so the pre-move position is exactly the
 * post-move one minus this frame's travel (`vel * frames`); working in `target`'s
 * local delta frame keeps the whole test seam-aware without re-wrapping the segment
 * (it spans at most a couple hundred units, far shorter than the field). Degenerates
 * to `overlaps` when the bullet is motionless (start === end). */
function sweptOverlaps(pos: Vec2, vel: Vec2, target: Vec2, extent: number, frames: number): boolean {
  const end = wrappedDelta(pos, target, WORLD_BOUNDS) // post-move, seam-aware
  const start = { x: end.x - vel.x * frames, y: end.y - vel.y * frames } // pre-move, same local frame
  return segmentHitsBox(start, end, extent)
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
    events: [], // A-18: no gameplay-audio events in attract; never carry a stale frame's forward
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
  // A-18: no gameplay-audio events during gameover; `events: []` here (rather
  // than at each return below) guarantees every branch of this function gets
  // a fresh frame, never a carried-forward stale one.
  const base: GameState = { ...state, rng, tick: state.tick + 1, startPrev: input.start, events: [] }
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

  // A-15: a ship dead between lives is deaf and disarmed — it neither steers
  // nor spawns fresh shots — but shots already in flight keep flying and
  // aging. Forcing the fire shift-register high while dead suppresses the
  // spawn edge without forking stepBullets, and the returned firePrev still
  // tracks the physical button, so a press held across death -> respawn is
  // consumed exactly once (the startPrev precedent).
  //
  // Fire in the direction the ship now faces, inheriting its updated velocity.
  const shipAlive = !state.shipDestroyed
  const ship = shipAlive ? stepShip(state.ship, input, dt) : state.ship
  const { bullets, firePrev, fired } = stepBullets(
    state.bullets,
    ship,
    shipAlive ? state.firePrev : true,
    input,
    dt,
  )

  // A-18: this frame's gameplay-event channel. thrustPrev always tracks the
  // physical button (the firePrev precedent), but the EVENT itself is gated
  // on ship-alive — a dead ship's engine makes no sound.
  const events: GameEvent[] = []
  if (fired) events.push({ type: 'fire' })
  const thrustRisingEdge = shipAlive && input.thrust && !state.thrustPrev
  const thrustFallingEdge = shipAlive && !input.thrust && state.thrustPrev
  if (thrustRisingEdge) events.push({ type: 'thrust-start' })
  if (thrustFallingEdge) events.push({ type: 'thrust-stop' })

  let rocks = updateRocks(state.rocks, dt, WORLD_BOUNDS)
  let liveBullets: Bullet[] = bullets
  let score = state.score
  let lives = state.lives
  let saucer = state.saucer

  // The invulnerability window (A-15) decays by sim time FIRST, clamped at zero,
  // so its final tick still shields (checking pre-decay would stretch the window
  // a tick; float residue from repeated dt subtraction would stretch it further).
  // Decayed BEFORE the collision checks because A-13's new ship hazards (saucer
  // contact, saucer shot) consult the same gate as ship-vs-rock: a ship that is
  // invulnerable OR already dead is out of the collision-active set entirely.
  const shipSpawnTimer = Math.max(0, state.shipSpawnTimer - dt)
  const shipHittable = !state.shipDestroyed && shipSpawnTimer <= 0

  // Collision + destruction runs on the post-move positions. (Attract and
  // gameover take the early branches above, so this path IS play mode.) The
  // per-frame travel scalar (dt*60 = 1 at 60 Hz) — the SAME unit bullet.ts and
  // rocks.ts integrate by — feeds the SWEPT hit-test, which reconstructs each
  // shot's pre-move position so a fast shot can't tunnel a small target (see
  // sweptOverlaps). Both bullet↔saucer and saucer-bullet↔ship fly at 111
  // lo-units/frame, so both use the swept test, exactly as bullet↔rock does.
  const frames = dt * 60

  // One pass over every shot. A PLAYER shot destroys the FIRST rock it sweeps
  // (score its tier, then splitRock — a large/medium rock becomes children, a
  // small one despawns), else the saucer if it sweeps that (score by size via
  // A-9's addScore, remove the saucer); either way the shot is consumed. A
  // SAUCER shot destroys a hittable ship it sweeps and is consumed. Misses
  // survive. splitRock mutates this step's rng clone, threading the seed forward.
  const working: Rock[] = [...rocks]
  const survivors: Bullet[] = []
  let shipHitBySaucerShot = false
  for (const bullet of liveBullets) {
    if (bullet.owner === 'player') {
      const hit = working.findIndex((r) =>
        sweptOverlaps(bullet.pos, bullet.vel, r.pos, ROCK_HITBOX[r.size], frames),
      )
      if (hit !== -1) {
        const destroyed = working[hit]
        const awarded = applyScore(score, lives, destroyed.size)
        score = awarded.score
        lives = awarded.lives
        // A-18: the rock explosion cue, tagged with the destroyed rock's OWN
        // tier (children score/explode only when later shot). Restored here after
        // A-13's collision-loop restructure landed on top of A-18's event channel.
        events.push({ type: 'explosion', source: destroyed.size })
        working.splice(hit, 1, ...splitRock(destroyed, rng))
        continue // shot consumed by the rock
      }
      // No rock hit — a player shot may instead kill the saucer. Scored by size
      // via addScore (the SAME rollover + bonus-ship path as rocks; 200/1000 come
      // from A-9's canonical SAUCER_SCORE, not a literal here).
      if (
        saucer !== null &&
        sweptOverlaps(bullet.pos, bullet.vel, saucer.pos, SAUCER_HITBOX[saucer.size], frames)
      ) {
        const awarded = addScore(score, lives, SAUCER_SCORE[saucer.size])
        score = awarded.score
        lives = awarded.lives
        saucer = null // saucer destroyed by the shot
        continue // shot consumed
      }
      survivors.push(bullet)
    } else {
      // A saucer shot: destroys a hittable ship it sweeps (a path distinct from
      // direct saucer↔ship contact — different originating entity), else flies on.
      if (shipHittable && sweptOverlaps(bullet.pos, bullet.vel, ship.pos, SHIP_HITBOX, frames)) {
        shipHitBySaucerShot = true
        continue // shot consumed on the kill
      }
      survivors.push(bullet)
    }
  }
  rocks = working
  liveBullets = survivors

  // Ship destruction (all gated by shipHittable, so invulnerability shields
  // against every hazard): ramming a rock, DIRECT contact with the saucer
  // (mutual — the saucer dies too), or a saucer shot. Rocks/saucer-on-ram are
  // otherwise unaffected. Sticky once latched; revived only by tryRespawnShip.
  let shipDestroyed = state.shipDestroyed
  if (shipHittable) {
    const rammedRock = rocks.some((r) => overlaps(ship.pos, r.pos, SHIP_HITBOX + ROCK_HITBOX[r.size]))
    const sc = saucer
    const rammedSaucer = sc !== null && overlaps(ship.pos, sc.pos, SHIP_HITBOX + SAUCER_HITBOX[sc.size])
    if (rammedRock || rammedSaucer || shipHitBySaucerShot) {
      shipDestroyed = true
      if (rammedSaucer) saucer = null // mutual destruction
    }
  }

  // Saucer↔rock (flag-gated, A-13): the saucer is destroyed on contact with any
  // rock; the rock is unaffected (the minimal interpretation — verify vs quarry
  // A-17). A saucer already killed above (by a shot or ship contact) is null here.
  const scForRock = saucer
  if (SAUCER_ROCK_COLLISION_ENABLED && scForRock !== null) {
    const rammedByRock = rocks.some((r) =>
      overlaps(scForRock.pos, r.pos, SAUCER_HITBOX[scForRock.size] + ROCK_HITBOX[r.size]),
    )
    if (rammedByRock) saucer = null
  }
  // The destruction EDGE (not the sticky latch) is the explosion cue — fires
  // regardless of the lives-0 legacy niche (handleShipDeath's own guard,
  // below), since a real explosion happened this frame either way.
  if (!state.shipDestroyed && shipDestroyed) {
    events.push({ type: 'explosion', source: 'ship' })
    // A dead ship's engine goes silent (the intent behind the alive-gated thrust
    // events above). But the thrust-stop falling edge can never fire once dead,
    // so a ship that dies with thrust ENGAGED would leave its loop humming
    // through gameover/attract. Stop it here iff the loop is on this frame —
    // `input.thrust` covers both a held and a just-pressed thrust. A same-frame
    // RELEASE is not `input.thrust`, so its (still-alive) falling-edge stop
    // above is the only one — no double-stop.
    if (input.thrust) events.push({ type: 'thrust-stop' })
  }

  let stepped: GameState = {
    ...state,
    rng,
    tick: state.tick + 1,
    ship,
    rocks,
    bullets: liveBullets,
    saucer,
    score,
    lives,
    firePrev,
    thrustPrev: input.thrust,
    startPrev: input.start,
    shipDestroyed,
    shipSpawnTimer,
    events,
  }

  // A-15's death seam (replacing A-16's terminal stub): on the destruction
  // EDGE (not the sticky latch), one death has one consequence —
  // handleShipDeath decrements and keeps playing while ships remain, or ends
  // the run at zero exactly as A-16 pinned. The seam consumes the POST-award
  // lives, so a bonus ship earned by a shot in this same step is a real
  // reserve. The `lives > 0` guard preserves the legacy lives-0 free-play
  // niche (pre-A-16 fixtures): latch sticky, no decrement, no gameover.
  if (!state.shipDestroyed && shipDestroyed && lives > 0) {
    stepped = handleShipDeath(stepped)
  }

  // The respawn attempt runs every playing tick but on the PRE-step latch, so
  // a ship destroyed this very step spends at least one full tick dead before
  // it may reappear at a clear center (A-15). The wait is unbounded — a
  // crowded center just means trying again next tick.
  if (state.shipDestroyed) {
    stepped = tryRespawnShip(stepped)
  }

  // The saucer subsystem (play only): move/fire/despawn the live saucer, then let
  // the spawn director bring the next one when none is alive. Each clones the rng
  // itself, so draws thread forward without touching the caller's rng. Runs BEFORE
  // the wave director, whose "field clear" gate includes `saucer === null` — so a
  // live saucer holds off the next wave (A-10 forward-compat gate).
  const withSaucer = withSirenEdge(stepped, updateSpawnDirector(stepSaucer(stepped, dt), dt))

  // The wave director spawns the next wave once the field is clear (play only).
  // It runs on the post-step state and clones the rng itself, so any spawn draws
  // are threaded into the returned state without touching the caller's rng.
  return withHeartbeat(updateWaveDirector(withSaucer, dt), dt)
}
