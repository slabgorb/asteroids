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

import type { GameState, Rock, Bullet, Vec2, Saucer } from './state'
import { WORLD_W, WORLD_H, STARTING_LIVES, GAME_OVER_DISPLAY_S, initialState } from './state'
import type { Input } from './input'
import type { Rng } from '@arcade/shared/rng'
import { stepShip, SHIP_HITBOX } from './ship'
import { stepBullets } from './bullet'
import { updateRocks, splitRock, ROCK_HITBOX } from './rocks'
import { breakShip, updateShipDebris } from './shipDebris'
import { breakSaucer } from './saucerDebris'
import { spawnShrapnel, updateShrapnel } from './shrapnel'
import { updateWaveDirector } from './waves'
import { updateSpawnDirector, stepSaucer, SAUCER_HITBOX, SAUCER_ROCK_COLLISION_ENABLED } from './saucer'
import { applyScore, addScore, SAUCER_SCORE } from './score'
import { insertHighScore } from '@arcade/shared/highscore'
import { handleShipDeath, tryRespawnShip } from './lives'
import { triggerHyperspace } from './hyperspace'
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

/** Append a saucer-siren start/stop event when the saucer appears or disappears
 * across the WHOLE frame — comparing the INCOMING saucer (`incomingSaucer`,
 * before any of this frame's collisions) to the FINAL one (`after`, post
 * collision + stepSaucer + spawn director). Comparing the incoming state (not
 * the post-collision one) is what makes the stop fire for EVERY way a saucer
 * dies — a bullet kill, a ram, or a rock collision (all A-13), plus the
 * far-edge despawn (A-11) — not just the despawn. The start carries the new
 * saucer's size so the shell picks the big vs small siren. */
