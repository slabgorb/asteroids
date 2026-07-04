// tests/saucer-collision.test.ts
//
// A-13: SAUCER SCORING + COLLISIONS. A-11/A-12 make both saucer variants move,
// weave, and fire; this story is the integration layer — a saucer kill scores
// (via A-9's canonical scoring), a saucer or its shot can now DESTROY things,
// and the whole lot stays deterministic. Everything is observed THROUGH
// stepGame on controlled fixtures, exactly like tests/collision.test.ts (A-8).
//
// RED until:
//   * score.ts exports SAUCER_SCORE_LARGE (200, corroborated) and
//     SAUCER_SCORE_SMALL (990 vs 1000 conflict — A-9/A-17 settle it; these tests
//     assert against the EXPORTED constant, never a literal, so the two stories
//     cannot silently drift), and saucer kills route through the same
//     rollover/bonus-ship path as rocks;
//   * saucer.ts exports SAUCER_HITBOX (per-size) and SAUCER_ROCK_COLLISION_ENABLED;
//   * sim.ts wires four new collision pairs into stepGame: player-bullet↔saucer,
//     saucer-bullet↔ship, saucer↔ship, and (flag-gated) saucer↔rock.
//
// ── Fixture conventions (mirror collision.test.ts) ──────────────────────────
//   * Entities are explicit literals with ZERO velocity so a single step is
//     motion-free and the collision predicate is isolated from step order — the
//     one exception is the deliberately MOVING bullet fixtures that guard against
//     the small-rock tunnelling bug being repeated for the saucer pairs.
//   * A Saucer IS hand-built here (saucerAt). tests/saucer.test.ts pointedly
//     never does this — but its subject is spawn/movement/fire, where the real
//     director must own placement. Collision geometry needs a saucer at a KNOWN
//     point, which the random director cannot give; the Saucer field names are a
//     stable state.ts contract, so a literal is the right tool here. courseTimer
//     and fireTimer are parked high so stepSaucer neither rerolls the (zero)
//     velocity nor fires while the collision is under test.

import { describe, it, expect } from 'vitest'
import { stepGame } from '../src/core/sim'
import {
  initialState,
  type GameState,
  type Saucer,
  type SaucerSize,
  type Bullet,
  type Ship,
  type Rock,
  type RockSize,
  type Vec2,
} from '../src/core/state'
import { NO_INPUT } from '../src/core/input'
import { SAUCER_SCORE_LARGE, SAUCER_SCORE_SMALL } from '../src/core/score'
import { SAUCER_HITBOX, SAUCER_ROCK_COLLISION_ENABLED } from '../src/core/saucer'
import { BULLET_SPEED } from '../src/core/bullet'

const DT = 1 / 60

// A mid-field point clear of the default ship spawn ({4096, 3072}) and far from
// the toroidal seam — so saucer/bullet fixtures never trip an unintended ship or
// wrap interaction. ~2354 lo-units from the ship, beyond every hitbox sum.
const P: Vec2 = { x: 2000, y: 2000 }
// A second mid-field point for the moving-bullet fixtures (no seam crossing).
const R: Vec2 = { x: 5000, y: 3000 }

/** A motionless saucer at `pos`. Zero velocity + parked timers ⇒ stepSaucer is a
 * no-op on it (no drift, no course reroll, no fire), isolating the collision. */
function saucerAt(pos: Vec2, size: SaucerSize, over: Partial<Saucer> = {}): Saucer {
  return { pos: { ...pos }, velocity: { x: 0, y: 0 }, size, courseTimer: 999, fireTimer: 999, ...over }
}

/** A long-lived bullet at `pos` (owner defaults to 'player'); motionless unless
 * `vel` is overridden. life well above one frame so only a collision removes it. */
function bulletAt(pos: Vec2, over: Partial<Bullet> = {}): Bullet {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, life: 60, owner: 'player', ...over }
}

/** A motionless ship at `pos`, nose-up. */
function shipAt(pos: Vec2): Ship {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, dir: 64, visible: true }
}

/** A motionless rock at `pos` (zero drift → stable across a step). */
function rockAt(pos: Vec2, size: RockSize): Rock {
  return { pos: { ...pos }, velocity: { x: 0, y: 0 }, size, shapeVariant: 0 }
}

/** A `playing`-mode state seeded and overlaid with the entities under test. */
function playing(seed: number, over: Partial<GameState> = {}): GameState {
  return { ...initialState(seed), mode: 'playing', ...over }
}

