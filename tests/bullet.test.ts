// tests/bullet.test.ts
//
// A-4: Firing — bullet spawn / velocity / lifetime, and the max-4-shots cap.
//
// Firing extends A-3's ship model. A bullet is spawned at (approximately) the
// ship, launched along the ship's heading (`dir`) at a fixed muzzle speed, and
// inherits the ship's current velocity (momentum). It flies straight — no
// thrust, no drag — wrapping the toroidal world until a finite lifetime
// counter runs out and it is removed. At most four player bullets may exist at
// once, and firing is edge-triggered (one shot per fresh press — no auto-fire).
//
// ROM references (rev-4 disassembly, https://6502disassembly.com/va-asteroids/
// Asteroids.html; the reference/ quarry is absent from this checkout — see
// session Delivery Findings — so extracted values live in src/core/bullet.ts
// cited by ROM address). A-3's TEA already quarried the firing routine
// (BulletSlotFound $6cfd–$6d8e, recorded in the A-3 archive) — seed for Dev:
//   - Max shots: 4 player-shot slots (ship-bullet loop around $6cee/$6cf2,
//     `lda #$03` / `sta $0e` — indices 0..3).
//   - Muzzle velocity: computed per-axis from the ship heading via the same
//     quarter-sine fold as thrust (sinLookup) and ADDED to the ship's current
//     velocity ($6d11: `adc ShipXSpeed`) — momentum is inherited, not
//     discarded. Per-axis, the shot velocity is clamped to ±111 lo-units/frame
//     (A-3 quarry note) — well above the ship's ±63.99 cap, so a shot outruns
//     the ship that fired it. Because the clamp/fold is per-axis (like thrust),
//     muzzle speed is isotropic across the four CARDINAL headings but NOT at
//     diagonals — so these tests exercise cardinals only for magnitude.
//   - Lifetime: a per-shot countdown initialised on fire (ShpShotTimer region
//     ~$021F) removes the shot after a fixed number of frames.
//   - Fire debounce: a fire-button shift register (ShipBulletSR $63, shifted at
//     ~$6cdb) makes firing edge-triggered — holding the button does not
//     auto-fire.
//
// NOTE FOR DEV: extract and pin the exact muzzle formula/clamp and the
// lifetime-frame count as ROM-cited constants in src/core/bullet.ts, which must
// export MAX_PLAYER_SHOTS and BULLET_LIFETIME_FRAMES (mirroring ship.ts's named
// constants). These tests verify the *mechanism* and *invariants* (heading,
// inherited momentum, outruns the ship, cardinal isotropy, finite lifetime,
// 4-shot cap, edge-triggered fire, purity) — they deliberately do NOT hard-code
// the muzzle-speed magnitude, which is a per-axis clamped byte value best pinned
// with a ROM citation by you. Only the 4-shot cap is pinned as a literal (the
// story's headline requirement, unambiguous). This suite also adds bullet.ts to
// EXPECTED_CORE_FILES in core-boundary.test.ts, so the purity scanner requires
// and covers the new module (A-3's precedent for ship.ts).
//
// Units mirror A-3: world lo-units (8 per screen pixel at 1024x768); velocity is
// world-units per 60 Hz frame; `dir` is a 256-unit circle, 0 = +x, dir 64 = +y
// (up), counterclockwise positive. Tests drive the sim at the canonical fixed
// dt = 1/60.

import { describe, it, expect } from 'vitest'
import { stepGame } from '../src/core/sim'
import {
  initialState,
  WORLD_W,
  WORLD_H,
  type GameState,
  type Ship,
  type Bullet,
} from '../src/core/state'
import {
  MAX_PLAYER_SHOTS,
  BULLET_LIFETIME_FRAMES,
  SHOT_TIMER_PERIOD_FRAMES,
  stepBullets,
} from '../src/core/bullet'
import { SHIP_MAX_SPEED } from '../src/core/ship'
import { NO_INPUT, type Input } from '../src/core/input'

const DT = 1 / 60

