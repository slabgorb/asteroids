// tests/waves.test.ts
//
// A-10: the WAVE DIRECTOR — how many rocks a wave has, where they appear, and
// when the next wave starts. Rocks-only: A-9 scoring, A-11+ saucers, A-4 bullets
// are untouched here (the director's saucer-cleared check is a forward-compatible
// no-op until A-11 lands a live saucer).
//
// Established formula (epic; ROM fetch excerpts noisy/inconclusive → verify vs the
// reference/ quarry in A-17): waveRockCount(wave) = min(4 + 2*(wave-1), 11).
//
// Provisional constants (named + isolated so A-17's quarry read is a data-only
// swap, not a refactor):
//   WAVE_DELAY_S        — a multi-frame pause (~2s @ 60Hz) before the next wave;
//                         two differently-addressed ROM timers land in the same
//                         ballpark, exact cadence unconfirmed. Only "a positive
//                         delay exists and is honored" is pinned, never a magnitude.
//   Rock spawn position — playfield EDGE (one coordinate pinned to a bound); no
//                         literal rock-spawn code found, inferred from the saucer
//                         edge-spawn pattern + arcade lore. Verify vs quarry (A-17).
//   Rock spawn heading  — uniform [0, 2π). Not in excerpts; simplest ROM-plausible
//                         default. Verify vs quarry (A-17).
//   MAX_OBJECTS_ON_SCREEN = 27 — engine's own on-screen budget; the ROM-side
//                         meaning is ambiguous between the two sources, retained as
//                         our guard number regardless.
//
// Carry-forward from A-6/A-7 (both done, merged to develop):
//   - `spawnRock(rng, size, bounds)` places rocks INSIDE bounds and takes NO
//     caller-supplied position — so the wave director must build its own EDGE
//     rocks; it cannot reuse spawnRock for placement.
//   - The rock drift field is `velocity` (not `vel`); units are world-units per
//     60 Hz frame.
//   - RNG DISCIPLINE (the crux): spawn draws MUTATE the rng in place. Anything
//     the director runs inside stepGame must CLONE state.rng before drawing and
//     thread the advanced clone forward — never advance state.rng directly.
//
// RED until core/waves.ts exports waveRockCount / pickEdgeSpawn / spawnWave /
// updateWaveDirector + the constants, GameState gains `waveTransitionTimer`, and
// stepGame wires the director in. The failing named imports below fail the whole
// suite until then.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  waveRockCount,
  pickEdgeSpawn,
  spawnWave,
  updateWaveDirector,
  STARTING_ROCKS_BASE,
  STARTING_ROCKS_PER_WAVE,
  STARTING_ROCKS_CAP,
  MAX_OBJECTS_ON_SCREEN,
  WAVE_DELAY_S,
} from '../src/core/waves'
import { type Bounds } from '../src/core/bounds'
import { ROCK_SPEED_MIN, ROCK_SPEED_MAX, ROCK_SHAPE_VARIANT_COUNT } from '../src/core/rocks'
import {
  initialState,
  WORLD_W,
  WORLD_H,
  type GameState,
  type Vec2,
  type Saucer,
} from '../src/core/state'
import { createRng, type Rng } from '../src/core/rng'
import { stepGame } from '../src/core/sim'
import { NO_INPUT } from '../src/core/input'

const DT = 1 / 60
const WORLD_BOUNDS: Bounds = { width: WORLD_W, height: WORLD_H }
const TINY_BOUNDS: Bounds = { width: 100, height: 50 }

// Ticks needed to cross the (provisional) delay at fixed dt — derived from the
// imported constant so an A-17 magnitude swap never breaks these tests.
const TICKS_TO_ARM = Math.ceil(WAVE_DELAY_S / DT)

/** True when a position sits exactly on the playfield boundary (a pinned edge
 * coordinate is a literal 0 / width / height, so exact equality is correct). */
function onBoundary(pos: Vec2, bounds: Bounds): boolean {
  return pos.x === 0 || pos.x === bounds.width || pos.y === 0 || pos.y === bounds.height
}

