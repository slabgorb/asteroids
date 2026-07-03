// tests/collision.test.ts
//
// A-8: collision + destruction integration inside stepGame. A-7 shipped the
// pure `splitRock(rock, rng)` geometry; A-8 is the first PRODUCTION CALLER —
// it wires bullet-vs-rock and ship-vs-rock hit-testing into the sim, destroys
// rocks (via splitRock), removes the consumed bullet, marks the ship destroyed,
// and preserves determinism across the seed stream. Screen-wrap of positions
// already exists (bullet.ts `advance`, rocks.ts `updateRock`) so those ACs are
// pinned here only as REGRESSION guards; the net-new wrap work is toroidal
// (seam-aware) COLLISION.
//
// House conventions mirror rocks.test.ts / bounds.test.ts: entities are built
// as explicit literals (zero velocity so a single step is motion-free and the
// collision predicate is isolated from step-order), fixtures spread over
// initialState, and RNG expectations are reproduced from an independent clone
// of the same seed.
//
// Two design contracts pinned here are TEA decisions (session Design Deviations):
//   1. Ship death is modelled as a `GameState.shipDestroyed: boolean` latch —
//      GameState.ship is a single non-nullable entity, so the AC's "removed from
//      the active list" becomes a sticky flag (nulling the ship would cascade
//      null-guards through ~40 existing ship.test.ts dereferences under strict).
//   2. Collision is TOROIDAL (wraps across the seam), per the epic-A guardrail
//      (wrappedDelta) — a strengthening over the story context's plain |dx|<R.
//
// RED until sim.ts wires collision, state.ts adds `shipDestroyed`, and the
// collision predicate is wrap-aware.

import { describe, it, expect } from 'vitest'
import { stepGame } from '../src/core/sim'
import {
  initialState,
  WORLD_W,
  WORLD_H,
  type GameState,
  type Rock,
  type RockSize,
  type Bullet,
  type Vec2,
} from '../src/core/state'
import { NO_INPUT } from '../src/core/input'
import { splitRock, ROCK_HITBOX } from '../src/core/rocks'
import { createRng } from '../src/core/rng'

const DT = 1 / 60

// An interior point well clear of the default ship spawn ({4096, 3072}) — its
// distance from the ship (~2354) exceeds every hitbox, so bullet/rock fixtures
// never trip an unintended ship collision.
const CENTER: Vec2 = { x: 2000, y: 2000 }

/** A motionless rock at `pos` (zero drift → position is stable across a step,
 * so a collision test isolates geometry from movement/step-order). */
function rockAt(pos: Vec2, size: RockSize, over: Partial<Rock> = {}): Rock {
  return { pos: { ...pos }, velocity: { x: 0, y: 0 }, size, shapeVariant: 0, ...over }
}

/** A motionless, long-lived bullet at `pos` (life well above one frame so it
 * never self-expires mid-test — only a collision should remove it). */
function bulletAt(pos: Vec2, over: Partial<Bullet> = {}): Bullet {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, life: 60, ...over }
}

/** A `playing`-mode state (rocks only drift/collide in 'playing') seeded and
 * overlaid with the entities under test. */
function playing(seed: number, over: Partial<GameState> = {}): GameState {
  return { ...initialState(seed), mode: 'playing', ...over }
}