// ── Scoring (AC-1) ──────────────────────────────────────────────────────────
describe('stepGame — a player bullet destroying a saucer scores (AC-1)', () => {
  it('a large saucer killed by a player bullet adds exactly SAUCER_SCORE_LARGE', () => {
    const s0 = playing(4242, { score: 0, saucer: saucerAt(P, 'large'), bullets: [bulletAt(P)] })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.score - s0.score).toBe(SAUCER_SCORE_LARGE)
    expect(s1.saucer).toBeNull() // saucer removed on the kill
    expect(s1.bullets).toHaveLength(0) // the shot is consumed
  })

  it('a small saucer killed by a player bullet adds exactly SAUCER_SCORE_SMALL (constant, not a literal)', () => {
    // Asserting against the EXPORTED constant is the whole point: the 990-vs-1000
    // conflict is A-9/A-17's to settle, and this must not silently disagree.
    const s0 = playing(4242, { score: 0, saucer: saucerAt(P, 'small'), bullets: [bulletAt(P)] })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.score - s0.score).toBe(SAUCER_SCORE_SMALL)
    expect(s1.saucer).toBeNull()
    expect(s1.bullets).toHaveLength(0)
  })

  it('pins the large-saucer value at the ROM-corroborated 200 (clean confirm)', () => {
    // Large is the one uncontested value (epic + both disassembly fetches + a web
    // search all agree). Small is deliberately NOT pinned to a literal here.
    expect(SAUCER_SCORE_LARGE).toBe(200)
  })

  it('routes a saucer kill through A-9 scoring — a kill crossing a 10000 boundary grants a bonus ship', () => {
    // Faithfulness/rule guard: saucer points must go through the SAME
    // rollover+extra-life path as rocks (applyScore), not a naive `score += n`.
    // 9900 + 200 = 10100 crosses the 10000 boundary → one bonus ship.
    const s0 = playing(4242, { score: 9900, lives: 3, saucer: saucerAt(P, 'large'), bullets: [bulletAt(P)] })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.score).toBe(10100)
    expect(s1.lives).toBe(4) // extra life earned via A-9's boundary logic
  })
})

// ── Player-bullet↔saucer: swept, NO tunnelling (AC-5) ───────────────────────
describe('stepGame — a fast player shot cannot tunnel through a saucer (AC-5)', () => {
  // The small-rock bug (fixed 2026-07-04): endpoint-only hit-testing let a shot
  // travelling 111 lo-units/frame skip a 84-unit-wide small-rock window in one
  // step. The small saucer is a small target, so it is the pair that genuinely
  // tunnels — its window is narrow enough that BOTH the pre- and post-move shot
  // endpoints sit outside it while the path crosses dead-centre. This test fails
  // under any endpoint-only (plain `overlaps`) implementation; only a swept
  // (path) test catches it.
  const startBefore = 60 // lo-units the shot starts BEFORE the saucer centre
  const endAfter = BULLET_SPEED - startBefore // 51 lo-units PAST centre after one frame

  it('a moving player shot whose path crosses a small saucer kills it (no tunnel)', () => {
    // Precondition — prove this fixture actually exercises tunnelling: both the
    // pre-move (−60) and post-move (+51) endpoints must lie OUTSIDE the small
    // saucer's hitbox, so an endpoint-only check would miss the crossing.
    expect(startBefore).toBeGreaterThan(SAUCER_HITBOX.small)
    expect(endAfter).toBeGreaterThan(SAUCER_HITBOX.small)

    const s0 = playing(4242, {
      score: 0,
      saucer: saucerAt(R, 'small'),
      bullets: [bulletAt({ x: R.x - startBefore, y: R.y }, { vel: { x: BULLET_SPEED, y: 0 } })],
    })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.saucer).toBeNull() // path crossed the saucer → killed
    expect(s1.bullets).toHaveLength(0) // shot consumed
    expect(s1.score - s0.score).toBe(SAUCER_SCORE_SMALL) // and scored
  })

  it('a moving player shot flying clear of the saucer (offset in Y) does NOT hit it (no over-trigger)', () => {
    const clearY = SAUCER_HITBOX.small + 20 // |dy| exceeds the window for the whole path
    const s0 = playing(4242, {
      score: 0,
      saucer: saucerAt(R, 'small'),
      bullets: [bulletAt({ x: R.x - startBefore, y: R.y + clearY }, { vel: { x: BULLET_SPEED, y: 0 } })],
    })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.saucer).not.toBeNull() // untouched
    expect(s1.bullets).toHaveLength(1) // shot not consumed
    expect(s1.score).toBe(0) // no score
  })
})

// ── Saucer↔ship direct contact (AC-2) ───────────────────────────────────────
describe('stepGame — a saucer colliding with the ship destroys both (AC-2)', () => {
  // lives 0 (initialState's default for a non-started game) keeps this on the
  // legacy sticky-latch path — collision.test.ts's A-8 idiom — so the collision
  // is isolated from A-15's decrement/respawn/gameover machinery.
  it('a saucer overlapping the ship destroys the ship AND the saucer', () => {
    const s0 = playing(4242, { ship: shipAt(P), saucer: saucerAt(P, 'large') })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.shipDestroyed).toBe(true)
    expect(s1.saucer).toBeNull()
  })

  it('a saucer clear of the ship leaves both intact', () => {
    const s0 = playing(4242, { ship: shipAt(P), saucer: saucerAt({ x: 6000, y: 5000 }, 'large') })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.shipDestroyed).toBe(false)
    expect(s1.saucer).not.toBeNull()
  })
})

