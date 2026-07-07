// tests/hyperspace.test.ts
//
// A-14 RED phase (TEA / O'Brien): failing tests for hyperspace — the panic-button
// bail-out. Trigger, seeded reposition inside an edge-inset band, a 25%
// self-destruct roll, and the hidden+invulnerable reappearance window.
//
// RECONCILIATION NOTE (context vs landed code): the enriched context
// (context-story-A-14.md) was written before A-15 landed and proposed putting
// `visible`/`spawnTimer` on `Ship`. A-15 actually landed the timer as
// `GameState.shipSpawnTimer` (core/state.ts, core/lives.ts) and its comment
// explicitly reserves it for A-14 to reuse; A-8/A-15's death is
// `GameState.shipDestroyed` consumed once by `handleShipDeath`. So these tests
// target the LANDED shapes:
//   - hidden/invulnerable window  -> reuse GameState.shipSpawnTimer (set to
//     HYPERSPACE_TIMER_S on a successful jump; the existing sim.ts decay drains it)
//   - failed jump                 -> the same death as A-8: shipDestroyed=true via
//     handleShipDeath (lives decrement, gameover on the last ship)
//   - "hidden" during the window  -> the one NEW field the ACs require: Ship.visible
//
// Everything is fixed-seed + fixed-dt: the sim is a pure function of
// (state, input, dt), so these assertions are exact, not statistical.

import { describe, it, expect } from 'vitest'
import {
  HYPERSPACE_DEATH_CHANCE,
  HYPERSPACE_EDGE_MARGIN,
  HYPERSPACE_TIMER_S,
  rollHyperspaceSurvival,
  rollHyperspacePosition,
  triggerHyperspace,
} from '../src/core/hyperspace'
import { initialState, WORLD_W, WORLD_H, type GameState, type Ship } from '../src/core/state'
import { nextFloat } from '@arcade/shared/rng'
import { NO_INPUT, type Input } from '../src/core/input'
import { stepGame } from '../src/core/sim'

const DT = 1 / 60
const BOUNDS = { width: WORLD_W, height: WORLD_H }
const HYPER: Input = { ...NO_INPUT, hyperspace: true }

/** A live playing state seeded so the RNG draws are deterministic. */
const playing = (seed: number, over: Partial<GameState> = {}): GameState => ({
  ...initialState(seed),
  mode: 'playing',
  lives: 3,
  ...over,
})

/** Peek what the first RNG draw for `seed` yields, without consuming it. */
const peekFloat = (seed: number): number => nextFloat({ seed })
/** The mulberry32 seed after exactly `n` draws — to assert draw COUNT. */
const seedAfter = (seed: number, n: number): number => {
  const r = { seed }
  for (let i = 0; i < n; i++) nextFloat(r)
  return r.seed
}
/** Smallest seed whose first draw survives / dies under the pinned contract
 * (survive ⇔ first draw ≥ HYPERSPACE_DEATH_CHANCE). Computed, not magic. */
const findSeed = (wantSurvive: boolean): number => {
  for (let s = 1; s < 1_000_000; s++) {
    if (peekFloat(s) >= HYPERSPACE_DEATH_CHANCE === wantSurvive) return s
  }
  throw new Error('no seed found')
}
const SURVIVE_SEED = findSeed(true)
const DIE_SEED = findSeed(false)

// ---- provisional constants (A-17 quarry seam) --------------------------------

describe('A-14 hyperspace — provisional constants', () => {
  it('ships the flat, corroborated 25% self-destruct chance', () => {
    expect(HYPERSPACE_DEATH_CHANCE).toBe(0.25)
  })
  it('insets the reposition band ~10% from each playfield edge', () => {
    expect(HYPERSPACE_EDGE_MARGIN).toBeGreaterThan(0)
    expect(HYPERSPACE_EDGE_MARGIN).toBeLessThan(0.5) // a real band, not a degenerate point
    expect(HYPERSPACE_EDGE_MARGIN).toBeCloseTo(0.1)
  })
  it('hides+shields for the $30 = 48-frame window (reusing A-15 shipSpawnTimer)', () => {
    expect(HYPERSPACE_TIMER_S).toBeCloseTo(48 / 60)
  })
})

// ---- rollHyperspaceSurvival --------------------------------------------------

