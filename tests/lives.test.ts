// tests/lives.test.ts
//
// Story A-15: lives / safe-respawn (clear-center) / invulnerability. This
// suite REPLACES A-16's terminal-death stub (any destruction edge ended the
// run, reserves forfeit — the pin removed from tests/modes.test.ts) with the
// real 1979 lives model:
//
//  - STARTING_LIVES becomes the ROM's 3-ship game (the A-16 stub was 1).
//  - A destruction edge with ships in reserve DECREMENTS and keeps the run
//    alive: the ship lies dead (the A-8 `shipDestroyed` latch) while the sim
//    waits — indefinitely — for the center of the playfield to clear.
//  - `isCenterClear` is a GEOMETRIC clear-zone (no rock / saucer / saucer
//    bullet within RESPAWN_CLEAR_RADIUS of the world center; player bullets
//    excluded — A-4's finite lifetime means they never linger). This is a
//    deliberate, context-flagged deviation from the ROM's apparent
//    count-based heuristic — verify vs quarry (A-17).
//  - On revive: exact world center, at rest, nose-up (dir 64), and a fixed
//    post-respawn invulnerability window (GameState.shipSpawnTimer, seconds,
//    armed to RESPAWN_INVULNERABILITY_S ≈ 129 frames — verify vs quarry
//    (A-17)) during which the A-8 collision check must not kill the ship.
//    The window shields; it does not disable — the ship steers and fires.
//  - The last ship keeps A-16's pinned edge: destroyed with none left →
//    'gameover' the same step, gameOver phase initialised.
//  - Legacy lives-0 free-play fixtures (every pre-A-16 suite) keep the old
//    sticky latch: no decrement below zero, no gameover, no respawn.
//
// Field-shape adaptations from context-story-A-15.md (logged as Design
// Deviations in the session): the dead flag stays `GameState.shipDestroyed`
// (A-8's landed latch — no duplicate `Ship.alive`), and the invulnerability
// timer is `GameState.shipSpawnTimer` (GameState is where every sim timer
// lives; A-14 has NOT landed, so A-15 introduces the field A-14 will reuse).
//
// RED: this whole file fails at module load until `src/core/lives.ts` exists
// (handleShipDeath / isCenterClear / tryRespawnShip / isInvulnerable +
// RESPAWN_CLEAR_RADIUS / RESPAWN_INVULNERABILITY_S), and `tsc --noEmit` stays
// red until GameState gains `shipSpawnTimer` and STARTING_LIVES becomes 3.

import { describe, it, expect } from 'vitest'
import { stepGame, GAME_OVER_DISPLAY_S } from '../src/core/sim'
import {
  initialState,
  STARTING_LIVES,
  WORLD_W,
  WORLD_H,
  type GameState,
  type Rock,
  type RockSize,
  type Bullet,
  type Saucer,
  type Vec2,
} from '../src/core/state'
import { NO_INPUT, type Input } from '../src/core/input'
import { SHIP_HITBOX } from '../src/core/ship'
import { ROCK_HITBOX } from '../src/core/rocks'
import {
  handleShipDeath,
  isCenterClear,
  tryRespawnShip,
  isInvulnerable,
  RESPAWN_CLEAR_RADIUS,
  RESPAWN_INVULNERABILITY_S,
} from '../src/core/lives'

const DT = 1 / 60

/** The respawn point: the exact world center (CenterShip, $6f06 vicinity). */
const CENTER: Vec2 = { x: WORLD_W / 2, y: WORLD_H / 2 }

const START: Input = { ...NO_INPUT, start: true }
const THRUST: Input = { ...NO_INPUT, thrust: true }
const FIRE: Input = { ...NO_INPUT, fire: true }
// Every gameplay control held at once — a dead ship must ignore ALL of them.
const MASHED: Input = {
  left: true,
  right: true,
  thrust: true,
  fire: true,
  hyperspace: true,
  start: false,
}

/** A motionless rock at `pos` (zero drift → geometry stays put across steps). */
function rockAt(pos: Vec2, size: RockSize = 'large'): Rock {
  return { pos: { ...pos }, velocity: { x: 0, y: 0 }, size, shapeVariant: 0 }
}

/** A parked saucer at `pos` with both cadence timers held high, so a short
 * test never sees it reroll course or fire. */
