// tests/saucer.test.ts
//
// A-11: the LARGE SAUCER — a countdown-spawned enemy that crosses the field
// horizontally, weaves with periodic vertical course changes, and fires at
// RANDOM headings on a cadence. This is the foundation A-12 (small saucer +
// aimed fire) and A-13 (scoring/collision/siren) build on, so the observable
// contract is pinned here.
//
// Sources (both fetched for saucer behaviour, mutually corroborating on the
// single-saucer invariant, fire cadence, and course-change mechanism; conflicting
// on bullet count, entry-side wiring, and several byte values):
// computerarcheology.com/Arcade/Asteroids/Code.html and
// 6502disassembly.com/va-asteroids/Asteroids.html. Every magnitude below is
// PROVISIONAL — these tests pin STRUCTURE and MECHANISM (drawn-from-a-table,
// on-the-cadence, into-the-field, capped, deterministic) but never a raw byte,
// so A-17's quarry port is a constant swap, not a test rewrite.
//
// Design of this suite:
//   * The spawn DIRECTOR (updateSpawnDirector) is a GameState→GameState step,
//     exactly like A-10's updateWaveDirector, and is tested in ISOLATION on
//     controlled states — the crisp seam for the single-saucer + ship-gate ACs.
//   * Every other behaviour (crossing, despawn, zigzag, fire, bullet lifecycle)
//     is wired into stepGame and observed THROUGH it. A live saucer gates the
//     wave director (waves.ts: `saucer === null`), so a run that starts with a
//     spawned saucer never spawns rocks and the centre-spawned ship can never be
//     hit — the observation window is deterministic and non-flaky.
//   * No Saucer is ever hand-built: it is always produced by the real director,
//     so these tests never couple to the saucer's internal timer field names.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  initialState,
  WORLD_W,
  WORLD_H,
  type GameState,
  type Saucer,
} from '../src/core/state'
import {
  updateSpawnDirector,
  SAUCER_SPEED,
  SAUCER_SPAWN_TIMER_INITIAL,
  SAUCER_SPAWN_TIMER_FLOOR,
  SAUCER_COURSE_CHANGE_INTERVAL,
  SAUCER_VERTICAL_SPEEDS,
  SAUCER_FIRE_INTERVAL,
  SAUCER_MAX_BULLETS,
  SAUCER_BULLET_LIFETIME,
  SAUCER_BULLET_SPEED,
} from '../src/core/saucer'
import { stepGame } from '../src/core/sim'
import { NO_INPUT, type Input } from '../src/core/input'
import { MAX_OBJECTS_ON_SCREEN, STARTING_ROCKS_CAP } from '../src/core/waves'
import { MAX_PLAYER_SHOTS } from '../src/core/bullet'

const DT = 1 / 60
const FIRE: Input = { ...NO_INPUT, fire: true }

/** Ticks to run a spawn director before giving up — a few full initial cadences
 * so an arm-on-first-tick or a pre-armed timer both land a spawn in the window. */
const spawnWindow = (): number => Math.ceil(SAUCER_SPAWN_TIMER_INITIAL / DT) * 3 + 20

/** A playing-mode state (attract → playing) with optional field overrides. */
function playing(seed: number, over: Partial<GameState> = {}): GameState {
  return { ...initialState(seed), mode: 'playing', ...over }
}

/** Narrow `state.saucer` to a non-null Saucer without a `!` assertion (the TS
 * review checklist bans non-null assertions on runtime-nullable values). */
function requireSaucer(s: GameState): Saucer {
  const sc = s.saucer
  if (sc === null) throw new Error('expected a live saucer, got null')
  return sc
}

/** Advance the spawn director in isolation N times at fixed dt. */
function runDirector(state: GameState, ticks: number): GameState {
  let s = state
  for (let i = 0; i < ticks; i++) s = updateSpawnDirector(s, DT)
  return s
}