describe('stepGame — bullet destroys rock via splitRock (AC-1)', () => {
  it('replaces a hit large rock with its two medium children', () => {
    const s1 = stepGame(
      playing(4242, { rocks: [rockAt(CENTER, 'large')], bullets: [bulletAt(CENTER)] }),
      NO_INPUT,
      DT,
    )
    expect(s1.rocks).toHaveLength(2)
    expect(s1.rocks.every((r) => r.size === 'medium')).toBe(true)
  })

  it('replaces a hit medium rock with its two small children', () => {
    const s1 = stepGame(
      playing(4242, { rocks: [rockAt(CENTER, 'medium')], bullets: [bulletAt(CENTER)] }),
      NO_INPUT,
      DT,
    )
    expect(s1.rocks).toHaveLength(2)
    expect(s1.rocks.every((r) => r.size === 'small')).toBe(true)
  })

  it('consumes (removes) the bullet that destroyed the rock', () => {
    const s1 = stepGame(
      playing(4242, { rocks: [rockAt(CENTER, 'large')], bullets: [bulletAt(CENTER)] }),
      NO_INPUT,
      DT,
    )
    expect(s1.bullets).toHaveLength(0)
  })

  it('leaves an unrelated non-colliding rock untouched', () => {
    const s1 = stepGame(
      playing(4242, {
        rocks: [rockAt(CENTER, 'large'), rockAt({ x: 6000, y: 5000 }, 'large')],
        bullets: [bulletAt(CENTER)],
      }),
      NO_INPUT,
      DT,
    )
    // One rock split into two mediums; the far rock survives as a large → 3 total.
    expect(s1.rocks).toHaveLength(3)
    expect(s1.rocks.filter((r) => r.size === 'large')).toHaveLength(1)
    expect(s1.rocks.filter((r) => r.size === 'medium')).toHaveLength(2)
  })
})

describe('stepGame — collision RNG-clone discipline & determinism (AC-2)', () => {
  it('threads the split’s seed forward AND matches an independent clone of the same seed', () => {
    const seed = 4242
    const rock = rockAt(CENTER, 'large')
    const s0 = playing(seed, { rocks: [rock], bullets: [bulletAt(CENTER)] })
    const s1 = stepGame(s0, NO_INPUT, DT)

    // Reproduce the split independently from a fresh clone of the SAME seed. The
    // split is the step's only rng consumer, so the threaded seed must land here.
    const clone = createRng(seed)
    const expected = splitRock(rock, clone) // mutates `clone` by 4 draws

    // Proves the loop cloned state.rng (right seed) AND threaded the mutation
    // back — a forgotten thread-back leaves s1.rng.seed at the original seed.
    expect(s1.rng.seed).toBe(clone.seed)
    // velocity + shapeVariant are rng-driven and movement-invariant, so they pin
    // the stream without coupling to whether children were moved this frame.
    expect(s1.rocks.map((r) => r.velocity)).toEqual(expected.map((r) => r.velocity))
    expect(s1.rocks.map((r) => r.shapeVariant)).toEqual(expected.map((r) => r.shapeVariant))
  })

  it('does NOT mutate the caller’s rng when a collision splits a rock (clone, not alias)', () => {
    const s0 = playing(4242, { rocks: [rockAt(CENTER, 'large')], bullets: [bulletAt(CENTER)] })
    const before = s0.rng.seed
    stepGame(s0, NO_INPUT, DT)
    expect(s0.rng.seed).toBe(before)
  })

  it('does NOT mutate the input state (rocks/bullets arrays) during a collision', () => {
    const s0 = playing(4242, { rocks: [rockAt(CENTER, 'large')], bullets: [bulletAt(CENTER)] })
    const snapshot = structuredClone(s0)
    stepGame(s0, NO_INPUT, DT)
    expect(s0).toEqual(snapshot)
  })

  it('same seed + same collision → deeply-equal state (replay determinism)', () => {
    const scenario = (): GameState =>
      stepGame(
        playing(99, { rocks: [rockAt(CENTER, 'large')], bullets: [bulletAt(CENTER)] }),
        NO_INPUT,
        DT,
      )
    expect(scenario()).toEqual(scenario())
  })
})