function saucerAt(pos: Vec2): Saucer {
  return { pos: { ...pos }, velocity: { x: 0, y: 0 }, size: 'large', courseTimer: 9, fireTimer: 9 }
}

/** A motionless, long-lived bullet at `pos` owned by `owner`. */
function bulletAt(pos: Vec2, owner: Bullet['owner']): Bullet {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, life: 60, owner }
}

/** A world-center offset `k` clear-radii along +x — blockers sit inside the
 * zone at k < 1, bystanders outside at k > 1, all swap-safe if A-17 resizes
 * RESPAWN_CLEAR_RADIUS. */
function offCenter(k: number): Vec2 {
  return { x: CENTER.x + RESPAWN_CLEAR_RADIUS * k, y: CENTER.y }
}

/** A 'playing' state with a full three-ship rack unless overridden. The
 * default initialState ship sits at the world center, nose-up, at rest. */
function playing(seed: number, over: Partial<GameState> = {}): GameState {
  return { ...initialState(seed), mode: 'playing', lives: 3, ...over }
}

/** A dead-ship 'playing' state awaiting respawn: reserves remain, the A-8
 * latch is set, and the ghost lies where it fell (deliberately off-center,
 * with stale velocity/heading, so a revive that forgets to reset any of
 * pos/vel/dir is caught). One far rock keeps the wave director quiet without
 * blocking the clear zone. */
function deadAwaiting(over: Partial<GameState> = {}): GameState {
  return playing(11, {
    shipDestroyed: true,
    lives: 2,
    ship: { pos: { x: 1000, y: 900 }, vel: { x: 3, y: -2 }, dir: 100 },
    shipSpawnTimer: 0,
    rocks: [rockAt(offCenter(2))],
    ...over,
  })
}

// ---- STARTING_LIVES: the ROM three-ship game -----------------------------------

describe('STARTING_LIVES — the ROM default (A-15 swaps the A-16 stub)', () => {
  it('is exactly 3 (DIP-switchable to 4 on the cabinet; free-play here, so fixed)', () => {
    // Corroborated by both research sources (init $6ED8: "Assume A 3 Ship
    // Game") — a magnitude pin, unlike the provisional feel constants.
    expect(STARTING_LIVES).toBe(3)
  })

  it('is what a start press deals: boot stays a 0-life attract, the deal is 3', () => {
    // AC-1 adaptation (see session deviations): initialState() boots ATTRACT
    // with lives 0 (pinned by state.test.ts since A-16); the three ships are
    // dealt on the start edge, the moment a run actually begins.
    const s1 = stepGame(initialState(8), START, DT)
    expect(s1.mode).toBe('playing')
    expect(s1.lives).toBe(3)
  })
})

// ---- handleShipDeath: one death, one consequence (unit) ------------------------

describe('handleShipDeath — decrement with reserves, gameover on the last ship', () => {
  const ghostPos: Vec2 = { x: 1000, y: 900 }
  const withReserves = (): GameState =>
    playing(7, { lives: 3, score: 500, ship: { pos: { ...ghostPos }, vel: { x: 0, y: 0 }, dir: 20 } })
  const lastShip = (score = 500): GameState => playing(7, { lives: 1, score })

  it('with ships in reserve: decrements once, stays in play, leaves the ship dead where it fell', () => {
    const out = handleShipDeath(withReserves())
    expect(out.lives).toBe(2)
    expect(out.mode).toBe('playing')
    expect(out.shipDestroyed).toBe(true)
    expect(out.ship.pos).toEqual(ghostPos) // no respawn position assigned here
    expect(out.gameOver).toBeNull()
  })

  it('a bonus-ship reserve is one real extra ship: 2 -> 1 keeps playing', () => {
    const out = handleShipDeath(playing(7, { lives: 2 }))
    expect(out.lives).toBe(1)
    expect(out.mode).toBe('playing')
  })

  it('on the last ship: lives 0 and gameover in the same call, phase initialised as A-16 pinned', () => {
    const out = handleShipDeath(lastShip(500))
    expect(out.lives).toBe(0)
    expect(out.mode).toBe('gameover')
    expect(out.shipDestroyed).toBe(true)
    expect(out.gameOver).toEqual({
      qualifies: true, // positive score, empty board
      initials: '',
      confirmed: false,
      displayTimer: GAME_OVER_DISPLAY_S,
    })
  })

  it('terminal qualifies obeys qualifiesForHighScore: a scoreless run never charts', () => {
    const out = handleShipDeath(lastShip(0))
    expect(out.mode).toBe('gameover')
    expect(out.gameOver?.qualifies).toBe(false)
  })

  it('is pure: never mutates the input state (both branches)', () => {
    for (const s0 of [withReserves(), lastShip()]) {
      const snapshot = structuredClone(s0)
      handleShipDeath(s0)
      expect(s0).toEqual(snapshot)
    }
  })
})