/** Which edge a boundary position lies on (corners have measure-zero probability
 * under random floats, so first-match classification is unambiguous in practice). */
function edgeOf(pos: Vec2, bounds: Bounds): string {
  if (pos.x === 0) return 'left'
  if (pos.x === bounds.width) return 'right'
  if (pos.y === 0) return 'top'
  if (pos.y === bounds.height) return 'bottom'
  return 'interior'
}

/** A playing-mode state that has JUST cleared a wave: no rocks, no saucer, timer
 * armed to the full delay (the value the director resets to after each spawn). */
function armedClear(seed: number, wave: number, timer: number = WAVE_DELAY_S): GameState {
  return {
    ...initialState(seed),
    mode: 'playing',
    wave,
    rocks: [],
    saucer: null,
    waveTransitionTimer: timer,
  }
}

/** Advance the director in isolation N times at fixed dt. */
function runDirector(state: GameState, ticks: number, dt: number = DT): GameState {
  let s = state
  for (let i = 0; i < ticks; i++) s = updateWaveDirector(s, dt)
  return s
}

/** Advance the whole sim N times with no input at fixed dt. */
function runStep(state: GameState, ticks: number, dt: number = DT): GameState {
  let s = state
  for (let i = 0; i < ticks; i++) s = stepGame(s, NO_INPUT, dt)
  return s
}

// ---------------------------------------------------------------------------
// Constants (provisional — verify vs ROM quarry in A-17)
// ---------------------------------------------------------------------------