/** Run the spawn director on a FRESH playing field (no rocks) until it lands a
 * live saucer. The returned state has `rocks: []` and `saucer !== null`, so
 * feeding it to stepGame keeps the wave director gated and the ship safe. */
function spawnLiveSaucer(seed: number): GameState {
  let s = playing(seed)
  const cap = spawnWindow()
  for (let i = 0; i < cap; i++) {
    s = updateSpawnDirector(s, DT)
    if (s.saucer !== null) return s
  }
  return s // still null → non-null assertions below fail loudly (correct in RED)
}

/** Shortest unsigned angular distance between two headings, in [0, π]. */
function angDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI)
  return d > Math.PI ? 2 * Math.PI - d : d
}

// ---------------------------------------------------------------------------
// Constants — provisional; verify vs ROM quarry in A-17. Pin STRUCTURE only.
// ---------------------------------------------------------------------------

describe('large saucer constants (provisional — verify vs ROM quarry in A-17)', () => {
  it('has a positive crossing speed and positive fire/course cadences', () => {
    expect(SAUCER_SPEED).toBeGreaterThan(0)
    expect(SAUCER_FIRE_INTERVAL).toBeGreaterThan(0)
    expect(SAUCER_COURSE_CHANGE_INTERVAL).toBeGreaterThan(0)
  })

  it('shrinks the spawn cadence toward a positive floor as difficulty rises', () => {
    // Both sources agree the reload shrinks as the game gets harder; the exact
    // cadence/floor bytes differ (verify vs quarry). Pin only the ordering that
    // makes "shrink toward a floor" meaningful — never the magnitudes.
    expect(SAUCER_SPAWN_TIMER_INITIAL).toBeGreaterThan(0)
    expect(SAUCER_SPAWN_TIMER_FLOOR).toBeGreaterThan(0)
    expect(SAUCER_SPAWN_TIMER_FLOOR).toBeLessThan(SAUCER_SPAWN_TIMER_INITIAL)
  })

  it('draws vertical course changes from a 4-entry table, biased toward horizontal runs', () => {
    // A 2-bit RNG index into a small table is corroborated by both sources; the
    // "cross pattern" of the title needs both up and down legs, and one source
    // notes zero-entries that keep the saucer mostly horizontal.
    expect(SAUCER_VERTICAL_SPEEDS.length).toBe(4)
    expect(SAUCER_VERTICAL_SPEEDS.every((v) => Math.abs(v) <= SAUCER_SPEED)).toBe(true)
    expect(SAUCER_VERTICAL_SPEEDS.some((v) => v === 0)).toBe(true) // a no-vertical leg exists
    expect(SAUCER_VERTICAL_SPEEDS.some((v) => v > 0)).toBe(true) // weaves down
    expect(SAUCER_VERTICAL_SPEEDS.some((v) => v < 0)).toBe(true) // weaves up
  })

  it('caps saucer bullets at a small positive integer with a finite life and positive speed', () => {
    expect(Number.isInteger(SAUCER_MAX_BULLETS)).toBe(true)
    expect(SAUCER_MAX_BULLETS).toBeGreaterThanOrEqual(1)
    expect(SAUCER_BULLET_LIFETIME).toBeGreaterThan(0)
    expect(SAUCER_BULLET_SPEED).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Spawn director — cadence, single-saucer invariant, ship gate (AC).
// Tested in isolation on GameState, mirroring A-10's updateWaveDirector tests.
// ---------------------------------------------------------------------------

describe('updateSpawnDirector — spawn cadence & single-saucer invariant (AC)', () => {
  it('spawns exactly one large saucer when the countdown expires (none before, one after)', () => {
    let s = playing(1979)
    expect(s.saucer).toBeNull()
    let spawnedAt = -1
    for (let i = 0; i < spawnWindow(); i++) {
      s = updateSpawnDirector(s, DT)
      if (s.saucer !== null) {
        spawnedAt = i
        break
      }
    }
    expect(spawnedAt).toBeGreaterThanOrEqual(0) // it spawned within a bounded window
    const sc = requireSaucer(s)
    expect(Math.abs(sc.velocity.x)).toBe(SAUCER_SPEED) // crosses at the horizontal speed
  })

  it('does not spawn a second saucer while one is alive (single-saucer invariant)', () => {
    const spawned = spawnLiveSaucer(1979)
    const live = requireSaucer(spawned)
    // Run the director far past another full spawn interval. It must NOT replace
    // the live saucer (movement is stepGame's job — the director only spawns), so
    // the reference is untouched.
    const s = runDirector(spawned, spawnWindow())
    expect(s.saucer).toBe(live)
  })

  it('does not spawn while the ship is destroyed, but does once the ship is alive', () => {
    // Ship dead/exploding → no saucer even long past the cadence.
    const dead = runDirector(playing(1979, { shipDestroyed: true }), spawnWindow())
    expect(dead.saucer).toBeNull()

    // Same seed & window, ship alive → a saucer DOES spawn. Proves the GATE (not
    // an unlucky seed) suppressed the spawn above.
    let alive = playing(1979, { shipDestroyed: false })
    let spawned = false
    for (let i = 0; i < spawnWindow(); i++) {
      alive = updateSpawnDirector(alive, DT)
      if (alive.saucer !== null) {
        spawned = true
        break
      }
    }
    expect(spawned).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Spawn director — entry side, edge placement, determinism & purity (AC).
// ---------------------------------------------------------------------------

describe('updateSpawnDirector — entry side, edge placement & determinism (AC)', () => {
  it('enters from a left/right edge with horizontal velocity pointing into the field', () => {
    const sc = requireSaucer(spawnLiveSaucer(1979))
    const onLeft = sc.pos.x === 0
    const onRight = sc.pos.x === WORLD_W
    expect(onLeft || onRight).toBe(true) // pinned to a vertical edge, not mid-field
    if (onLeft) expect(sc.velocity.x).toBeGreaterThan(0) // moving right, into the field
    if (onRight) expect(sc.velocity.x).toBeLessThan(0) // moving left, into the field
    expect(sc.pos.y).toBeGreaterThanOrEqual(0)
    expect(sc.pos.y).toBeLessThanOrEqual(WORLD_H)
  })

  it('picks the entry side randomly — both left and right occur across seeds', () => {
    const sides = new Set<string>()
    for (const seed of [1979, 2024, 4242, 777, 31337, 90210, 5, 8675309, 12, 65535, 101, 2600]) {
      const sc = requireSaucer(spawnLiveSaucer(seed))
      sides.add(sc.pos.x === 0 ? 'left' : sc.pos.x === WORLD_W ? 'right' : 'interior')
    }
    expect(sides.has('left')).toBe(true)
    expect(sides.has('right')).toBe(true)
    expect(sides.has('interior')).toBe(false) // always an edge entry
  })

  it('is deterministic and pure: identical states spawn deeply-equal saucers, input untouched', () => {
    const a = playing(4242)
    const snapshot = structuredClone(a)
    const ra = runDirector(a, spawnWindow())
    const rb = runDirector(playing(4242), spawnWindow())
    expect(ra).toEqual(rb) // deterministic
    expect(a).toEqual(snapshot) // the director never mutated the caller's state or rng
  })
})

// ---------------------------------------------------------------------------
// Horizontal crossing & edge despawn — no wrap (AC). Observed through stepGame.
// ---------------------------------------------------------------------------

describe('large saucer — crosses the field and despawns on the far edge, never wraps (AC)', () => {
  it('drifts at a constant horizontal speed and despawns (saucer → null) without wrapping', () => {
    const start = spawnLiveSaucer(1979)
    const vx = requireSaucer(start).velocity.x
    const maxTicks = Math.ceil(WORLD_W / SAUCER_SPEED) + 200

    const xs: number[] = []
    let s = start
    let despawnTick = -1
    for (let i = 0; i < maxTicks; i++) {
      s = stepGame(s, NO_INPUT, DT)
      if (s.saucer === null) {
        despawnTick = i
        break
      }
      const sc = requireSaucer(s)
      expect(sc.velocity.x).toBe(vx) // zigzag never touches horizontal speed
      xs.push(sc.pos.x)
    }

    expect(despawnTick).toBeGreaterThan(0) // it left the field (did not wrap forever)
    expect(xs.length).toBeGreaterThan(0)
    for (let i = 1; i < xs.length; i++) {
      const step = xs[i] - xs[i - 1]
      expect(Math.sign(step)).toBe(Math.sign(vx)) // monotonic — never reverses
      expect(Math.abs(step)).toBeLessThan(WORLD_W / 2) // never a wrap-sized jump
    }
  })
})

// ---------------------------------------------------------------------------
// Zigzag vertical course changes — only on the cadence, drawn from the table (AC).
// ---------------------------------------------------------------------------

describe('large saucer — zigzag vertical course changes (AC)', () => {
  it('changes vertical velocity only on the course cadence, always drawing from the table', () => {
    const period = Math.round(SAUCER_COURSE_CHANGE_INTERVAL / DT)
    const seenVy = new Set<number>()

    for (const seed of [1979, 2024, 4242, 777, 31337, 90210]) {
      const start = spawnLiveSaucer(seed)
      const vys: number[] = [requireSaucer(start).velocity.y] // index 0 = spawn tick
      let s = start
      for (let i = 0; i < period * 4 + 5; i++) {
        s = stepGame(s, NO_INPUT, DT)
        if (s.saucer === null) break
        vys.push(requireSaucer(s).velocity.y)
      }

      for (const vy of vys) {
        expect(SAUCER_VERTICAL_SPEEDS.includes(vy), `vy ${vy} (seed ${seed}) off the table`).toBe(true)
        seenVy.add(vy)
      }
      // Every CHANGE lands on a course-cadence boundary (±1 frame for dt-quantised
      // countdown). Same-value rerolls are invisible here — that's fine; the AC is
      // "changes ONLY at the cadence", not "changes every cadence".
      for (let i = 1; i < vys.length; i++) {
        if (vys[i] !== vys[i - 1]) {
          const phase = i % period
          expect(Math.min(phase, period - phase), `change at tick ${i} (seed ${seed})`).toBeLessThanOrEqual(1)
        }
      }
    }
    // Across seeds the saucer really weaved: at least two distinct vertical speeds
    // were drawn (a broken reroll that always picked one value would fail here).
    expect(seenVy.size).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Random fire — cadence + non-aimed headings (AC). The A-12 differentiator.
// ---------------------------------------------------------------------------

describe('large saucer — random fire cadence & headings (AC)', () => {
  it('fires on the fire-interval cadence: first shot after one interval, not immediately', () => {
    const start = spawnLiveSaucer(1979)
    requireSaucer(start)
    const period = Math.round(SAUCER_FIRE_INTERVAL / DT)

    // No player input → every bullet in state.bullets is the saucer's.
    const counts: number[] = []
    let s = start
    for (let i = 0; i < period * 4 + 5; i++) {
      s = stepGame(s, NO_INPUT, DT)
      counts.push(s.bullets.length)
    }

    const firstFire = counts.findIndex((c) => c >= 1)
    expect(firstFire).toBeGreaterThanOrEqual(0) // it fired (non-vacuous)
    expect(Math.abs(firstFire + 1 - period)).toBeLessThanOrEqual(1) // ~one interval in

    if (SAUCER_MAX_BULLETS >= 2) {
      const secondFire = counts.findIndex((c, i) => i > firstFire && c >= 2)
      expect(secondFire).toBeGreaterThan(firstFire)
      expect(Math.abs(secondFire - firstFire - period)).toBeLessThanOrEqual(1) // keeps the cadence
    }
  })

  it('fires at RANDOM headings across a broad arc, not aimed at the centre ship', () => {
    const start = spawnLiveSaucer(1979)
    requireSaucer(start)
    const headings: number[] = []
    let s = start
    for (let i = 0; i < Math.round(SAUCER_FIRE_INTERVAL / DT) * 12 + 20; i++) {
      s = stepGame(s, NO_INPUT, DT)
      if (s.saucer === null) break
      for (const b of s.bullets) {
        if (b.owner === 'saucer') headings.push(Math.atan2(b.vel.y, b.vel.x))
      }
    }

    const distinct = [...new Set(headings.map((h) => Math.round(h * 1000) / 1000))]
    expect(distinct.length).toBeGreaterThanOrEqual(3) // many directions, not one fixed angle

    let maxSpread = 0
    for (let i = 0; i < distinct.length; i++) {
      for (let j = i + 1; j < distinct.length; j++) {
        maxSpread = Math.max(maxSpread, angDiff(distinct[i], distinct[j]))
      }
    }
    // An aimed shooter tracking the near-stationary centre ship would cluster its
    // headings tightly; random fire sprays across a wide arc.
    expect(maxSpread).toBeGreaterThan(Math.PI / 2)
  })
})

// ---------------------------------------------------------------------------
// Saucer bullets — cap, lifetime, owner discriminant (AC). Through stepGame.
// ---------------------------------------------------------------------------

describe('large saucer bullets — cap, lifetime & owner discriminant (AC)', () => {
  it('never keeps more than SAUCER_MAX_BULLETS saucer shots alive at once', () => {
    const start = spawnLiveSaucer(1979)
    requireSaucer(start)
    let s = start
    let sawShot = false
    for (let i = 0; i < Math.round(SAUCER_FIRE_INTERVAL / DT) * 10 + 20; i++) {
      s = stepGame(s, NO_INPUT, DT)
      if (s.saucer === null) break
      const saucerShots = s.bullets.filter((b) => b.owner === 'saucer')
      expect(saucerShots.length).toBeLessThanOrEqual(SAUCER_MAX_BULLETS)
      if (saucerShots.length > 0) sawShot = true
    }
    expect(sawShot).toBe(true) // the cap was actually exercised, not vacuously satisfied
  })

  it('removes each saucer bullet after its lifetime — bounded life, never immortal', () => {
    const start = spawnLiveSaucer(1979)
    requireSaucer(start)
    let s = start
    let maxLifeSeen = 0
    let sawRemoval = false
    let prevCount = 0
    for (let i = 0; i < SAUCER_BULLET_LIFETIME + Math.round(SAUCER_FIRE_INTERVAL / DT) + 5; i++) {
      s = stepGame(s, NO_INPUT, DT)
      const saucerShots = s.bullets.filter((b) => b.owner === 'saucer')
      for (const b of saucerShots) {
        expect(b.life).toBeGreaterThan(0)
        expect(b.life).toBeLessThanOrEqual(SAUCER_BULLET_LIFETIME) // never exceeds the ceiling
        maxLifeSeen = Math.max(maxLifeSeen, b.life)
      }
      if (saucerShots.length < prevCount) sawRemoval = true
      prevCount = saucerShots.length
    }
    expect(maxLifeSeen).toBeGreaterThan(0) // shots really appeared
    expect(sawRemoval).toBe(true) // and expired (count fell) — not immortal
  })

  it('keeps player and saucer bullet caps independent, tagging every bullet by owner', () => {
    const start = spawnLiveSaucer(1979)
    requireSaucer(start)
    let s = start
    let sawPlayer = false
    let sawSaucer = false
    for (let i = 0; i < Math.round(SAUCER_FIRE_INTERVAL / DT) * 6 + 10; i++) {
      // Toggle fire so each `true` is a fresh rising edge (firing is edge-triggered).
      s = stepGame(s, i % 2 === 0 ? FIRE : NO_INPUT, DT)
      const players = s.bullets.filter((b) => b.owner === 'player')
      const saucers = s.bullets.filter((b) => b.owner === 'saucer')
      expect(players.length).toBeLessThanOrEqual(MAX_PLAYER_SHOTS)
      expect(saucers.length).toBeLessThanOrEqual(SAUCER_MAX_BULLETS)
      if (players.length > 0) sawPlayer = true
      if (saucers.length > 0) sawSaucer = true
    }
    // Both owners really coexisted in the one state.bullets array under independent caps.
    expect(sawPlayer).toBe(true)
    expect(sawSaucer).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// stepGame wiring & whole-state determinism (AC).
// ---------------------------------------------------------------------------

describe('stepGame — saucer subsystem wiring & determinism (AC)', () => {
  it('advances the live saucer each tick (wired in) and replays deterministically', () => {
    const a0 = spawnLiveSaucer(2626)
    const before = requireSaucer(a0)
    const a1 = stepGame(a0, NO_INPUT, DT)
    expect(requireSaucer(a1).pos.x).not.toBe(before.pos.x) // stepGame moved it → wired in

    // Identical seed + input script → deeply-equal GameState after a long run.
    let a = a0
    let b = spawnLiveSaucer(2626)
    for (let i = 0; i < 300; i++) {
      a = stepGame(a, NO_INPUT, DT)
      b = stepGame(b, NO_INPUT, DT)
    }
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// 27-object on-screen guard — extended to count the saucer (A-10 carry-forward).
//
// A-10 flagged that the object budget covered rocks + ship only, and that A-11's
// live saucer must be folded into the count (Delivery Finding, A-10 session). The
// budget lives in waves.ts (MAX_OBJECTS_ON_SCREEN); the extension test co-locates
// here because it now depends on SAUCER_MAX_BULLETS.
// ---------------------------------------------------------------------------

describe('27-object on-screen guard — now counts the saucer + its shots (A-10 carry-forward)', () => {
  it('fits rocks (cap) + ship + saucer + all live shots within the object budget', () => {
    const worstCase =
      STARTING_ROCKS_CAP + 1 /* ship */ + 1 /* saucer */ + SAUCER_MAX_BULLETS + MAX_PLAYER_SHOTS
    expect(worstCase).toBeLessThanOrEqual(MAX_OBJECTS_ON_SCREEN)
  })

  it('actually accounts for the saucer (non-vacuous — the budget grows once it is counted)', () => {
    const withoutSaucer = STARTING_ROCKS_CAP + 1 + MAX_PLAYER_SHOTS
    const withSaucer = withoutSaucer + 1 + SAUCER_MAX_BULLETS
    expect(withSaucer).toBeGreaterThan(withoutSaucer)
    expect(withSaucer).toBeLessThanOrEqual(MAX_OBJECTS_ON_SCREEN)
  })
})

// ---------------------------------------------------------------------------
// Source hygiene — determinism + type safety on the new module (rule: TS #1 +
// epic banned-globals). core-boundary.test.ts already scans every core/*.ts, so
// this is belt-and-suspenders plus the `as any` escape that scan does not cover.
// ---------------------------------------------------------------------------

describe('core/saucer.ts source hygiene (determinism + type safety) (rule)', () => {
  const src = (): string =>
    readFileSync(fileURLToPath(new URL('../src/core/saucer.ts', import.meta.url)), 'utf8')

  it('is the real saucer module (non-vacuous scan target)', () => {
    const s = src()
    expect(s.length).toBeGreaterThan(0)
    expect(/\bupdateSpawnDirector\b/.test(s)).toBe(true)
  })

  it('never reaches for wall-clock or entropy globals (all randomness via state.rng)', () => {
    const s = src()
    expect(/\bMath\s*\.\s*random\s*\(/.test(s)).toBe(false)
    expect(/\bDate\s*\.\s*now\s*\(/.test(s)).toBe(false)
    expect(/\bperformance\s*\.\s*now\s*\(/.test(s)).toBe(false)
  })

  it('uses no `as any` type-safety escape (typescript review checklist #1)', () => {
    expect(/\bas\s+any\b/.test(src())).toBe(false)
  })
})
