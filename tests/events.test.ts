// tests/events.test.ts
//
// RED-phase suite for Story A-18 — the pure-core game-event channel that
// drives sound (accelerating heartbeat, thrust, fire, explosions, saucer
// siren). Mirrors the sibling tempest game's established `GameState.events` /
// `core/events.ts` pattern (tempest/src/core/events.ts,
// tempest/tests/core/sim.events.test.ts) — proven design for THIS "arcade"
// project family. CLAUDE.md: share the PATTERN across games, not the code —
// so this is a fresh, asteroids-native `GameEvent` union, not an import.
//
// `state.events` and `src/core/events` do not exist yet, so this file fails
// to compile today (valid RED per house convention — see collision.test.ts).
//
// Scope note (Conflict logged in session Delivery Findings): epic-A.yaml's
// A-13 ("Saucer scoring (200/1000) + collisions + siren cadence") is a
// SEPARATE, not-yet-started story that owns saucer-vs-bullet collision and
// per-size siren cadence. Player bullets do not yet destroy saucers in
// sim.ts (only rocks). So the saucer-siren tests below cover ONLY the
// lifecycle sim.ts already implements — spawn (A-11) and far-edge despawn
// (A-11) — never a bullet-kill. Do not add saucer collision here; that is
// A-13's job.
import { describe, it, expect } from 'vitest'
import { stepGame } from '../src/core/sim'
import {
  initialState,
  WORLD_W,
  type GameState,
  type Rock,
  type RockSize,
  type Bullet,
  type Vec2,
} from '../src/core/state'
import { NO_INPUT } from '../src/core/input'
import type { GameEvent } from '../src/core/events'

const DT = 1 / 60

// Clear of the default ship spawn ({4096, 3072}) — mirrors collision.test.ts's
// CENTER convention so rock/bullet fixtures never trip an unintended ship hit.
const CENTER: Vec2 = { x: 2000, y: 2000 }

const FIRE = { ...NO_INPUT, fire: true }
const THRUST = { ...NO_INPUT, thrust: true }

function playing(seed: number, over: Partial<GameState> = {}): GameState {
  return { ...initialState(seed), mode: 'playing', lives: 3, ...over }
}

function shipAt(pos: Vec2): GameState['ship'] {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, dir: 64 }
}

function rockAt(pos: Vec2, size: RockSize): Rock {
  return { pos: { ...pos }, velocity: { x: 0, y: 0 }, size, shapeVariant: 0 }
}

function bulletAt(pos: Vec2): Bullet {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, life: 60, owner: 'player' }
}

// Narrow `state.events` to one variant, the same idiom tempest's suite uses —
// keeps assertions typed without a cast.
function eventsOfType<T extends GameEvent['type']>(
  s: GameState,
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return s.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type)
}

// Run stepGame for `seconds` of sim time, accumulating heartbeat events across
// every frame (events reset each frame — AC-7 — so a single step can't observe
// a beat's TEMPO, only a window of many steps can).
function countHeartbeats(initial: GameState, seconds: number): number {
  let s = initial
  let count = 0
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    s = stepGame(s, NO_INPUT, DT)
    count += eventsOfType(s, 'heartbeat').length
  }
  return count
}

// --- fire (AC-1) -------------------------------------------------------
describe('fire events', () => {
  it('emits a fire event on the rising edge of the fire button', () => {
    const out = stepGame(playing(1), FIRE, DT)
    expect(eventsOfType(out, 'fire')).toHaveLength(1)
    expect(out.bullets).toHaveLength(1)
  })

  it('emits no fire event on neutral input', () => {
    const out = stepGame(playing(1), NO_INPUT, DT)
    expect(eventsOfType(out, 'fire')).toHaveLength(0)
  })

  it('emits no fire event when the shot cap is already reached', () => {
    const bullets: Bullet[] = Array.from({ length: 4 }, () => bulletAt(CENTER))
    const out = stepGame(playing(1, { bullets }), FIRE, DT)
    expect(eventsOfType(out, 'fire')).toHaveLength(0)
  })

  it('emits no fire event while the ship is dead', () => {
    const out = stepGame(playing(1, { shipDestroyed: true }), FIRE, DT)
    expect(eventsOfType(out, 'fire')).toHaveLength(0)
  })

  it('emits no fire event in attract mode, even with fire held', () => {
    const out = stepGame({ ...initialState(1), mode: 'attract' }, FIRE, DT)
    expect(eventsOfType(out, 'fire')).toHaveLength(0)
  })
})