describe('wave director constants (provisional — verify vs ROM quarry in A-17)', () => {
  it('pins the established starting-rock formula parts: base 4, +2/wave, cap 11', () => {
    expect(STARTING_ROCKS_BASE).toBe(4)
    expect(STARTING_ROCKS_PER_WAVE).toBe(2)
    expect(STARTING_ROCKS_CAP).toBe(11)
  })

  it('keeps the engine on-screen guard number at 27', () => {
    expect(MAX_OBJECTS_ON_SCREEN).toBe(27)
  })

  it('has a positive wave delay (a real multi-frame pause exists — not instant)', () => {
    expect(WAVE_DELAY_S).toBeGreaterThan(0)
    // One fixed-dt tick must not already cross it, or "not instant" is untestable.
    expect(WAVE_DELAY_S).toBeGreaterThan(DT)
  })

  it('orders the formula sensibly: cap is above the base, ramp is real', () => {
    expect(STARTING_ROCKS_CAP).toBeGreaterThan(STARTING_ROCKS_BASE)
    expect(STARTING_ROCKS_PER_WAVE).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// waveRockCount — table-driven ramp then cap (AC)
// ---------------------------------------------------------------------------

describe('waveRockCount — ramp of +2/wave, capped at 11 (AC)', () => {
  it('matches the acceptance table exactly (1→4, 2→6, 3→8, 4→10, 5→11, 6→11, 10→11)', () => {
    const table: ReadonlyArray<readonly [number, number]> = [
      [1, 4],
      [2, 6],
      [3, 8],
      [4, 10],
      [5, 11],
      [6, 11],
      [10, 11],
    ]
    for (const [wave, expected] of table) {
      expect(waveRockCount(wave), `wave ${wave}`).toBe(expected)
    }
  })

  it('caps at wave 5 where the uncapped ramp would give 12', () => {
    // Non-vacuity: prove the cap actually bites rather than the ramp merely
    // happening to equal 11 here.
    expect(STARTING_ROCKS_BASE + STARTING_ROCKS_PER_WAVE * (5 - 1)).toBe(12) // uncapped
    expect(waveRockCount(5)).toBe(STARTING_ROCKS_CAP) // capped
  })

  it('stays pinned at the cap for very large wave numbers', () => {
    expect(waveRockCount(20)).toBe(STARTING_ROCKS_CAP)
    expect(waveRockCount(100)).toBe(STARTING_ROCKS_CAP)
    expect(waveRockCount(1000)).toBe(STARTING_ROCKS_CAP)
  })

  it('is monotonic non-decreasing across waves 1..20', () => {
    for (let w = 2; w <= 20; w++) {
      expect(waveRockCount(w), `wave ${w} vs ${w - 1}`).toBeGreaterThanOrEqual(waveRockCount(w - 1))
    }
  })

  it('is exactly min(base + perWave*(wave-1), cap) — tied to the constants, not a hardcoded table', () => {
    for (let w = 1; w <= 20; w++) {
      const expected = Math.min(
        STARTING_ROCKS_BASE + STARTING_ROCKS_PER_WAVE * (w - 1),
        STARTING_ROCKS_CAP,
      )
      expect(waveRockCount(w), `wave ${w}`).toBe(expected)
    }
  })
})

// ---------------------------------------------------------------------------
// pickEdgeSpawn — edge placement + random heading (AC)
// ---------------------------------------------------------------------------

describe('pickEdgeSpawn — position on a playfield edge, random heading (AC)', () => {
  it('always places the point exactly on the boundary, never interior', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { position } = pickEdgeSpawn(createRng(seed), WORLD_BOUNDS)
      expect(onBoundary(position, WORLD_BOUNDS), `seed ${seed}: ${JSON.stringify(position)}`).toBe(
        true,
      )
    }
  })

  it('keeps both coordinates within the playfield ([0,width] x [0,height])', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { position } = pickEdgeSpawn(createRng(seed), WORLD_BOUNDS)
      expect(position.x).toBeGreaterThanOrEqual(0)
      expect(position.x).toBeLessThanOrEqual(WORLD_W)
      expect(position.y).toBeGreaterThanOrEqual(0)
      expect(position.y).toBeLessThanOrEqual(WORLD_H)
    }
  })

  it('exercises all four edges across a sample (not just one fixed edge)', () => {
    const edges = new Set<string>()
    for (let seed = 1; seed <= 300; seed++) {
      edges.add(edgeOf(pickEdgeSpawn(createRng(seed), WORLD_BOUNDS).position, WORLD_BOUNDS))
    }
    expect(edges.has('interior')).toBe(false)
    expect(edges).toEqual(new Set(['left', 'right', 'top', 'bottom']))
  })

  it('varies the position along the edge (not a single fixed point)', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) {
      const { position } = pickEdgeSpawn(createRng(seed), WORLD_BOUNDS)
      seen.add(`${position.x},${position.y}`)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('returns a heading in [0, 2π), and varies it across a sample', () => {
    const headings = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) {
      const { heading } = pickEdgeSpawn(createRng(seed), WORLD_BOUNDS)
      expect(heading).toBeGreaterThanOrEqual(0)
      expect(heading).toBeLessThan(2 * Math.PI)
      headings.add(heading.toFixed(3))
    }
    expect(headings.size).toBeGreaterThan(1)
  })

  it('is deterministic: identical seed → identical spawn', () => {
    expect(pickEdgeSpawn(createRng(2626), WORLD_BOUNDS)).toEqual(
      pickEdgeSpawn(createRng(2626), WORLD_BOUNDS),
    )
  })

  it('actually threads the seed: different seeds → different spawns', () => {
    expect(pickEdgeSpawn(createRng(1), WORLD_BOUNDS)).not.toEqual(
      pickEdgeSpawn(createRng(2), WORLD_BOUNDS),
    )
  })

  it('consumes randomness from the rng (advances the seed)', () => {
    const rng: Rng = createRng(1979)
    const before = rng.seed
    pickEdgeSpawn(rng, WORLD_BOUNDS)
    expect(rng.seed).not.toBe(before)
  })

  it('honors the PASSED bounds, not a hardcoded WORLD (edge is relative to tiny bounds)', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { position } = pickEdgeSpawn(createRng(seed), TINY_BOUNDS)
      expect(onBoundary(position, TINY_BOUNDS), `seed ${seed}`).toBe(true)
      expect(position.x).toBeLessThanOrEqual(TINY_BOUNDS.width)
      expect(position.y).toBeLessThanOrEqual(TINY_BOUNDS.height)
    }
  })
})

// ---------------------------------------------------------------------------
// spawnWave — count, tier, edge placement, drift, determinism (AC)
// ---------------------------------------------------------------------------