const FIRE: Input = { ...NO_INPUT, fire: true }

/** A shot's true on-screen lifetime in 60 Hz frames. The ROM seeds the per-shot
 * timer to BULLET_LIFETIME_FRAMES ($12 = 18) but only decrements it every
 * SHOT_TIMER_PERIOD_FRAMES-th frame (FrameTimerLo AND #$03, L738F) while
 * positions integrate every frame — so a shot flies 18 x 4 = 72 frames. This is
 * the number that governs range; the raw seed alone (18) is a 4x underestimate. */
const EFFECTIVE_LIFETIME = BULLET_LIFETIME_FRAMES * SHOT_TIMER_PERIOD_FRAMES

/** A playing-mode state with optional ship overrides (mirrors ship.test.ts). */
function playing(seed = 1, ship: Partial<Ship> = {}): GameState {
  const s = initialState(seed)
  return { ...s, mode: 'playing', ship: { ...s.ship, ...ship } }
}

function stepN(s: GameState, input: Input, n: number, dt = DT): GameState {
  for (let i = 0; i < n; i++) s = stepGame(s, input, dt)
  return s
}

/** The single bullet spawned by firing once from `s`'s current state. */
function fireOnce(s: GameState): GameState {
  return stepGame(s, FIRE, DT)
}

describe('firing constants (AC-1, AC-4, AC-5)', () => {
  it('caps the player at 4 simultaneous shots (ROM ship-bullet slots $6cee)', () => {
    expect(MAX_PLAYER_SHOTS).toBe(4)
  })

  it('exposes a finite, positive integer lifetime in frames', () => {
    expect(Number.isInteger(BULLET_LIFETIME_FRAMES)).toBe(true)
    expect(BULLET_LIFETIME_FRAMES).toBeGreaterThan(0)
    // A shot must outlive the time it takes to fill all four slots under
    // edge-triggered fire (~2 frames per shot), or the 4-shot cap is physically
    // unreachable. This is a floor, not the ROM value.
    expect(BULLET_LIFETIME_FRAMES).toBeGreaterThanOrEqual(2 * MAX_PLAYER_SHOTS)
  })
})

describe('spawn on fire (AC-1)', () => {
  it('spawns exactly one bullet on a fire press from an empty barrel', () => {
    const after = fireOnce(playing(1, { dir: 0 }))
    expect(after.bullets).toHaveLength(1)
  })

  it('does not spawn a bullet without a fire press', () => {
    const after = stepN(playing(1, { dir: 0 }), NO_INPUT, 30)
    expect(after.bullets).toHaveLength(0)
  })

  it('spawns the bullet at the ship, displaced forward along the heading (never behind)', () => {
    // Ship at rest, world centre, facing +x (dir 0). The bullet appears at or
    // ahead of the ship along +x, aligned in y — never behind, never sideways.
    const ship = { pos: { x: WORLD_W / 2, y: WORLD_H / 2 }, vel: { x: 0, y: 0 }, dir: 0, visible: true }
    const b = fireOnce(playing(1, ship)).bullets[0]
    expect(b.pos.y).toBeCloseTo(WORLD_H / 2, 6) // heading is pure +x → no y offset
    expect(b.pos.x).toBeGreaterThanOrEqual(WORLD_W / 2 - 1e-6) // at or ahead of ship
    expect(b.pos.x - WORLD_W / 2).toBeLessThan(700) // near the ship, not teleported
  })
})