// ── Saucer-bullet↔ship: a distinct kill path (AC-3) ─────────────────────────
describe('stepGame — a saucer bullet can destroy the ship (AC-3, distinct from contact)', () => {
  // Distinctness: NO saucer is present here — only a saucer-owned BULLET — so a
  // death is unambiguously the shot's doing, not direct contact. Note the ship
  // hitbox (96) exceeds half the 111-unit muzzle travel, so a both-endpoints-
  // outside tunnel is geometrically impossible for THIS pair (see the session
  // Design Deviation); this guards the WIRING + moving-bullet handling, and the
  // swept requirement here is a consistency measure. The genuinely tunnelling
  // pair is player-bullet↔small-saucer, tested above.
  const saucerShot = (from: Vec2, over: Partial<Bullet> = {}): Bullet =>
    bulletAt(from, { owner: 'saucer', vel: { x: BULLET_SPEED, y: 0 }, ...over })

  it('a moving saucer bullet crossing the ship destroys it and is consumed', () => {
    const s0 = playing(4242, { ship: shipAt(R), saucer: null, bullets: [saucerShot({ x: R.x - 60, y: R.y })] })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.shipDestroyed).toBe(true)
    expect(s1.bullets).toHaveLength(0) // the saucer shot is consumed on the hit
    expect(s1.saucer).toBeNull() // still no saucer — the death was the bullet's
  })

  it('a saucer bullet flying clear of the ship leaves it intact', () => {
    const s0 = playing(4242, {
      ship: shipAt(R),
      saucer: null,
      bullets: [saucerShot({ x: R.x - 60, y: R.y + 600 })], // 600 lo-units clear for the whole path
    })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.shipDestroyed).toBe(false)
    expect(s1.bullets).toHaveLength(1) // not consumed
  })
})

// ── Invulnerability gate (consistency with A-15 ship-vs-rock) ────────────────
describe('stepGame — an invulnerable ship survives saucer hits (spawn-timer gate)', () => {
  // A-15 makes a post-respawn ship (shipSpawnTimer > 0) unhittable by rocks; the
  // new saucer/saucer-bullet pairs must honour the SAME gate — nothing pierces
  // invulnerability. shipSpawnTimer 1s stays > 0 after one dt of decay.
  it('a saucer overlapping an invulnerable ship does NOT destroy it', () => {
    const s0 = playing(4242, { ship: shipAt(P), saucer: saucerAt(P, 'large'), shipSpawnTimer: 1 })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.shipDestroyed).toBe(false)
  })

  it('a saucer bullet crossing an invulnerable ship does NOT destroy it', () => {
    const s0 = playing(4242, {
      ship: shipAt(R),
      saucer: null,
      shipSpawnTimer: 1,
      bullets: [bulletAt({ x: R.x - 60, y: R.y }, { owner: 'saucer', vel: { x: BULLET_SPEED, y: 0 } })],
    })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.shipDestroyed).toBe(false)
  })
})

// ── Saucer↔rock, behind SAUCER_ROCK_COLLISION_ENABLED (AC-4) ─────────────────
describe('stepGame — saucer↔rock collision is flag-gated (AC-4)', () => {
  // Provisional wiring: this story's brief + secondary sources say saucers die
  // on rock contact, but NEITHER fetched primary-source disassembly excerpt found
  // the routine — a direct conflict flagged for A-17's quarry to settle. Shipped
  // behind a named flag; the minimal interpretation is "saucer destroyed, rock
  // unaffected" (no split) until the quarry says otherwise.
  it('SAUCER_ROCK_COLLISION_ENABLED defaults to true (implement — verify vs quarry A-17)', () => {
    expect(SAUCER_ROCK_COLLISION_ENABLED).toBe(true)
  })

  it('when enabled, a saucer touching a rock is destroyed and the rock is unaffected', () => {
    // The companion test above pins the flag to `true` (the shipped default), so
    // this asserts the enabled behaviour unconditionally — no early-return that
    // would make it vacuously pass. If a future story flips the flag, that test
    // fails first (loudly signalling the decision changed) and this one is revisited.
    const s0 = playing(4242, { saucer: saucerAt(P, 'large'), rocks: [rockAt(P, 'large')] })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.saucer).toBeNull() // saucer destroyed on contact
    expect(s1.rocks).toHaveLength(1) // rock NOT split...
    expect(s1.rocks[0].size).toBe('large') // ...and NOT downgraded — unaffected
  })
})

// ── Determinism & purity (AC-7) ─────────────────────────────────────────────
describe('stepGame — a saucer collision stays deterministic and pure (AC-7)', () => {
  it('same seed + same saucer kill → deeply-equal state (replay determinism)', () => {
    const scenario = (): GameState =>
      stepGame(
        playing(99, { score: 0, saucer: saucerAt(P, 'large'), bullets: [bulletAt(P)] }),
        NO_INPUT,
        DT,
      )
    expect(scenario()).toEqual(scenario())
  })

  it('does NOT mutate the input state during a saucer collision', () => {
    const s0 = playing(4242, { score: 0, saucer: saucerAt(P, 'large'), bullets: [bulletAt(P)] })
    const snapshot = structuredClone(s0)
    stepGame(s0, NO_INPUT, DT)
    expect(s0).toEqual(snapshot)
  })
})