describe('spawnWave — count and tier (AC)', () => {
  it('spawns exactly waveRockCount(1) = 4 large rocks for wave 1', () => {
    const rocks = spawnWave(1, createRng(1979), WORLD_BOUNDS)
    expect(rocks).toHaveLength(waveRockCount(1))
    expect(rocks).toHaveLength(4)
    expect(rocks.every((r) => r.size === 'large')).toBe(true)
  })

  it('spawns exactly waveRockCount(wave) large rocks for a range of waves', () => {
    for (const wave of [1, 2, 3, 5, 7, 12]) {
      const rocks = spawnWave(wave, createRng(wave * 13 + 1), WORLD_BOUNDS)
      expect(rocks, `wave ${wave} count`).toHaveLength(waveRockCount(wave))
      expect(
        rocks.every((r) => r.size === 'large'),
        `wave ${wave} all large`,
      ).toBe(true)
    }
  })
})

describe('spawnWave — every rock is a valid, edge-placed, drifting large rock (AC)', () => {
  it('places every rock exactly on the playfield boundary — not an interior point', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const r of spawnWave(3, createRng(seed), WORLD_BOUNDS)) {
        expect(onBoundary(r.pos, WORLD_BOUNDS), `seed ${seed}: ${JSON.stringify(r.pos)}`).toBe(true)
      }
    }
  })

  it('gives every rock a real drift within the LARGE tier speed band', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const r of spawnWave(2, createRng(seed), WORLD_BOUNDS)) {
        const speed = Math.hypot(r.velocity.x, r.velocity.y)
        expect(speed, `seed ${seed}`).toBeGreaterThan(0) // never a stationary wave rock
        expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN.large - 1e-9)
        expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX.large + 1e-9)
      }
    }
  })

  it('assigns each rock an integer shapeVariant in [0, ROCK_SHAPE_VARIANT_COUNT)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const r of spawnWave(4, createRng(seed), WORLD_BOUNDS)) {
        expect(Number.isInteger(r.shapeVariant)).toBe(true)
        expect(r.shapeVariant).toBeGreaterThanOrEqual(0)
        expect(r.shapeVariant).toBeLessThan(ROCK_SHAPE_VARIANT_COUNT)
      }
    }
  })

  it('exposes exactly {pos, shapeVariant, size, velocity} on each rock — no stray fields', () => {
    for (const r of spawnWave(1, createRng(7), WORLD_BOUNDS)) {
      expect(Object.keys(r).sort()).toEqual(['pos', 'shapeVariant', 'size', 'velocity'])
    }
  })

  it('spreads a wave across more than one edge (rocks are not stacked on one side)', () => {
    // waveRockCount(6) = 11 large rocks; a real edge-picker lands them on
    // several edges, not a single hardcoded corner.
    const edges = new Set(
      spawnWave(6, createRng(1979), WORLD_BOUNDS).map((r) => edgeOf(r.pos, WORLD_BOUNDS)),
    )
    expect(edges.has('interior')).toBe(false)
    expect(edges.size).toBeGreaterThan(1)
  })

  it('honors the PASSED bounds (rocks land on the tiny boundary, not WORLD)', () => {
    for (const r of spawnWave(3, createRng(5), TINY_BOUNDS)) {
      expect(onBoundary(r.pos, TINY_BOUNDS)).toBe(true)
      expect(r.pos.x).toBeLessThanOrEqual(TINY_BOUNDS.width)
      expect(r.pos.y).toBeLessThanOrEqual(TINY_BOUNDS.height)
    }
  })
})

describe('spawnWave — determinism & rng threading (AC)', () => {
  it('is deterministic: identical seed → deeply-equal rock set (golden by determinism)', () => {
    const a = spawnWave(3, createRng(2626), WORLD_BOUNDS)
    const b = spawnWave(3, createRng(2626), WORLD_BOUNDS)
    expect(a).toEqual(b)
  })

  it('actually threads the seed: different seeds → different rock sets', () => {
    const a = spawnWave(3, createRng(1), WORLD_BOUNDS)
    const b = spawnWave(3, createRng(2), WORLD_BOUNDS)
    expect(a).not.toEqual(b)
  })

  it('consumes randomness from the rng (advances the seed)', () => {
    const rng: Rng = createRng(1979)
    const before = rng.seed
    spawnWave(1, rng, WORLD_BOUNDS)
    expect(rng.seed).not.toBe(before)
  })
})