describe('muzzle velocity (AC-2)', () => {
  // At the four cardinal headings the heading vector is axis-aligned, so a
  // rest-fired bullet's velocity is (±muzzle, 0) or (0, ±muzzle). Sign
  // conventions match A-3 thrust: dir 0 -> +x, 64 -> +y, 128 -> -x, 192 -> -y.
  const CARDINALS: ReadonlyArray<readonly [number, 'x' | 'y', number]> = [
    [0, 'x', +1],
    [64, 'y', +1],
    [128, 'x', -1],
    [192, 'y', -1],
  ]

  for (const [dir, axis, sign] of CARDINALS) {
    it(`fires along the heading at dir ${dir} (${sign > 0 ? '+' : '-'}${axis}), other axis at rest`, () => {
      const b = fireOnce(playing(1, { dir, vel: { x: 0, y: 0 } })).bullets[0]
      const other = axis === 'x' ? 'y' : 'x'
      // The shot travels along the heading with the ROM sign; the perpendicular
      // component is zero at a cardinal (no magic number — direction is pinned,
      // the byte magnitude is Dev's ROM-cited constant).
      expect(Math.sign(b.vel[axis])).toBe(sign)
      expect(Math.abs(b.vel[axis])).toBeGreaterThan(0)
      expect(b.vel[other]).toBeCloseTo(0, 6)
    })
  }

  it('muzzle speed is isotropic across the four cardinals (equal magnitude, no value assumed)', () => {
    const speeds = CARDINALS.map(([dir]) => {
      const v = fireOnce(playing(1, { dir, vel: { x: 0, y: 0 } })).bullets[0].vel
      return Math.hypot(v.x, v.y)
    })
    // All four cardinal muzzle speeds equal one another (per-axis symmetry) —
    // proven relative to each other, not to a hard-coded constant.
    for (const s of speeds) expect(s).toBeCloseTo(speeds[0], 3)
  })

  it('a rest-fired shot outruns the ship — muzzle speed exceeds the ship max (ROM ±111 > ±63.99)', () => {
    // Fired from a stationary ship, the shot is strictly faster than the ship
    // could ever travel along that axis (A-3 quarry: shots clamp at ±111
    // lo-units/frame vs the ship's ±16383/256).
    const b = fireOnce(playing(1, { dir: 0, vel: { x: 0, y: 0 } })).bullets[0]
    expect(b.vel.x).toBeGreaterThan(SHIP_MAX_SPEED)
  })

  it('flies at constant velocity — no thrust, no drag on a bullet in flight', () => {
    const s0 = fireOnce(playing(1, { dir: 0 }))
    const v0 = s0.bullets[0].vel
    const s1 = stepGame(s0, NO_INPUT, DT)
    const v1 = s1.bullets[0].vel
    expect(v1.x).toBeCloseTo(v0.x, 9)
    expect(v1.y).toBeCloseTo(v0.y, 9)
  })
})

describe('inherited momentum (AC-3)', () => {
  it('adds the ship velocity to the muzzle velocity (both axes)', () => {
    const dir = 0
    const rest = fireOnce(playing(1, { dir, vel: { x: 0, y: 0 } })).bullets[0].vel
    const moving = fireOnce(playing(1, { dir, vel: { x: 10, y: -6 } })).bullets[0].vel
    // The heading contribution is identical (same dir); the difference is the
    // inherited ship velocity, modulo at most a frame of ship drag (~0.4%).
    expect(moving.x - rest.x).toBeGreaterThan(9.5)
    expect(moving.x - rest.x).toBeLessThan(10.5)
    expect(moving.y - rest.y).toBeGreaterThan(-6.5)
    expect(moving.y - rest.y).toBeLessThan(-5.5)
  })

  it('a shot fired from a fast ship outruns it (muzzle speed carries the shot ahead)', () => {
    // Fire forward (+x) from a ship already moving +x: the bullet is strictly
    // faster than the ship at the same instant (compare to the post-fire ship
    // velocity so a frame of drag/ordering cannot confound the margin).
    const after = fireOnce(playing(1, { dir: 0, vel: { x: 20, y: 0 } }))
    expect(after.bullets[0].vel.x).toBeGreaterThan(after.ship.vel.x)
  })
})