// ---- isCenterClear: the geometric clear-zone (unit) ----------------------------

describe('isCenterClear — nothing dangerous within the radius of the center', () => {
  it('an empty field is clear (no rocks, no saucer)', () => {
    expect(isCenterClear(playing(5, { rocks: [], saucer: null }), RESPAWN_CLEAR_RADIUS)).toBe(true)
  })

  it('a rock inside the radius blocks; the same rock outside does not', () => {
    const inside = playing(5, { rocks: [rockAt(offCenter(0.9))] })
    const outside = playing(5, { rocks: [rockAt(offCenter(1.1))] })
    expect(isCenterClear(inside, RESPAWN_CLEAR_RADIUS)).toBe(false)
    expect(isCenterClear(outside, RESPAWN_CLEAR_RADIUS)).toBe(true)
  })

  it('even the smallest rock blocks — the check is positional, not size-weighted', () => {
    const s = playing(5, { rocks: [rockAt(offCenter(0.5), 'small')] })
    expect(isCenterClear(s, RESPAWN_CLEAR_RADIUS)).toBe(false)
  })

  it('a saucer inside the radius blocks', () => {
    const s = playing(5, { rocks: [], saucer: saucerAt(offCenter(0.9)) })
    expect(isCenterClear(s, RESPAWN_CLEAR_RADIUS)).toBe(false)
  })

  it('a saucer bullet inside the radius blocks', () => {
    const s = playing(5, { rocks: [], bullets: [bulletAt(offCenter(0.9), 'saucer')] })
    expect(isCenterClear(s, RESPAWN_CLEAR_RADIUS)).toBe(false)
  })

  it('a PLAYER bullet inside the radius does NOT block (finite lifetime — excluded by design)', () => {
    const s = playing(5, { rocks: [], bullets: [bulletAt(offCenter(0.9), 'player')] })
    expect(isCenterClear(s, RESPAWN_CLEAR_RADIUS)).toBe(true)
  })

  it('honors the radius argument (the zone is a parameter, not a constant baked in)', () => {
    const s = playing(5, { rocks: [rockAt({ x: CENTER.x + 500, y: CENTER.y })] })
    expect(isCenterClear(s, 400)).toBe(true) // rock at 500 sits outside a 400 zone
    expect(isCenterClear(s, 600)).toBe(false) // …and inside a 600 one
  })

  it('RESPAWN_CLEAR_RADIUS can never hand the ship an instant death', () => {
    // Provisional magnitude (~a large-rock diameter, verify vs quarry (A-17))
    // but this RELATIONSHIP must survive any swap: a revive into a clear zone
    // must place the ship beyond overlap range of the nearest possible rock,
    // or respawning becomes a death loop.
    expect(RESPAWN_CLEAR_RADIUS).toBeGreaterThanOrEqual(SHIP_HITBOX + ROCK_HITBOX.large)
  })

  it('is pure: never mutates the input state', () => {
    const s0 = playing(5, { rocks: [rockAt(offCenter(0.9))], saucer: saucerAt(offCenter(3)) })
    const snapshot = structuredClone(s0)
    isCenterClear(s0, RESPAWN_CLEAR_RADIUS)
    expect(s0).toEqual(snapshot)
  })
})

// ---- tryRespawnShip: revive only when it is safe (unit) ------------------------