describe('A-14 rollHyperspaceSurvival — one seeded draw, rockCount is the A-17 seam', () => {
  it('survives iff the drawn float is at least the death chance', () => {
    for (const seed of [1, 2, 3, 7, 42, 100, 9999]) {
      const expected = peekFloat(seed) >= HYPERSPACE_DEATH_CHANCE
      expect(rollHyperspaceSurvival({ seed }, 0)).toBe(expected)
    }
  })

  it('consumes EXACTLY one RNG draw', () => {
    const r = { seed: 12345 }
    rollHyperspaceSurvival(r, 0)
    expect(r.seed).toBe(seedAfter(12345, 1))
  })

  it('ignores rockCount for now (density-swap seam) — same result, same draw', () => {
    const a = { seed: 777 }
    const b = { seed: 777 }
    const ra = rollHyperspaceSurvival(a, 0)
    const rb = rollHyperspaceSurvival(b, 999)
    expect(ra).toBe(rb)
    expect(a.seed).toBe(b.seed) // rock count changes neither outcome nor stream
  })

  it('matches the pinned survival contract exactly across many seeds', () => {
    // Death iff the drawn float is below the death chance — asserted against the
    // contract itself (peekFloat), so a correct impl can never false-fail here;
    // the magnitude (25%) is pinned separately by the HYPERSPACE_DEATH_CHANCE
    // constant test and the threshold-direction test above.
    let mismatches = 0
    for (let s = 1; s <= 4000; s++) {
      const survived = rollHyperspaceSurvival({ seed: s }, 0)
      const shouldSurvive = peekFloat(s) >= HYPERSPACE_DEATH_CHANCE
      if (survived !== shouldSurvive) mismatches++
    }
    expect(mismatches).toBe(0)
  })
})

// ---- rollHyperspacePosition --------------------------------------------------

describe('A-14 rollHyperspacePosition — two draws, inside the edge-inset band', () => {
  it('lands both axes within [margin, 1-margin] * bounds', () => {
    for (const seed of [1, 5, 50, 500, 5000]) {
      const p = rollHyperspacePosition({ seed }, BOUNDS)
      expect(p.x).toBeGreaterThanOrEqual(HYPERSPACE_EDGE_MARGIN * WORLD_W - 1e-6)
      expect(p.x).toBeLessThanOrEqual((1 - HYPERSPACE_EDGE_MARGIN) * WORLD_W + 1e-6)
      expect(p.y).toBeGreaterThanOrEqual(HYPERSPACE_EDGE_MARGIN * WORLD_H - 1e-6)
      expect(p.y).toBeLessThanOrEqual((1 - HYPERSPACE_EDGE_MARGIN) * WORLD_H + 1e-6)
    }
  })

  it('consumes EXACTLY two RNG draws (one per axis)', () => {
    const r = { seed: 24 }
    rollHyperspacePosition(r, BOUNDS)
    expect(r.seed).toBe(seedAfter(24, 2))
  })

  it('is deterministic for a given seed', () => {
    expect(rollHyperspacePosition({ seed: 31337 }, BOUNDS)).toEqual(
      rollHyperspacePosition({ seed: 31337 }, BOUNDS),
    )
  })
})

// ---- triggerHyperspace: the jump itself --------------------------------------

describe('A-14 triggerHyperspace — trigger gating', () => {
  it('is a no-op when hyperspace is not pressed', () => {
    const s = playing(SURVIVE_SEED)
    expect(triggerHyperspace(s, NO_INPUT)).toEqual(s)
  })

  it('is a no-op (and draws no RNG) while a jump window is already open (debounce)', () => {
    const s = playing(SURVIVE_SEED, { shipSpawnTimer: 0.5 })
    const after = triggerHyperspace(s, HYPER)
    expect(after.rng.seed).toBe(s.rng.seed) // no survival roll fired
    expect(after.ship.pos).toEqual(s.ship.pos) // not re-teleported
    expect(after.shipSpawnTimer).toBe(0.5) // untouched by trigger (sim decays it)
  })

  it('is a no-op while the ship is already dead', () => {
    const s = playing(SURVIVE_SEED, { shipDestroyed: true })
    const after = triggerHyperspace(s, HYPER)
    expect(after.rng.seed).toBe(s.rng.seed)
    expect(after.shipDestroyed).toBe(true)
    expect(after.ship.pos).toEqual(s.ship.pos)
  })
})