describe('lifetime & movement (AC-4)', () => {
  it('advances the bullet by its velocity each frame', () => {
    const s0 = fireOnce(playing(1, { dir: 0 }))
    const p0 = s0.bullets[0].pos
    const v = s0.bullets[0].vel
    const p1 = stepGame(s0, NO_INPUT, DT).bullets[0].pos
    expect(p1.x - p0.x).toBeCloseTo(v.x, 3)
    expect(p1.y - p0.y).toBeCloseTo(v.y, 3)
  })

  it('lives for its (effective) lifetime then is removed', () => {
    // The shot's real lifetime is EFFECTIVE_LIFETIME frames (the raw timer seed
    // decremented only every 4th frame — see the A2-9 block below), not the raw
    // BULLET_LIFETIME_FRAMES counter. Present safely before expiry...
    const spawned = fireOnce(playing(1, { dir: 0 }))
    expect(spawned.bullets).toHaveLength(1)
    const midlife = stepN(spawned, NO_INPUT, EFFECTIVE_LIFETIME - 2)
    expect(midlife.bullets).toHaveLength(1)
    // ...and gone shortly after it.
    const expired = stepN(spawned, NO_INPUT, EFFECTIVE_LIFETIME + 2)
    expect(expired.bullets).toHaveLength(0)
  })

  it('keeps every live bullet inside the world and wraps toroidally', () => {
    // Ship one lo-unit from the right seam, facing +x: the bullet crosses the
    // x seam almost immediately. Track a hard wrap (a jump > half the world)
    // and assert every position stays in bounds. Robust for any muzzle > 2.
    let s = fireOnce(playing(1, { pos: { x: WORLD_W - 2, y: WORLD_H / 2 }, vel: { x: 0, y: 0 }, dir: 0 }))
    let prev = s.bullets[0].pos.x
    let wraps = 0
    for (let i = 0; i < 6; i++) {
      s = stepGame(s, NO_INPUT, DT)
      if (s.bullets.length === 0) break
      const { x, y } = s.bullets[0].pos
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(WORLD_W)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThan(WORLD_H)
      if (Math.abs(x - prev) > WORLD_W / 2) wraps++
      prev = x
    }
    expect(wraps).toBeGreaterThanOrEqual(1)
  })
})

describe('max-4-shots cap & edge-triggered fire (AC-5, AC-6)', () => {
  it('never exceeds 4 live bullets no matter how hard fire is mashed', () => {
    // Alternate fire/release for many frames — the strongest form of the cap:
    // it must hold on every single frame.
    let s = playing(1, { dir: 0 })
    for (let i = 0; i < 40; i++) {
      s = stepGame(s, i % 2 === 0 ? FIRE : NO_INPUT, DT)
      expect(s.bullets.length).toBeLessThanOrEqual(MAX_PLAYER_SHOTS)
    }
  })

  it('reaches exactly 4 live shots under sustained fire (the cap is reachable, and the 5th is blocked)', () => {
    // Alternate fire/release (respecting edge-triggering) and watch the live
    // count. It must reach 4 — proving the cap is neither stuck at 3 (off-by-one
    // low) nor ever 5 (5th not blocked). Cadence-agnostic: whatever release gap
    // Dev's debounce needs, 40 frames is ample and stays within one lifetime.
    let s = playing(1, { dir: 0 })
    let maxSeen = 0
    for (let i = 0; i < 40; i++) {
      s = stepGame(s, i % 2 === 0 ? FIRE : NO_INPUT, DT)
      expect(s.bullets.length).toBeLessThanOrEqual(MAX_PLAYER_SHOTS)
      maxSeen = Math.max(maxSeen, s.bullets.length)
    }
    expect(maxSeen).toBe(MAX_PLAYER_SHOTS)
  })

  it('does not auto-fire while the button is held', () => {
    // Two consecutive held-fire frames must spawn only one bullet — the second
    // frame is not a fresh edge. (2 frames << lifetime, so no expiry confounds.)
    const s1 = stepGame(playing(1, { dir: 0 }), FIRE, DT)
    expect(s1.bullets).toHaveLength(1)
    const s2 = stepGame(s1, FIRE, DT)
    expect(s2.bullets).toHaveLength(1)
  })

  it('fires again after releasing and re-pressing', () => {
    const s1 = stepGame(playing(1, { dir: 0 }), FIRE, DT) // 1 bullet
    const s2 = stepGame(s1, NO_INPUT, DT) // release
    const s3 = stepGame(s2, FIRE, DT) // fresh edge
    expect(s3.bullets).toHaveLength(2)
  })

  it('frees a slot when a bullet expires, allowing a new shot', () => {
    const spawned = stepGame(playing(1, { dir: 0 }), FIRE, DT)
    expect(spawned.bullets).toHaveLength(1)
    const drained = stepN(spawned, NO_INPUT, EFFECTIVE_LIFETIME + 2)
    expect(drained.bullets).toHaveLength(0)
    const refired = stepGame(drained, FIRE, DT)
    expect(refired.bullets).toHaveLength(1)
  })
})