describe('stepGame — small-rock collision despawns cleanly (AC-3)', () => {
  it('a bullet hitting a small rock leaves no rocks (splitRock → [])', () => {
    const s1 = stepGame(
      playing(4242, { rocks: [rockAt(CENTER, 'small')], bullets: [bulletAt(CENTER)] }),
      NO_INPUT,
      DT,
    )
    expect(s1.rocks).toHaveLength(0)
  })

  it('a small despawn draws NO randomness — the seed is unchanged', () => {
    const s0 = playing(4242, { rocks: [rockAt(CENTER, 'small')], bullets: [bulletAt(CENTER)] })
    expect(stepGame(s0, NO_INPUT, DT).rng.seed).toBe(s0.rng.seed)
  })

  it('still consumes the bullet even when the rock despawns to nothing', () => {
    const s1 = stepGame(
      playing(4242, { rocks: [rockAt(CENTER, 'small')], bullets: [bulletAt(CENTER)] }),
      NO_INPUT,
      DT,
    )
    expect(s1.bullets).toHaveLength(0)
  })
})

describe('stepGame — ship-vs-rock collision destroys the ship (AC-4)', () => {
  const shipAt = (pos: Vec2): GameState['ship'] => ({ pos: { ...pos }, vel: { x: 0, y: 0 }, dir: 64 })

  it('a fresh game starts with a live ship (shipDestroyed === false)', () => {
    expect(initialState(1).shipDestroyed).toBe(false)
  })

  it('marks the ship destroyed when it overlaps a rock', () => {
    const s0 = playing(4242, { ship: shipAt(CENTER), rocks: [rockAt(CENTER, 'large')] })
    expect(stepGame(s0, NO_INPUT, DT).shipDestroyed).toBe(true)
  })

  it('leaves the ship intact when no rock overlaps it', () => {
    const s0 = playing(4242, { ship: shipAt(CENTER), rocks: [rockAt({ x: 6000, y: 5000 }, 'large')] })
    expect(stepGame(s0, NO_INPUT, DT).shipDestroyed).toBe(false)
  })

  it('does NOT split or destroy the rock the ship rammed (rock is unaffected)', () => {
    const s0 = playing(4242, { ship: shipAt(CENTER), rocks: [rockAt(CENTER, 'large')], bullets: [] })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.rocks).toHaveLength(1)
    expect(s1.rocks[0].size).toBe('large')
    expect(s1.rng.seed).toBe(s0.rng.seed) // no split → no rng draw
  })

  it('destroyed state is sticky: it survives a later step with no overlap', () => {
    const dead = playing(4242, {
      shipDestroyed: true,
      ship: shipAt(CENTER),
      rocks: [rockAt({ x: 6000, y: 5000 }, 'large')], // far away — cannot re-collide
    })
    expect(stepGame(dead, NO_INPUT, DT).shipDestroyed).toBe(true)
  })
})

describe('stepGame — hitbox geometry scales per tier (AC-6)', () => {
  it('a bullet just inside the rock’s hitbox collides', () => {
    const near: Vec2 = { x: CENTER.x + ROCK_HITBOX.large * 0.8, y: CENTER.y }
    const s1 = stepGame(
      playing(4242, { rocks: [rockAt(CENTER, 'large')], bullets: [bulletAt(near)] }),
      NO_INPUT,
      DT,
    )
    expect(s1.rocks).toHaveLength(2) // split → collided
  })

  it('a bullet well outside the rock’s hitbox does NOT collide', () => {
    const far: Vec2 = { x: CENTER.x + ROCK_HITBOX.large * 1.5, y: CENTER.y }
    const s0 = playing(4242, { rocks: [rockAt(CENTER, 'large')], bullets: [bulletAt(far)] })
    const s1 = stepGame(s0, NO_INPUT, DT)
    expect(s1.rocks).toHaveLength(1)
    expect(s1.rocks[0].size).toBe('large') // unsplit
    expect(s1.bullets).toHaveLength(1) // bullet not consumed
    expect(s1.rng.seed).toBe(s0.rng.seed) // no split → no draw
  })

  it('per-tier: a separation that hits a large rock misses a small one at the same offset', () => {
    // Inside large's extent (132) but outside small's (42) — proves the predicate
    // reads ROCK_HITBOX[size], not one hitbox constant for every tier. Along the
    // x-axis (dy=0) box and radius interpretations agree, so this stays neutral
    // on the unresolved box-vs-radius question (A-17).
    const offset: Vec2 = { x: CENTER.x + ROCK_HITBOX.small * 1.5, y: CENTER.y }
    const largeHit = stepGame(
      playing(4242, { rocks: [rockAt(CENTER, 'large')], bullets: [bulletAt(offset)] }),
      NO_INPUT,
      DT,
    )
    const smallMiss = stepGame(
      playing(4242, { rocks: [rockAt(CENTER, 'small')], bullets: [bulletAt(offset)] }),
      NO_INPUT,
      DT,
    )
    expect(largeHit.rocks).toHaveLength(2) // large hitbox reaches the bullet
    expect(smallMiss.rocks).toHaveLength(1) // small hitbox does not
  })
})