describe('A-14 triggerHyperspace — successful jump (survival roll passes)', () => {
  const before = playing(SURVIVE_SEED)
  const after = triggerHyperspace(before, HYPER)

  it('repositions the ship inside the edge-inset band on both axes', () => {
    expect(after.ship.pos.x).toBeGreaterThanOrEqual(HYPERSPACE_EDGE_MARGIN * WORLD_W - 1e-6)
    expect(after.ship.pos.x).toBeLessThanOrEqual((1 - HYPERSPACE_EDGE_MARGIN) * WORLD_W + 1e-6)
    expect(after.ship.pos.y).toBeGreaterThanOrEqual(HYPERSPACE_EDGE_MARGIN * WORLD_H - 1e-6)
    expect(after.ship.pos.y).toBeLessThanOrEqual((1 - HYPERSPACE_EDGE_MARGIN) * WORLD_H + 1e-6)
  })

  it('zeroes momentum, hides the ship, and arms the window — all at once', () => {
    expect(after.ship.vel).toEqual({ x: 0, y: 0 })
    expect(after.ship.visible).toBe(false)
    expect(after.shipSpawnTimer).toBeCloseTo(HYPERSPACE_TIMER_S)
    expect(after.shipDestroyed).toBe(false) // a successful jump is NOT a death
  })

  it('advances the RNG (a jump is not free of the stream)', () => {
    expect(after.rng.seed).not.toBe(before.rng.seed)
  })
})

describe('A-14 triggerHyperspace — failed jump (survival roll fails) is a ship death', () => {
  const before = playing(DIE_SEED)
  const after = triggerHyperspace(before, HYPER)

  it('routes into the A-8/A-15 death: latches shipDestroyed and spends a life', () => {
    expect(after.shipDestroyed).toBe(true)
    expect(after.lives).toBe(before.lives - 1) // handleShipDeath, exactly once
  })

  it('does NOT reposition — a failed jump dies where it stood, not somewhere new', () => {
    expect(after.ship.pos).toEqual(before.ship.pos)
    expect(after.shipSpawnTimer).toBe(0) // no hyperspace window on a failed jump
  })
})

// ---- Ship.visible default ----------------------------------------------------

describe('A-14 Ship.visible — the new hidden-window field', () => {
  it('a freshly dealt ship is visible', () => {
    expect(initialState(1).ship.visible).toBe(true)
  })
})

// ---- stepGame wiring ---------------------------------------------------------

describe('A-14 stepGame — hyperspace is actually READ (was inert since A-2)', () => {
  it('pressing hyperspace changes the outcome vs not pressing it', () => {
    const base = playing(SURVIVE_SEED)
    const withJump = stepGame(base, HYPER, DT)
    const without = stepGame(base, NO_INPUT, DT)
    expect(withJump).not.toEqual(without)
  })

  it('is deterministic — identical (seed, input script, dt) replays bit-for-bit', () => {
    const script: Input[] = [HYPER, NO_INPUT, NO_INPUT, HYPER, NO_INPUT, NO_INPUT, NO_INPUT]
    const run = (): GameState => {
      let s = playing(SURVIVE_SEED)
      for (const inp of script) s = stepGame(s, inp, DT)
      return s
    }
    expect(run()).toEqual(run())
  })
})

describe('A-14 stepGame — the hidden/invulnerable window drains and reveals', () => {
  // Start mid-window: hidden ship, timer armed to a full hyperspace jump. The
  // ship is hidden+invulnerable, so no collision can perturb the countdown.
  const hiddenShip: Ship = { ...initialState(1).ship, visible: false }
  const armed = playing(SURVIVE_SEED, { ship: hiddenShip, shipSpawnTimer: HYPERSPACE_TIMER_S })

  it('stays hidden every tick the timer is still running, then reveals at zero', () => {
    let s = armed
    let ticks = 0
    while (s.shipSpawnTimer > 0 && ticks < 200) {
      expect(s.ship.visible).toBe(false) // hidden for the whole window
      s = stepGame(s, NO_INPUT, DT)
      ticks++
    }
    expect(s.shipSpawnTimer).toBe(0) // clamped to exactly zero, never negative
    expect(s.ship.visible).toBe(true) // revealed on the tick it reaches zero
    expect(ticks).toBeGreaterThanOrEqual(48) // ~48 frames @ 60Hz (float tolerant)
    expect(ticks).toBeLessThanOrEqual(49)
  })

  it('does not re-trigger a jump while the window is open, even with hyperspace held', () => {
    // A second jump would draw RNG and re-arm the timer to a fresh full window;
    // holding the key must not do that — the window guard blocks it mid-jump.
    const afterHold = stepGame(armed, HYPER, DT)
    expect(afterHold.shipSpawnTimer).toBeLessThan(HYPERSPACE_TIMER_S) // decayed, not re-armed
    expect(afterHold.ship.visible).toBe(false) // still mid-window
  })
})