// --- explosions: rocks (AC-2) -------------------------------------------
describe('explosion events — rocks', () => {
  it.each<RockSize>(['large', 'medium', 'small'])(
    "emits an explosion event tagged with the destroyed rock's own tier (%s)",
    (size) => {
      const s0 = playing(4242, {
        ship: shipAt({ x: 6000, y: 5000 }),
        rocks: [rockAt(CENTER, size)],
        bullets: [bulletAt(CENTER)],
      })
      const out = stepGame(s0, NO_INPUT, DT)
      const explosions = eventsOfType(out, 'explosion')
      expect(explosions).toHaveLength(1)
      expect(explosions[0].source).toBe(size)
    },
  )

  it('emits no explosion event when no rock is hit', () => {
    const s0 = playing(4242, {
      ship: shipAt({ x: 6000, y: 5000 }),
      rocks: [rockAt({ x: 7000, y: 100 }, 'large')],
      bullets: [bulletAt(CENTER)],
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(eventsOfType(out, 'explosion')).toHaveLength(0)
  })

  it('emits one explosion event per rock destroyed in a single frame', () => {
    const far: Vec2 = { x: 5000, y: 100 }
    const s0 = playing(4242, {
      ship: shipAt({ x: 6000, y: 5000 }),
      rocks: [rockAt(CENTER, 'large'), rockAt(far, 'small')],
      bullets: [bulletAt(CENTER), bulletAt(far)],
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(eventsOfType(out, 'explosion')).toHaveLength(2)
  })
})

// --- explosions: ship (AC-3) --------------------------------------------
describe('explosion events — ship', () => {
  it('emits a ship explosion on a fatal rock collision', () => {
    const s0 = playing(4242, { ship: shipAt(CENTER), rocks: [rockAt(CENTER, 'large')] })
    const out = stepGame(s0, NO_INPUT, DT)
    const explosions = eventsOfType(out, 'explosion')
    expect(explosions).toHaveLength(1)
    expect(explosions[0].source).toBe('ship')
  })

  it('emits a ship explosion even on the last life, when the run ends', () => {
    const s0 = playing(4242, { lives: 1, ship: shipAt(CENTER), rocks: [rockAt(CENTER, 'large')] })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.mode).toBe('gameover')
    expect(eventsOfType(out, 'explosion').filter((e) => e.source === 'ship')).toHaveLength(1)
  })

  it('emits no ship explosion while the post-respawn invulnerability window is open', () => {
    const s0 = playing(4242, {
      ship: shipAt(CENTER),
      rocks: [rockAt(CENTER, 'large')],
      shipSpawnTimer: 1,
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(eventsOfType(out, 'explosion')).toHaveLength(0)
  })
})

// --- thrust loop (AC-4) --------------------------------------------------
describe('thrust events', () => {
  it('emits thrust-start on the rising edge of the thrust button', () => {
    const out = stepGame(playing(1), THRUST, DT)
    expect(eventsOfType(out, 'thrust-start')).toHaveLength(1)
    expect(eventsOfType(out, 'thrust-stop')).toHaveLength(0)
  })

  it('emits no further thrust-start while thrust is held across frames', () => {
    const s1 = stepGame(playing(1), THRUST, DT)
    const s2 = stepGame(s1, THRUST, DT)
    expect(eventsOfType(s2, 'thrust-start')).toHaveLength(0)
  })

  it('emits thrust-stop on the falling edge of the thrust button', () => {
    const s1 = stepGame(playing(1), THRUST, DT)
    const s2 = stepGame(s1, NO_INPUT, DT)
    expect(eventsOfType(s2, 'thrust-stop')).toHaveLength(1)
  })

  it('emits no thrust-start while the ship is dead', () => {
    const out = stepGame(playing(1, { shipDestroyed: true }), THRUST, DT)
    expect(eventsOfType(out, 'thrust-start')).toHaveLength(0)
  })

  // Regression (Reviewer finding H-1): the falling-edge stop is gated on the
  // ship being alive, so a ship that dies WHILE thrust is held can never emit
  // it — leaving the engine loop humming through death → gameover → attract.
  // The death edge must stop the loop instead.
  it('emits thrust-stop when the ship dies while thrust is held', () => {
    const s0 = playing(4242, {
      ship: shipAt(CENTER),
      rocks: [rockAt(CENTER, 'large')],
      thrustPrev: true, // was thrusting last frame
    })
    const out = stepGame(s0, THRUST, DT) // still holding thrust as it dies
    expect(out.shipDestroyed).toBe(true)
    expect(eventsOfType(out, 'thrust-stop')).toHaveLength(1)
  })

  // Guards the fix against a double-stop: if thrust is RELEASED the same frame
  // the ship dies, the (still-alive) falling edge already emits the one stop —
  // the death edge must not add a second.
  it('emits exactly one thrust-stop when thrust is released the frame the ship dies', () => {
    const s0 = playing(4242, {
      ship: shipAt(CENTER),
      rocks: [rockAt(CENTER, 'large')],
      thrustPrev: true,
    })
    const out = stepGame(s0, NO_INPUT, DT) // released thrust the same frame it dies
    expect(out.shipDestroyed).toBe(true)
    expect(eventsOfType(out, 'thrust-stop')).toHaveLength(1)
  })

  // The headline of H-1: holding thrust through a fatal death must not leave the
  // loop running across gameover and into attract. Over a long window there is
  // exactly ONE stop (the death frame) and no lingering hum.
  it('stops the thrust loop exactly once through a fatal death into attract', () => {
    let s = playing(4242, {
      lives: 1,
      ship: shipAt(CENTER),
      rocks: [rockAt(CENTER, 'large')],
      thrustPrev: true,
    })
    let stops = 0
    for (let i = 0; i < 300; i++) {
      s = stepGame(s, THRUST, DT) // keep holding thrust through death → gameover → attract
      stops += eventsOfType(s, 'thrust-stop').length
    }
    expect(stops).toBe(1)
  })
})

// --- saucer siren loop (AC-5) --------------------------------------------
// Scope: spawn + far-edge despawn ONLY (see file header) — bullet-kill siren
// cutoff belongs to A-13, not this story.
describe('saucer siren events', () => {
  it('emits saucer-siren-start the frame a saucer spawns', () => {
    const s0 = playing(4242, { saucerSpawnTimer: 1 / 60 }) // one tick from spawning
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.saucer).not.toBeNull()
    expect(eventsOfType(out, 'saucer-siren-start')).toHaveLength(1)
  })

  it('emits no saucer-siren-start on a tick that does not spawn one', () => {
    const s0 = playing(4242, { saucerSpawnTimer: 5 })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.saucer).toBeNull()
    expect(eventsOfType(out, 'saucer-siren-start')).toHaveLength(0)
  })

  it('emits saucer-siren-stop the frame the saucer despawns off the far edge', () => {
    const saucer: GameState['saucer'] = {
      pos: { x: WORLD_W - 1, y: 100 },
      velocity: { x: 16, y: 0 },
      size: 'large',
      courseTimer: 999,
      fireTimer: 999,
    }
    const out = stepGame(playing(1, { saucer }), NO_INPUT, DT)
    expect(out.saucer).toBeNull()
    expect(eventsOfType(out, 'saucer-siren-stop')).toHaveLength(1)
  })

  it('emits no saucer-siren-stop while the saucer is still alive', () => {
    const saucer: GameState['saucer'] = {
      pos: { x: WORLD_W / 2, y: 100 },
      velocity: { x: 16, y: 0 },
      size: 'large',
      courseTimer: 999,
      fireTimer: 999,
    }
    const out = stepGame(playing(1, { saucer }), NO_INPUT, DT)
    expect(out.saucer).not.toBeNull()
    expect(eventsOfType(out, 'saucer-siren-stop')).toHaveLength(0)
  })
})

// --- accelerating heartbeat (AC-6) ---------------------------------------
// Pins the RELATIONSHIP (fewer live rocks ⇒ faster beat), not a ROM-exact
// magnitude — the same "pin relationships, not magnitudes" convention as
// rocks.ts/saucer.ts's provisional constants (verify vs quarry, A-17).
describe('heartbeat events', () => {
  it('emits heartbeat events while playing', () => {
    const s0 = playing(1, { rocks: [rockAt(CENTER, 'large')] })
    expect(countHeartbeats(s0, 12)).toBeGreaterThan(0)
  })

  it('beats faster (more beats in a fixed window) as live rocks thin out', () => {
    const manyRocks = Array.from({ length: 8 }, (_, i) => rockAt({ x: 100 + i * 500, y: 100 }, 'large'))
    const fewRocks = [rockAt({ x: 100, y: 100 }, 'large')]
    const WINDOW_S = 12

    const countMany = countHeartbeats(playing(1, { rocks: manyRocks }), WINDOW_S)
    const countFew = countHeartbeats(playing(1, { rocks: fewRocks }), WINDOW_S)

    expect(countMany).toBeGreaterThan(0)
    expect(countFew).toBeGreaterThan(countMany)
  })

  it('emits no heartbeat events in attract mode', () => {
    expect(countHeartbeats({ ...initialState(1), mode: 'attract' }, 10)).toBe(0)
  })

  it('emits no heartbeat events in gameover mode', () => {
    const s0 = playing(1, {
      mode: 'gameover',
      gameOver: { qualifies: false, initials: '', confirmed: false, displayTimer: 3 },
    })
    expect(countHeartbeats(s0, 2)).toBe(0)
  })

  it('is deterministic: two runs from the same state emit the same heartbeat timing', () => {
    const seed = playing(99, { rocks: [rockAt(CENTER, 'large')] })
    expect(countHeartbeats(seed, 8)).toBe(countHeartbeats(seed, 8))
  })
})

// --- per-frame reset (AC-7) ----------------------------------------------
describe('events channel resets every frame', () => {
  it("clears the previous frame's events when nothing new happens", () => {
    const fired = stepGame(playing(1), FIRE, DT)
    expect(eventsOfType(fired, 'fire')).toHaveLength(1) // frame 1 emitted

    const next = stepGame(fired, NO_INPUT, DT) // frame 2, neutral
    expect(next.events).toEqual([]) // last frame's fire is gone
  })
})