describe('stepGame — collision is toroidal (wraps across the seam)', () => {
  // Epic-A guardrail: on a torus a rock at the right edge and a bullet just
  // across the left edge are ~20 units apart, not a world apart. A non-wrap-aware
  // AABB would wrongly MISS this. Deliberate strengthening over the story
  // context's plain |dx|<R formula (session Design Deviations).
  it('a bullet just across the seam hits a rock at the opposite edge', () => {
    const rock = rockAt({ x: WORLD_W - 10, y: 3000 }, 'large')
    const bullet = bulletAt({ x: 10, y: 3000 })
    // toroidal dx = 20 (< ROCK_HITBOX.large 132) → hit; naive dx = WORLD_W-20 → miss
    const s1 = stepGame(playing(4242, { rocks: [rock], bullets: [bullet] }), NO_INPUT, DT)
    expect(s1.rocks).toHaveLength(2)
    expect(s1.bullets).toHaveLength(0)
  })
})

describe('stepGame — positions stay wrapped onto the toroidal field (AC-5, regression)', () => {
  // Position wrap already ships (bullet.ts `advance`, rocks.ts `updateRock`);
  // these guard that stepGame keeps folding bullets and rocks on-field.
  it('wraps a rock drifting past the right edge back to the left', () => {
    const rock = rockAt({ x: WORLD_W - 4, y: 3000 }, 'large', { velocity: { x: 8, y: 0 } })
    const s1 = stepGame(playing(4242, { rocks: [rock] }), NO_INPUT, DT)
    expect(s1.rocks[0].pos.x).toBeGreaterThanOrEqual(0)
    expect(s1.rocks[0].pos.x).toBeLessThan(WORLD_W)
    expect(s1.rocks[0].pos.x).toBeCloseTo(4, 6) // (WORLD_W-4)+8 → wraps to 4
  })

  it('wraps a bullet flying past the bottom edge back to the top', () => {
    const bullet = bulletAt({ x: 4000, y: WORLD_H - 5 }, { vel: { x: 0, y: 10 } })
    const s1 = stepGame(playing(4242, { bullets: [bullet] }), NO_INPUT, DT)
    expect(s1.bullets[0].pos.y).toBeGreaterThanOrEqual(0)
    expect(s1.bullets[0].pos.y).toBeLessThan(WORLD_H)
    expect(s1.bullets[0].pos.y).toBeCloseTo(5, 6) // (WORLD_H-5)+10 → wraps to 5
  })
})