describe('firing purity & determinism (AC-7)', () => {
  const FIRE_SCRIPT: Input[] = [FIRE, NO_INPUT, FIRE, { ...NO_INPUT, thrust: true }, NO_INPUT]

  function fireRun(seed: number, ticks: number): GameState {
    let s = playing(seed, { dir: 0 })
    for (let i = 0; i < ticks; i++) {
      s = stepGame(s, FIRE_SCRIPT[i % FIRE_SCRIPT.length], DT)
    }
    return s
  }

  it('does not mutate the input state when firing', () => {
    const s0 = playing(42, { dir: 17 })
    const snapshot = structuredClone(s0)
    stepGame(s0, FIRE, DT)
    expect(s0).toEqual(snapshot)
    expect(s0.bullets).toHaveLength(0) // the caller's array is untouched
  })

  it('returns a fresh bullets array (no aliasing of the input array)', () => {
    const s0 = playing(42, { dir: 0 })
    const s1 = stepGame(s0, FIRE, DT)
    expect(s1.bullets).not.toBe(s0.bullets)
    expect(s0.bullets).toHaveLength(0)
    expect(s1.bullets).toHaveLength(1)
  })

  it('replays deterministically: same seed + script -> deeply equal state', () => {
    expect(fireRun(123, 90)).toEqual(fireRun(123, 90))
  })

  it('consumes no randomness: firing leaves the RNG seed untouched', () => {
    const s0 = playing(99, { dir: 0 })
    expect(fireRun(99, 90).rng.seed).toBe(s0.rng.seed)
  })
})