describe('tryRespawnShip — dead + reserves + clear center = revive; anything else waits', () => {
  it('revives at the exact center, at rest, nose-up, with the invulnerability window armed', () => {
    const out = tryRespawnShip(deadAwaiting())
    expect(out.shipDestroyed).toBe(false)
    expect(out.ship).toEqual({ pos: { ...CENTER }, vel: { x: 0, y: 0 }, dir: 64 })
    expect(out.lives).toBe(2) // respawn consumes no ship — death already did
    expect(out.shipSpawnTimer).toBe(RESPAWN_INVULNERABILITY_S)
    expect(isInvulnerable(out)).toBe(true)
  })

  it('waits while the center is blocked: the state comes back unchanged', () => {
    const blocked = deadAwaiting({ rocks: [rockAt(offCenter(0.5))] })
    expect(tryRespawnShip(blocked)).toEqual(blocked)
  })

  it('never revives with no ships left, however clear the field', () => {
    const spent = deadAwaiting({ lives: 0 })
    expect(tryRespawnShip(spent)).toEqual(spent)
  })

  it('never touches a live ship (no teleport-to-center on a no-op tick)', () => {
    const alive = playing(9, {
      ship: { pos: { x: 2000, y: 2500 }, vel: { x: 4, y: 0 }, dir: 30 },
      rocks: [rockAt(offCenter(2))],
    })
    expect(tryRespawnShip(alive)).toEqual(alive)
  })

  it("is inert outside 'playing' (a gameover corpse stays a corpse)", () => {
    const over = deadAwaiting({
      mode: 'gameover',
      gameOver: { qualifies: false, initials: '', confirmed: false, displayTimer: 3 },
    })
    expect(tryRespawnShip(over)).toEqual(over)
  })

  it('is pure: never mutates the input state (revive branch)', () => {
    const s0 = deadAwaiting()
    const snapshot = structuredClone(s0)
    tryRespawnShip(s0)
    expect(s0).toEqual(snapshot)
  })
})

// ---- the invulnerability window (integration through stepGame) -----------------

describe('stepGame — post-respawn invulnerability (GameState.shipSpawnTimer)', () => {
  it('boots with no window: shipSpawnTimer 0, ship mortal', () => {
    const s = initialState(1)
    expect(s.shipSpawnTimer).toBe(0)
    expect(isInvulnerable(s)).toBe(false)
  })

  it('a nonzero shipSpawnTimer IS the invulnerability flag', () => {
    expect(isInvulnerable({ ...playing(3), shipSpawnTimer: 1.5 })).toBe(true)
    expect(isInvulnerable({ ...playing(3), shipSpawnTimer: 0 })).toBe(false)
  })

  it('RESPAWN_INVULNERABILITY_S is a real window (positive seconds)', () => {
    // Provisional: ~129 frames at 60 Hz per the $6980 read — verify vs
    // quarry (A-17). Pinned as a relationship, not a magnitude.
    expect(RESPAWN_INVULNERABILITY_S).toBeGreaterThan(0)
  })

  it('an armed window shields the ship: a rock parked on it does not kill', () => {
    const shielded = playing(13, {
      shipSpawnTimer: RESPAWN_INVULNERABILITY_S,
      rocks: [rockAt(CENTER)], // parked dead-center on the default ship pos
    })
    const s1 = stepGame(shielded, NO_INPUT, DT)
    expect(s1.shipDestroyed).toBe(false)
    expect(s1.lives).toBe(3)
    expect(s1.mode).toBe('playing')
  })

  it('the window decays by dt and expires: the same parked rock kills once it runs out', () => {
    // A 3-tick window, so the boundary is cheap to walk. Tolerance of one
    // tick on the expiry edge — the decay-vs-collision order inside a step is
    // an implementation detail; "shielded for ~the window, mortal after" is
    // the contract.
    let s: GameState = playing(13, { shipSpawnTimer: 3 * DT, rocks: [rockAt(CENTER)] })
    s = stepGame(s, NO_INPUT, DT)
    s = stepGame(s, NO_INPUT, DT)
    expect(s.shipDestroyed).toBe(false) // 2 ticks in: still inside the window
    s = stepGame(s, NO_INPUT, DT)
    s = stepGame(s, NO_INPUT, DT)
    expect(s.shipDestroyed).toBe(true) // 4 ticks in: window gone, rock connects
    expect(s.lives).toBe(2) // …and the death seam consumed exactly one ship
  })

  it('the full window lasts RESPAWN_INVULNERABILITY_S of sim time (fixed dt)', () => {
    // One far rock keeps the wave director from spawning a fresh wave into
    // the measurement (the field is never "clear").
    let s: GameState = playing(9, {
      shipSpawnTimer: RESPAWN_INVULNERABILITY_S,
      rocks: [rockAt(offCenter(2))],
    })
    const window = Math.round(RESPAWN_INVULNERABILITY_S / DT)
    let firstMortal = -1
    for (let i = 1; i <= window + 2; i++) {
      s = stepGame(s, NO_INPUT, DT)
      if (firstMortal === -1 && !isInvulnerable(s)) firstMortal = i
      // Monotonic: once the window closes it never reopens by itself.
      if (firstMortal !== -1) expect(isInvulnerable(s)).toBe(false)
    }
    expect(firstMortal).toBeGreaterThanOrEqual(window - 1)
    expect(firstMortal).toBeLessThanOrEqual(window + 1)
    expect(s.shipSpawnTimer).toBe(0) // clamped, never negative
  })

  it('invulnerable is not inert: the shielded ship still steers and fires', () => {
    const shielded = playing(17, {
      shipSpawnTimer: RESPAWN_INVULNERABILITY_S,
      rocks: [rockAt(offCenter(2))],
    })
    const thrusted = stepGame(shielded, THRUST, DT)
    expect(thrusted.ship.vel).not.toEqual(shielded.ship.vel) // engines answer
    const fired = stepGame(shielded, FIRE, DT)
    expect(fired.bullets.length).toBe(1) // guns answer
  })
})