// ==== RED REWORK (round-trip 1) — reviewer-confirmed HIGH defects ================
// Review found (all empirically confirmed): a FAILED jump was silent — no
// explosion event, and no thrust-stop for a thrusting death — because sim.ts's
// event edge re-reads the post-jump `shipDestroyed`; and a HELD hyperspace key
// auto-repeats jumps once the window closes (no edge debounce). These pin the
// correct behavior: a failed jump is a complete ship death like any other, and
// hyperspace is edge-triggered like fire/thrust/start.

describe('A-14 stepGame — a failed hyperspace jump is a COMPLETE ship death (rework RT1)', () => {
  it('emits a ship-explosion and spends exactly one life (no double-count)', () => {
    const out = stepGame(playing(DIE_SEED, { lives: 3 }), HYPER, DT)
    expect(out.shipDestroyed).toBe(true)
    expect(out.lives).toBe(2) // exactly one death — not two (no double handleShipDeath)
    // every other ship death emits this cue (see events.test.ts / sim.ts); a
    // failed jump must not be the silent exception.
    expect(out.events).toContainEqual({ type: 'explosion', source: 'ship' })
  })

  it('stops a still-thrusting engine on a failed jump (thrust-stop event)', () => {
    const out = stepGame(playing(DIE_SEED, { thrustPrev: true }), { ...HYPER, thrust: true }, DT)
    expect(out.shipDestroyed).toBe(true)
    // the engine hum must not drone on through gameover — the same guard a
    // collision death gets.
    expect(out.events).toContainEqual({ type: 'thrust-stop' })
  })

  it('ends the run when the LAST ship self-destructs (gameover)', () => {
    const out = stepGame(playing(DIE_SEED, { lives: 1 }), HYPER, DT)
    expect(out.mode).toBe('gameover')
    expect(out.lives).toBe(0)
    expect(out.gameOver).not.toBeNull()
  })
})

describe('A-14 hyperspace is EDGE-triggered — a held key does not auto-repeat (rework RT1)', () => {
  it('does not re-trigger a jump when hyperspace is HELD across the window closing', () => {
    let s = stepGame(playing(SURVIVE_SEED), HYPER, DT) // exactly one jump
    expect(s.shipSpawnTimer).toBeGreaterThan(0)
    expect(s.shipDestroyed).toBe(false)
    let windowClosed = false
    let retriggered = false
    for (let i = 0; i < 60; i++) {
      const prevTimer = s.shipSpawnTimer
      s = stepGame(s, HYPER, DT) // key stays HELD the whole time
      if (prevTimer > 0 && s.shipSpawnTimer === 0) windowClosed = true
      // once the window has closed, a fresh window OR a death means a second jump
      // auto-fired off the held key — the bug this rework fixes.
      if (windowClosed && prevTimer === 0 && (s.shipSpawnTimer > 0 || s.shipDestroyed)) {
        retriggered = true
      }
    }
    expect(windowClosed).toBe(true) // sanity: the first window drained during the loop
    expect(retriggered).toBe(false) // a held panic button fires ONCE, never repeats
  })

  it('re-arms after the key is released — a fresh press still jumps (no permanent latch)', () => {
    let s = stepGame(playing(SURVIVE_SEED), HYPER, DT) // jump 1
    let ticks = 0
    while (s.shipSpawnTimer > 0 && ticks < 100) {
      s = stepGame(s, NO_INPUT, DT) // drain with the key RELEASED — no auto-repeat either way
      ticks++
    }
    expect(s.shipSpawnTimer).toBe(0)
    expect(s.shipDestroyed).toBe(false)
    const afterSecondPress = stepGame(s, HYPER, DT) // a distinct new press
    // must act (new window or death), proving the edge-guard isn't a one-jump-ever latch
    expect(afterSecondPress.shipSpawnTimer > 0 || afterSecondPress.shipDestroyed).toBe(true)
  })
})

describe('A-14 rollHyperspacePosition — axis-draw order is pinned (rework RT1)', () => {
  it('feeds the first draw to x and the second to y (golden — catches a swap)', () => {
    const seed = 31337
    const r = { seed }
    const span = 1 - 2 * HYPERSPACE_EDGE_MARGIN
    const expectedX = (HYPERSPACE_EDGE_MARGIN + nextFloat(r) * span) * WORLD_W
    const expectedY = (HYPERSPACE_EDGE_MARGIN + nextFloat(r) * span) * WORLD_H
    expect(rollHyperspacePosition({ seed }, BOUNDS)).toEqual({ x: expectedX, y: expectedY })
  })
})