// ---------------------------------------------------------------------------
// A2-9: shot RANGE — the ROM's every-4th-frame shot-timer cadence.
//
// Playtest bug: player shots die too early and can't reach distant targets.
// Root cause, from the rev-4 disassembly (nmikstas/asteroids-disassembly): the
// shot timer is SEEDED to $12 = 18 (L6CFF `lda #18`) — that byte is authentic —
// but the ROM only decrements it on every 4th frame:
//
//     L738D: lda FrameTimerLo    ; Decrement shot timer every 4th frame.
//     L738F: and #$03            ; Is it time to decrement the shot timer?
//     L7391: bne DrawObjectDone  ; If not, branch.
//     L7393: dec AstStatus,X     ; Decrement shot timer.
//
// Positions integrate EVERY frame (UpdateObjects, L6FD0 `adc AstXPosLo,X`), so a
// shot actually flies 18 x 4 = 72 frames — ~72 x 111 = 7992 lo-units, nearly the
// full 8192-wide screen. The port aged `life` once per frame, so shots died at
// 18 frames (~1998 lo-units, a quarter screen): 4x too short.
//
// The fix must live in the SHARED, owner-agnostic aging path (advance() in
// bullet.ts): the story AC requires "correct respective ranges" for BOTH player
// and saucer shots, and the ROM's DEC is a generic per-object timer. Contract
// for Dev: export SHOT_TIMER_PERIOD_FRAMES = 4 and age the shot timer once per
// that many frames; keep BULLET_LIFETIME_FRAMES at the authentic 18.
// ---------------------------------------------------------------------------
describe('shot range: ROM timer cadence (A2-9)', () => {
  it('pins the shot-timer decrement period to the ROM cadence of 4 frames (L738F `and #$03`)', () => {
    expect(SHOT_TIMER_PERIOD_FRAMES).toBe(4)
  })

  it('leaves the raw timer seed at the authentic ROM byte $12 = 18 (L6CFF `lda #18`)', () => {
    // Range is extended by the decrement CADENCE, never by inflating the seed —
    // the seed byte is authentic and must not drift.
    expect(BULLET_LIFETIME_FRAMES).toBe(18)
  })

  it('keeps a player shot airborne far past the old 18-frame death (the exact bug)', () => {
    // Pre-fix, the shot was removed at 18 frames. It must now survive well beyond
    // that — checked at 30 and 60 frames, both inside the true 72-frame life.
    // This is the assertion that fails loudest against the shipped bug.
    const spawned = fireOnce(playing(1, { dir: 0 }))
    expect(spawned.bullets).toHaveLength(1)
    expect(stepN(spawned, NO_INPUT, 30).bullets).toHaveLength(1)
    expect(stepN(spawned, NO_INPUT, 60).bullets).toHaveLength(1)
  })

  it('travels nearly the full screen width at a cardinal heading (reaches distant targets)', () => {
    // Fire +x from world centre, at rest, and track UNWRAPPED x-travel across
    // most of the shot's life. Pre-fix travel was ~18 x 111 = 1998 lo-units
    // (a quarter screen); the fix must carry it across most of the playfield.
    const ship = { pos: { x: WORLD_W / 2, y: WORLD_H / 2 }, vel: { x: 0, y: 0 }, dir: 0 }
    let s = fireOnce(playing(1, ship))
    const v = s.bullets[0].vel.x
    expect(v).toBeGreaterThan(0) // +x heading

    const FRAMES = 64 // safely inside the 72-frame life
    let prev = s.bullets[0].pos.x
    let travel = 0
    for (let i = 0; i < FRAMES; i++) {
      s = stepGame(s, NO_INPUT, DT)
      expect(s.bullets).toHaveLength(1) // alive the whole way
      const x = s.bullets[0].pos.x
      let dx = x - prev
      if (dx < -WORLD_W / 2) dx += WORLD_W // unwrap a forward seam crossing
      travel += dx
      prev = x
    }
    // Constant-velocity flight for the full window (no drag on a shot)...
    expect(travel).toBeGreaterThan((FRAMES - 1) * v)
    expect(travel).toBeLessThan((FRAMES + 1) * v)
    // ...covering most of the screen — not the pre-fix quarter.
    expect(travel).toBeGreaterThan(0.8 * WORLD_W)
  })

  it('ages player and saucer shots alike — the cadence lives in the shared path', () => {
    // The fix must be owner-agnostic (in advance()), not a player-only branch.
    // Seed one player + one saucer shot with the same raw timer and step the
    // shared stepBullets with no fire: both reach the extended life together.
    // (The live saucer seed, SAUCER_BULLET_LIFETIME, is also 18, so real saucer
    // shots gain the same authentic range — the AC's "respective ranges".)
    const restShip: Ship = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, dir: 0, visible: true }
    const mk = (owner: 'player' | 'saucer'): Bullet => ({
      pos: { x: 1000, y: 1000 },
      vel: { x: 10, y: 0 },
      life: BULLET_LIFETIME_FRAMES,
      owner,
    })
    // firePrev=true + fire=false → the edge is never rising, so nothing spawns.
    const step = (bs: readonly Bullet[]): Bullet[] =>
      stepBullets(bs, restShip, true, NO_INPUT, DT).bullets

    let bullets: Bullet[] = [mk('player'), mk('saucer')]
    for (let i = 0; i < EFFECTIVE_LIFETIME - 4; i++) bullets = step(bullets)
    expect(bullets.some((b) => b.owner === 'player')).toBe(true)
    expect(bullets.some((b) => b.owner === 'saucer')).toBe(true)

    for (let i = 0; i < 8; i++) bullets = step(bullets) // step past 72
    expect(bullets).toHaveLength(0) // neither owner is special-cased
  })
})