// ---- death -> wait -> respawn (integration; replaces A-16's terminal stub) -----

describe('stepGame — the lives cycle (A-16 reserves-forfeit stub replaced)', () => {
  /** One tick from death #1: three ships, a rock parked on the (center-
   * spawned) ship. The killer also squats the clear zone, blocking respawn. */
  const aboutToDie = (lives = 3, score = 12000): GameState =>
    playing(21, { lives, score, rocks: [rockAt(CENTER)] })

  it('a death with ships in reserve decrements and keeps the run alive', () => {
    const s1 = stepGame(aboutToDie(), NO_INPUT, DT)
    expect(s1.shipDestroyed).toBe(true)
    expect(s1.lives).toBe(2) // NOT forfeited to 0 — the A-16 stub is gone
    expect(s1.mode).toBe('playing') // the run survives its bonus-ship death
    expect(s1.gameOver).toBeNull()
  })

  it('one death costs one ship: the parked killer never drains lives per tick', () => {
    let s = stepGame(aboutToDie(), NO_INPUT, DT)
    for (let i = 0; i < 60; i++) s = stepGame(s, NO_INPUT, DT)
    expect(s.lives).toBe(2) // the sticky latch makes death an edge, not a level
    expect(s.mode).toBe('playing')
    expect(s.shipDestroyed).toBe(true) // center still squatted — no revive
  })

  it('dead between lives, the ship is deaf to input: no steering, no firing from the grave', () => {
    const dead = stepGame(aboutToDie(), NO_INPUT, DT)
    expect(dead.mode).toBe('playing') // guard the guard: this is the between-lives wait, not gameover
    expect(dead.shipDestroyed).toBe(true)
    const runFor = (input: Input): GameState => {
      let s = structuredClone(dead)
      for (let i = 0; i < 30; i++) s = stepGame(s, input, DT)
      return s
    }
    const idle = runFor(NO_INPUT)
    const mashed = runFor(MASHED)
    expect(mashed.ship).toEqual(idle.ship) // the ghost ignores the controls
    expect(mashed.bullets).toEqual([]) // no shots from a dead ship
    expect(idle.bullets).toEqual([])
    expect(mashed.score).toBe(idle.score) // …so nothing to score either
  })

  it('revives the very next tick after the center clears: reserves intact, window armed', () => {
    const dead = stepGame(aboutToDie(), NO_INPUT, DT)
    expect(stepGame(dead, NO_INPUT, DT).shipDestroyed).toBe(true) // blocked: killer squats
    // Fixture surgery: the obstruction drifts away (moved outside the zone).
    const cleared: GameState = { ...dead, rocks: [rockAt(offCenter(2))] }
    const s1 = stepGame(cleared, NO_INPUT, DT)
    expect(s1.shipDestroyed).toBe(false)
    expect(s1.ship.pos).toEqual(CENTER)
    expect(s1.ship.vel).toEqual({ x: 0, y: 0 })
    expect(s1.ship.dir).toBe(64) // nose-up, the canonical spawn heading
    expect(s1.lives).toBe(2)
    expect(s1.mode).toBe('playing')
    expect(isInvulnerable(s1)).toBe(true)
  })

  it('waits indefinitely — no hidden timeout revives into a crowded center', () => {
    let s = stepGame(aboutToDie(), NO_INPUT, DT)
    for (let i = 0; i < 300; i++) s = stepGame(s, NO_INPUT, DT) // 5 blocked seconds
    expect(s.shipDestroyed).toBe(true)
    expect(s.mode).toBe('playing')
    expect(s.lives).toBe(2)
  })

  it('a bonus ship earned in the killing step is honored: award lands before the death is consumed', () => {
    // The Reviewer's forward-carried A-16 case, in one step: at 9950 on the
    // last ship, a shot crosses 10000 (applyScore grants a reserve) while a
    // rock kills the ship. The award must precede the death seam — the run
    // continues on the just-earned ship instead of ending.
    const s0 = playing(23, {
      lives: 1,
      score: 9950,
      rocks: [rockAt(CENTER), rockAt({ x: 1000, y: 1000 }, 'small')],
      bullets: [bulletAt({ x: 1000, y: 1000 }, 'player')],
    })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.score).toBe(10050) // guard the guard: the award really landed
    expect(s1.shipDestroyed).toBe(true)
    expect(s1.lives).toBe(1) // 1 (+1 bonus) (-1 death)
    expect(s1.mode).toBe('playing') // without A-15 this run was unfinishable
  })

  it("the last ship still ends the run the same step — A-16's preserved edge", () => {
    const s1 = stepGame(aboutToDie(1, 500), NO_INPUT, DT)
    expect(s1.mode).toBe('gameover')
    expect(s1.lives).toBe(0)
    expect(s1.shipDestroyed).toBe(true)
    expect(s1.gameOver).toEqual({
      qualifies: true,
      initials: '',
      confirmed: false,
      displayTimer: GAME_OVER_DISPLAY_S,
    })
  })

  it('legacy free-play niche: destruction at lives 0 latches sticky — no decrement, no gameover, no respawn', () => {
    // Every pre-A-16 suite runs long lives-0 simulations that must never
    // mode-flip mid-assertion, and a 0-life corpse must not resurrect.
    const s1 = stepGame(playing(25, { lives: 0, rocks: [rockAt(CENTER)] }), NO_INPUT, DT)
    expect(s1.shipDestroyed).toBe(true)
    expect(s1.lives).toBe(0)
    expect(s1.mode).toBe('playing')
    const cleared: GameState = { ...s1, rocks: [rockAt(offCenter(2))] }
    expect(stepGame(cleared, NO_INPUT, DT).shipDestroyed).toBe(true) // lives 0 → no revive
  })

  /** Scripted three-death ladder used by the last two tests. Deterministic:
   * fixed seed, fixed dt, and fixture surgery (park/clear the killer rock)
   * at fixed points in the script. Returns the lives value recorded at each
   * death edge plus the final state. */
  function runLadder(): { deaths: number[]; final: GameState } {
    const far = rockAt(offCenter(2))
    const deaths: number[] = []
    let s: GameState = playing(21, { lives: 3, score: 700, rocks: [rockAt(CENTER), far] })
    for (let d = 0; d < 3; d++) {
      s = stepGame(s, NO_INPUT, DT) // the parked rock connects: death edge
      deaths.push(s.lives)
      if (s.mode === 'gameover') break
      s = { ...s, rocks: [far] } // surgery: the killer drifts off; center clears
      s = stepGame(s, NO_INPUT, DT) // revive at center, window armed
      let guard = 0
      while (isInvulnerable(s) && guard++ < 500) s = stepGame(s, NO_INPUT, DT)
      s = { ...s, rocks: [rockAt(CENTER), far] } // surgery: a rock drifts back in
    }
    return { deaths, final: s }
  }

  it('the full ladder: three ships, three deaths, 3 -> 2 -> 1 -> 0 -> gameover', () => {
    const { deaths, final } = runLadder()
    expect(deaths).toEqual([2, 1, 0])
    expect(final.mode).toBe('gameover')
    expect(final.gameOver).not.toBeNull()
    expect(final.shipDestroyed).toBe(true)
  })

  it('determinism golden: the identical ladder replays to a deep-equal state (AC)', () => {
    const a = runLadder()
    const b = runLadder()
    expect(a.deaths).toEqual(b.deaths)
    expect(a.final).toEqual(b.final) // includes rng seed, timers, entities
  })
})