function withSirenEdge(incomingSaucer: Saucer | null, after: GameState): GameState {
  const had = incomingSaucer !== null
  const next = after.saucer
  if (had === (next !== null)) return after
  const event: GameEvent =
    next !== null
      ? { type: 'saucer-siren-start', size: next.size }
      : { type: 'saucer-siren-stop' }
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
    // A2-5: keep ship-death debris drifting/fading even in attract — a run-
    // ending death's wreckage can outlive the game-over card and carry into
    // the following attract loop, and must not freeze there (a fresh cabinet's
    // debris is [], so this is a no-op unless a prior run left live segments).
    shipDebris: updateShipDebris(state.shipDebris, dt),
    // A2-8: age rock-break shrapnel here too — a break just before a run-ending
    // death can leave a scatter still animating into attract; it must keep fading,
    // not freeze (the same cross-mode-aging rule as shipDebris).
    shrapnel: updateShrapnel(state.shrapnel, dt),
    // A-21: age saucer-death debris here too — a saucer killed just before a
    // run-ending death can leave wreckage animating into attract; same rule.
    saucerDebris: updateShipDebris(state.saucerDebris, dt),
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
  // A2-5: age ship-death debris here too — a final death flips straight to
  // 'gameover', so this branch (not the 'playing' pipeline) is what must keep
  // the wreckage drifting/fading through the entire GAME OVER card. Every
  // return below derives from `base`, so aging once here covers them all.
  const base: GameState = {
    ...state,
    rng,
    tick: state.tick + 1,
    shipDebris: updateShipDebris(state.shipDebris, dt),
    // A2-8: keep rock-break shrapnel fading through the GAME OVER card too (same
    // cross-mode-aging rule as shipDebris — every branch below derives from base).
    shrapnel: updateShrapnel(state.shrapnel, dt),
    // A-21: keep saucer-death debris fading through the GAME OVER card too.
    saucerDebris: updateShipDebris(state.saucerDebris, dt),
    startPrev: input.start,
    events: [],
  }
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

export function stepGame(
  inState: GameState,
  input: Input,
  dt: number,
  turnRate?: number,
): GameState {
  // `state` is rebindable: A-14 rebinds it to the post-hyperspace state below,
  // so the rest of the step (collisions, death, respawn) reads the jumped ship.
  let state = inState

  // Start is edge-triggered (the firePrev pattern): a press held across a mode
  // transition is consumed by the transition and must not fire again.
  const startPressed = input.start && !state.startPrev

  if (state.mode === 'attract') return stepAttract(state, input, dt, startPressed)
  if (state.mode === 'gameover') return stepGameOver(state, input, dt, startPressed)

  // A-14: apply the hyperspace jump FIRST — before the rng clone and every
  // collision check — so a successful jump's invulnerability window (or a failed
  // jump's death) takes the ship out of the hit set THIS tick, and the survival/
  // position rolls consume the head of this step's rng stream. Rebind `state` to
  // the post-jump result; capture the PRE-jump death latch for the respawn gate,
  // so a ship killed by a failed jump still spends one full tick dead before
  // A-15 revives it — the same one-tick-dead rule as a collision death.
  //
  // A2-3 (Reviewer H-1): a failed jump's death runs THROUGH handleShipDeath
  // right here, which on the last life already nulls `state.saucer` as a side
  // effect — so `incomingSaucer` must be captured BEFORE this call, the same
  // way `wasDeadBefore` is, or withSirenEdge's incoming/final comparison below
  // sees the saucer already gone on both sides and never fires the stop.
  const wasDeadBefore = state.shipDestroyed
  const incomingSaucer = state.saucer
  state = triggerHyperspace(state, input)

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
  const ship = shipAlive ? stepShip(state.ship, input, dt, turnRate) : state.ship
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
  let shipDebris = updateShipDebris(state.shipDebris, dt)
  let saucerDebris = updateShipDebris(state.saucerDebris, dt)
  let shrapnel = updateShrapnel(state.shrapnel, dt)
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
        // A2-8: the visual twin of the explosion cue — every rock break (large,
        // medium, AND the small tier that despawns with no children) scatters a
        // dim, short-lived shrapnel burst at the break point. RNG-FREE by design
        // (spawnShrapnel takes only a position): a break must not consume the
        // rng clone, or it would shift the wave/saucer spawn stream (cf. A2-6).
        shrapnel = [...shrapnel, ...spawnShrapnel(destroyed.pos)]
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
        // A-21: fracture the saucer into drifting/fading debris (RNG-FREE, so the
        // spawn stream is untouched) BEFORE nulling it — the visual twin of a kill.
        saucerDebris = [...saucerDebris, ...breakSaucer(saucer)]
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
      if (rammedSaucer && sc !== null) {
        // A-21: mutual destruction — the saucer breaks up too (RNG-FREE).
        saucerDebris = [...saucerDebris, ...breakSaucer(sc)]
        saucer = null
      }
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
    if (rammedByRock) {
      // A-21: a rock kill fractures the saucer too (RNG-FREE, so state.rng.seed
      // is untouched — the wave/saucer spawn stream must not shift on a death).
      saucerDebris = [...saucerDebris, ...breakSaucer(scForRock)]
      saucer = null
    }
  }
  // The destruction EDGE (not the sticky latch) is the explosion cue — fires
  // regardless of the lives-0 legacy niche (handleShipDeath's own guard,
  // below), since a real explosion happened this frame either way. Gated on the
  // PRE-jump latch (`wasDeadBefore`), NOT the post-jump `state.shipDestroyed`,
  // so a failed HYPERSPACE jump (A-14) — which latches shipDestroyed before this
  // point — cues its explosion/thrust-stop exactly like a collision death,
  // instead of dying silently.
  if (!wasDeadBefore && shipDestroyed) {
    events.push({ type: 'explosion', source: 'ship' })
    // A2-5: the ship's rendered silhouette fractures into its 4 polygon edges
    // as independent debris — the visual twin of the explosion event above,
    // gated on the same edge (fires even on the last life, like the event).
    shipDebris = [...shipDebris, ...breakShip(ship, rng)]
    // A dead ship's engine goes silent (the intent behind the alive-gated thrust
    // events above). But the thrust-stop falling edge can never fire once dead,
    // so a ship that dies with thrust ENGAGED would leave its loop humming
    // through gameover/attract. Stop it here iff the loop is on this frame —
    // `input.thrust` covers both a held and a just-pressed thrust. A same-frame
    // RELEASE is not `input.thrust`, so its (still-alive) falling-edge stop
    // above is the only one — no double-stop.
    if (input.thrust) events.push({ type: 'thrust-stop' })
  }

  // A-14: the hyperspace hidden-window closes when shipSpawnTimer reaches zero
  // this tick — reveal the ship on that edge. A-15's respawn window keeps the
  // ship visible throughout, so revealing is a no-op there.
  const revealedShip =
    state.shipSpawnTimer > 0 && shipSpawnTimer === 0 ? { ...ship, visible: true } : ship

  let stepped: GameState = {
    ...state,
    rng,
    tick: state.tick + 1,
    ship: revealedShip,
    rocks,
    bullets: liveBullets,
    shipDebris,
    saucerDebris,
    shrapnel,
    saucer,
    score,
    lives,
    firePrev,
    thrustPrev: input.thrust,
    startPrev: input.start,
    // A-14: track the physical hyperspace button so the jump is edge-triggered
    // (a held key fires once, not every tick the window is closed) — the same
    // shift-register debounce as firePrev/thrustPrev/startPrev.
    hyperspacePrev: input.hyperspace,
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

  // The respawn attempt runs every playing tick but on the PRE-step latch
  // (`wasDeadBefore`, captured before the hyperspace jump), so a ship destroyed
  // this very step — by a collision OR a failed hyperspace jump — spends at
  // least one full tick dead before it may reappear at a clear center (A-15).
  // The wait is unbounded — a crowded center just means trying again next tick.
  if (wasDeadBefore) {
    stepped = tryRespawnShip(stepped)
  }

  // The saucer subsystem (play only): move/fire/despawn the live saucer, then let
  // the spawn director bring the next one when none is alive. Each clones the rng
  // itself, so draws thread forward without touching the caller's rng. Runs BEFORE
  // the wave director, whose "field clear" gate includes `saucer === null` — so a
  // live saucer holds off the next wave (A-10 forward-compat gate).
  const withSaucer = withSirenEdge(incomingSaucer, updateSpawnDirector(stepSaucer(stepped, dt), dt))

  // The wave director spawns the next wave once the field is clear (play only).
  // It runs on the post-step state and clones the rng itself, so any spawn draws
  // are threaded into the returned state without touching the caller's rng.
  return withHeartbeat(updateWaveDirector(withSaucer, dt), dt)
}