describe('collision hardening — kills A-8 mutation-weak survivors (A-9 carry-forward)', () => {
  // A-8's suite let three mutations survive (session Delivery Findings). A-9
  // builds scoring directly on this loop, so these guards lock the loop down
  // first. All are GREEN against the shipped A-8 code — pure regression guards.
  const shipAt = (pos: Vec2): GameState['ship'] => ({ pos: { ...pos }, vel: { x: 0, y: 0 }, dir: 64 })

  // Mutation A — collapse `overlaps` to one axis (|dx|<extent only): every
  // existing bullet-vs-rock test offsets along X (dy=0), so an x-only predicate
  // survives them. A purely-Y separation beyond the hitbox MUST miss.
  it('a bullet far in Y (dx=0) does NOT collide — overlaps checks BOTH axes', () => {
    const above: Vec2 = { x: CENTER.x, y: CENTER.y + ROCK_HITBOX.large * 1.5 } // |dy|=198 > 132
    const s1 = stepGame(
      playing(4242, { rocks: [rockAt(CENTER, 'large')], bullets: [bulletAt(above)] }),
      NO_INPUT,
      DT,
    )
    expect(s1.rocks).toHaveLength(1) // survives — no 1D collapse
    expect(s1.rocks[0].size).toBe('large')
    expect(s1.bullets).toHaveLength(1) // bullet not consumed
  })

  it('a bullet just inside the hitbox along Y DOES collide (the Y axis is live)', () => {
    const above: Vec2 = { x: CENTER.x, y: CENTER.y + ROCK_HITBOX.large * 0.8 } // |dy|=105.6 < 132
    const s1 = stepGame(
      playing(4242, { rocks: [rockAt(CENTER, 'large')], bullets: [bulletAt(above)] }),
      NO_INPUT,
      DT,
    )
    expect(s1.rocks).toHaveLength(2)
  })

  // Mutation B — hardcode the ship extent to one constant. Ship-vs-rock extent
  // is per-tier (SHIP_HITBOX 96 + ROCK_HITBOX[size]: large 228, small 138). One
  // gap that destroys the ship against a LARGE rock but spares it against a
  // SMALL one proves the predicate reads the rock's tier.
  it('ship-vs-rock extent scales per rock tier (large hits, small misses at the same gap)', () => {
    const gap: Vec2 = { x: CENTER.x + 150, y: CENTER.y } // 150 < 228 (large) but > 138 (small)
    const largeHit = stepGame(
      playing(4242, { ship: shipAt(CENTER), rocks: [rockAt(gap, 'large')] }),
      NO_INPUT,
      DT,
    )
    const smallMiss = stepGame(
      playing(4242, { ship: shipAt(CENTER), rocks: [rockAt(gap, 'small')] }),
      NO_INPUT,
      DT,
    )
    expect(largeHit.shipDestroyed).toBe(true)
    expect(smallMiss.shipDestroyed).toBe(false)
  })

  // Mutation C — delete the `mode === 'playing'` gate. Destruction must not
  // happen during attract or gameover.
  it('no bullet-vs-rock destruction outside playing mode', () => {
    for (const mode of ['attract', 'gameover'] as const) {
      const s1 = stepGame(
        {
          ...initialState(4242),
          mode,
          rocks: [rockAt(CENTER, 'large')],
          bullets: [bulletAt(CENTER)],
        },
        NO_INPUT,
        DT,
      )
      expect(s1.rocks).toHaveLength(1) // not split
      expect(s1.rocks[0].size).toBe('large')
    }
  })

  // Survivor identity: a non-hit rock keeps its exact position, not merely the
  // array count — an implementation that rebuilt the survivor would slip past a
  // length-only assertion.
  it('a surviving rock keeps its identity and position after another rock is hit', () => {
    const survivorPos: Vec2 = { x: 6000, y: 5000 } // far from CENTER and the ship spawn
    const s1 = stepGame(
      playing(4242, {
        rocks: [rockAt(CENTER, 'large'), rockAt(survivorPos, 'large')],
        bullets: [bulletAt(CENTER)],
      }),
      NO_INPUT,
      DT,
    )
    const survivors = s1.rocks.filter((r) => r.size === 'large')
    expect(survivors).toHaveLength(1)
    expect(survivors[0].pos).toEqual(survivorPos) // untouched — zero-drift, still exactly here
  })
})