// ---------------------------------------------------------------------------
// updateWaveDirector — dormant outside play (mode gate)
// ---------------------------------------------------------------------------

describe('updateWaveDirector — only runs during play (AC: mirrors updateShip gating)', () => {
  it('does nothing in attract mode even with an empty, armed field', () => {
    const s0: GameState = { ...armedClear(1, 0), mode: 'attract' }
    const s1 = runDirector(s0, TICKS_TO_ARM + 5)
    expect(s1.rocks).toHaveLength(0)
    expect(s1.wave).toBe(0)
  })

  it('does nothing in gameover mode even with an empty, armed field', () => {
    const s0: GameState = { ...armedClear(1, 3), mode: 'gameover' }
    const s1 = runDirector(s0, TICKS_TO_ARM + 5)
    expect(s1.rocks).toHaveLength(0)
    expect(s1.wave).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// updateWaveDirector — the delayed transition (AC crux)
// ---------------------------------------------------------------------------

describe('updateWaveDirector — wave transition is delayed, not instant (AC)', () => {
  it('does NOT spawn the next wave on the very tick the field became empty', () => {
    const s1 = updateWaveDirector(armedClear(1, 3), DT)
    expect(s1.rocks).toHaveLength(0) // still empty — instant spawn would fail here
    expect(s1.wave).toBe(3) // wave not yet advanced
    // The countdown actually ran: timer decreased but has not elapsed.
    expect(s1.waveTransitionTimer).toBeLessThan(WAVE_DELAY_S)
    expect(s1.waveTransitionTimer).toBeGreaterThan(0)
  })

  it('keeps the field empty while less than WAVE_DELAY_S has elapsed', () => {
    const s = runDirector(armedClear(1, 3), Math.max(1, Math.floor(TICKS_TO_ARM / 2)))
    expect(s.rocks).toHaveLength(0)
    expect(s.wave).toBe(3)
  })

  it('spawns the next wave once the delay is crossed, incrementing wave by exactly 1', () => {
    const s = runDirector(armedClear(1, 3), TICKS_TO_ARM + 5)
    expect(s.wave).toBe(4) // exactly +1, never +2
    expect(s.rocks).toHaveLength(waveRockCount(4)) // = 10
    expect(s.rocks.every((r) => r.size === 'large')).toBe(true)
    expect(s.rocks.every((r) => onBoundary(r.pos, WORLD_BOUNDS))).toBe(true)
  })

  it('re-arms the timer after spawning (ready for the NEXT transition)', () => {
    const s = runDirector(armedClear(1, 3), TICKS_TO_ARM + 5)
    expect(s.waveTransitionTimer).toBe(WAVE_DELAY_S)
  })

  it('spawns only ONE wave even when ticked far past the delay (rocks present → dormant)', () => {
    // Over-tick by a whole extra delay window; the field is now non-empty so the
    // director must not fire again — wave stays at 4, not 5.
    const s = runDirector(armedClear(1, 3), TICKS_TO_ARM * 2 + 20)
    expect(s.wave).toBe(4)
    expect(s.rocks).toHaveLength(waveRockCount(4))
  })
})

// ---------------------------------------------------------------------------
// updateWaveDirector — forward-compatible saucer gate
//
// The corroborated ROM trigger is "asteroid count is zero"; the story's design
// ALSO gates on `saucer === null` so a later live saucer (A-11+) blocks the next
// wave. The Saucer type already exists, so this half is pinned NOW to stop a dev
// from implementing rocks-only and silently regressing A-11's integration.
// ---------------------------------------------------------------------------

describe('updateWaveDirector — waits for a live saucer to clear too (forward-compat)', () => {
  it('does NOT spawn the next wave while a saucer is alive, even past the delay', () => {
    const saucer: Saucer = { pos: { x: 100, y: 100 }, velocity: { x: 0, y: 0 }, size: 'large', courseTimer: 0, fireTimer: 0 }
    const s0: GameState = { ...armedClear(1, 3), saucer }
    const s = runDirector(s0, TICKS_TO_ARM + 5)
    expect(s.rocks).toHaveLength(0)
    expect(s.wave).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// updateWaveDirector — game start reaches wave 1 via the SAME path (AC)
// ---------------------------------------------------------------------------

describe('updateWaveDirector — game start uses the same transition path (AC)', () => {
  it('initialState carries a numeric, non-negative waveTransitionTimer field', () => {
    const timer = initialState(1).waveTransitionTimer
    expect(typeof timer).toBe('number')
    expect(timer).toBeGreaterThanOrEqual(0)
  })

  it('reaches wave 1 with 4 edge-placed large rocks from a fresh playing state — no special first-spawn branch', () => {
    // initialState() already satisfies the clear condition (wave 0, empty rocks,
    // saucer null); flipping to play and running the SAME director produces wave 1.
    const start: GameState = { ...initialState(1979), mode: 'playing' }
    const s = runDirector(start, TICKS_TO_ARM + 5)
    expect(s.wave).toBe(1)
    expect(s.rocks).toHaveLength(waveRockCount(1)) // = 4
    expect(s.rocks.every((r) => r.size === 'large')).toBe(true)
    expect(s.rocks.every((r) => onBoundary(r.pos, WORLD_BOUNDS))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// updateWaveDirector — determinism, purity, RNG-clone discipline (AC + carry-forward)
// ---------------------------------------------------------------------------

describe('updateWaveDirector — determinism & purity (AC)', () => {
  it('is deterministic across the full transition: identical states tick to deeply-equal results', () => {
    const build = (): GameState => armedClear(2626, 2)
    let a = build()
    let b = build()
    for (let i = 0; i < TICKS_TO_ARM + 5; i++) {
      a = updateWaveDirector(a, DT)
      b = updateWaveDirector(b, DT)
    }
    expect(a).toEqual(b)
    expect(a.wave).toBe(3) // sanity: the run really did spawn
    expect(a.rocks).toHaveLength(waveRockCount(3))
  })

  it('never mutates the input state — including state.rng — across a spawning run (clone discipline)', () => {
    // The crux carry-forward: spawnWave mutates the rng it is GIVEN, so the
    // director must clone state.rng first. If it passes state.rng in place, this
    // snapshot equality fails on the seed.
    const s0 = armedClear(42, 2)
    const snapshot = structuredClone(s0)
    runDirector(s0, TICKS_TO_ARM + 5)
    expect(s0).toEqual(snapshot)
  })

  it('threads the ADVANCED rng forward on a spawning tick (the spawn actually drew from it)', () => {
    const s0 = armedClear(42, 2)
    const s = runDirector(s0, TICKS_TO_ARM + 5)
    expect(s.rng.seed).not.toBe(s0.rng.seed) // advanced by the spawn draws
    expect(s0.rng.seed).toBe(createRng(42).seed) // input seed left untouched
  })

  it('returns a fresh state object on a countdown tick (immutable-return discipline)', () => {
    const s0 = armedClear(1, 3)
    expect(updateWaveDirector(s0, DT)).not.toBe(s0)
  })

  it('a countdown tick draws NO randomness (only the spawn tick consumes the rng)', () => {
    // Ticking mid-delay must not advance the seed, or the spawn's draw sequence
    // shifts with frame timing and the run stops being reproducible.
    const s0 = armedClear(7, 3)
    const s1 = updateWaveDirector(s0, DT) // still counting down, no spawn
    expect(s1.rocks).toHaveLength(0)
    expect(s1.rng.seed).toBe(s0.rng.seed)
  })
})

// ---------------------------------------------------------------------------
// stepGame wiring — the director runs inside the step (AC)
// ---------------------------------------------------------------------------

describe('stepGame — drives the wave director during play (AC)', () => {
  it('spawns wave 1 from a fresh playing state after the delay', () => {
    const start: GameState = { ...initialState(1979), mode: 'playing' }
    const s = runStep(start, TICKS_TO_ARM + 5)
    expect(s.wave).toBe(1)
    expect(s.rocks.length).toBeGreaterThan(0)
    expect(s.rocks.every((r) => r.size === 'large')).toBe(true)
  })

  it('does NOT spawn waves in attract mode (director dormant when not playing)', () => {
    const s = runStep(initialState(1979), TICKS_TO_ARM + 20) // stays in attract
    expect(s.mode).toBe('attract')
    expect(s.rocks).toHaveLength(0)
    expect(s.wave).toBe(0)
  })

  it('threads the advanced rng seed forward once a wave spawns', () => {
    const start: GameState = { ...initialState(1979), mode: 'playing' }
    const s = runStep(start, TICKS_TO_ARM + 5)
    expect(s.rng.seed).not.toBe(start.rng.seed)
  })

  it('stays deterministic through a spawning step run (same seed + input → equal states)', () => {
    const build = (): GameState => ({ ...initialState(2024), mode: 'playing' })
    const a = runStep(build(), TICKS_TO_ARM + 5)
    const b = runStep(build(), TICKS_TO_ARM + 5)
    expect(a).toEqual(b)
    expect(a.wave).toBe(1) // sanity: a wave really spawned
  })

  it('does not mutate the input state', () => {
    const s0: GameState = { ...initialState(42), mode: 'playing' }
    const snapshot = structuredClone(s0)
    stepGame(s0, NO_INPUT, DT)
    expect(s0).toEqual(snapshot)
  })
})

// ---------------------------------------------------------------------------
// 27-object on-screen guard — formula-level (AC)
//
// Scope today is rocks + ship ONLY; bullets (A-4) and saucer (A-11+) aren't in
// the dynamic count yet, and each must extend this guard once its entity exists.
// ---------------------------------------------------------------------------

describe('27-object on-screen guard (rocks + ship, formula-level) (AC)', () => {
  it('keeps waveRockCount(wave) + 1 within MAX_OBJECTS_ON_SCREEN for waves 1..20', () => {
    for (let w = 1; w <= 20; w++) {
      expect(waveRockCount(w) + 1, `wave ${w}`).toBeLessThanOrEqual(MAX_OBJECTS_ON_SCREEN)
    }
  })

  it('actually reaches the rock cap within that range (guard tested at the peak, not just early waves)', () => {
    // Non-vacuity: the guard would be meaningless if the count never approached
    // the budget. Confirm the peak (cap) is exercised inside 1..20.
    expect(waveRockCount(20)).toBe(STARTING_ROCKS_CAP)
    expect(STARTING_ROCKS_CAP + 1).toBeLessThanOrEqual(MAX_OBJECTS_ON_SCREEN)
  })
})

// ---------------------------------------------------------------------------
// Rule enforcement: core/waves.ts stays pure & type-safe (lang-review #1 + epic rule)
//
// core-boundary.test.ts already scans EVERY core/*.ts for banned globals, so this
// is belt-and-suspenders on the new file plus the `as any` (type-safety escape)
// check the boundary guard does not cover.
// ---------------------------------------------------------------------------

describe('core/waves.ts source hygiene (determinism + type safety)', () => {
  const src = (): string =>
    readFileSync(fileURLToPath(new URL('../src/core/waves.ts', import.meta.url)), 'utf8')

  it('is the real wave-director module (non-vacuous scan target)', () => {
    const s = src()
    expect(s.length).toBeGreaterThan(0)
    expect(/\bspawnWave\b/.test(s)).toBe(true)
    expect(/\bupdateWaveDirector\b/.test(s)).toBe(true)
  })

  it('never reaches for wall-clock or entropy globals (all randomness via state.rng)', () => {
    const s = src()
    expect(/\bMath\s*\.\s*random\s*\(/.test(s)).toBe(false)
    expect(/\bDate\s*\.\s*now\s*\(/.test(s)).toBe(false)
    expect(/\bperformance\s*\.\s*now\s*\(/.test(s)).toBe(false)
  })

  it('does not defeat the type system with `as any`', () => {
    expect(/\bas\s+any\b/.test(src())).toBe(false)
  })
})
