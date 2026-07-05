// tests/overlapping-rocks.test.ts
//
// A2-7: one shot destroys only one rock — a bullet consumed on its first rock
// hit must never also destroy a second, spatially-overlapping rock in the same
// frame. Rocks never avoid each other (rocks.ts has no rock-vs-rock repulsion),
// so two rocks CAN legitimately share overlapping hitboxes — most commonly
// right after a split, since splitRock spawns both children at the exact
// parent position (rocks.ts: `pos: { x: rock.pos.x, y: rock.pos.y }`) and they
// only drift apart over subsequent frames.
//
// House conventions match collision.test.ts: motionless zero-velocity fixtures
// (rockAt/bulletAt) isolate collision geometry from step-order/movement, and
// `playing(seed, over)` overlays a `mode: 'playing'` state.
//
// These pin the collision loop's SINGLE-PASS-PER-BULLET contract (sim.ts
// `stepGame`, ~line 313-329): `working.findIndex(...)` finds the first rock
// (array order, not distance) whose hitbox the bullet's swept path reaches;
// `continue` consumes the bullet immediately after — the loop never checks the
// same bullet against a second rock. A regression that re-entered the rock
// scan after a hit (e.g. a stray second findIndex, or omitting `continue`)
// would destroy both overlapping rocks from a single shot.

import { describe, it, expect } from 'vitest'
import { stepGame } from '../src/core/sim'
import { initialState, type GameState, type Rock, type RockSize, type Bullet, type Vec2 } from '../src/core/state'
import { NO_INPUT } from '../src/core/input'

const DT = 1 / 60

// Interior point clear of the default ship spawn ({4096, 3072}) — mirrors
// collision.test.ts's CENTER so ship-vs-rock never trips unintentionally.
const CENTER: Vec2 = { x: 2000, y: 2000 }

function rockAt(pos: Vec2, size: RockSize, over: Partial<Rock> = {}): Rock {
  return { pos: { ...pos }, velocity: { x: 0, y: 0 }, size, shapeVariant: 0, ...over }
}

function bulletAt(pos: Vec2, over: Partial<Bullet> = {}): Bullet {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, life: 60, owner: 'player', ...over }
}

function playing(seed: number, over: Partial<GameState> = {}): GameState {
  return { ...initialState(seed), mode: 'playing', ...over }
}

describe('stepGame — bullet vs. two overlapping rocks, same size (A2-7 AC-1)', () => {
  // 50 units apart: within ROCK_HITBOX.medium (72) of EACH rock's own centre,
  // so a bullet sitting at rockA's position is independently within reach of
  // both rocks' hitboxes — the scenario the AC calls "overlapping".
  const rockA = rockAt(CENTER, 'medium')
  const rockB = rockAt({ x: CENTER.x + 50, y: CENTER.y }, 'medium')

  it('destroys exactly one rock (2 small children + 1 untouched medium survivor = 3 rocks)', () => {
    const s1 = stepGame(playing(4242, { rocks: [rockA, rockB], bullets: [bulletAt(CENTER)] }), NO_INPUT, DT)
    expect(s1.rocks).toHaveLength(3)
    expect(s1.rocks.filter((r) => r.size === 'small')).toHaveLength(2) // rockA's children
    expect(s1.rocks.filter((r) => r.size === 'medium')).toHaveLength(1) // the untouched survivor, rockB
  })

  it('the untouched rock keeps its exact position — the first-in-array rock (rockA) is the one destroyed', () => {
    const s1 = stepGame(playing(4242, { rocks: [rockA, rockB], bullets: [bulletAt(CENTER)] }), NO_INPUT, DT)
    const survivor = s1.rocks.find((r) => r.size === 'medium')
    expect(survivor?.pos).toEqual(rockB.pos)
  })

  it('consumes the bullet on the first hit — it is not re-checked against the second rock', () => {
    const s1 = stepGame(playing(4242, { rocks: [rockA, rockB], bullets: [bulletAt(CENTER)] }), NO_INPUT, DT)
    expect(s1.bullets).toHaveLength(0)
  })
})

describe('stepGame — bullet vs. two overlapping rocks, different sizes (A2-7 AC-1/AC-2)', () => {
  // 60 units apart: within ROCK_HITBOX.large (132) AND ROCK_HITBOX.medium (72)
  // of each rock's own centre — both tiers are independently reachable.
  const rockA = rockAt(CENTER, 'large')
  const rockB = rockAt({ x: CENTER.x + 60, y: CENTER.y }, 'medium')

  it('destroys only the first-in-array rock (large → 2 medium children); the medium survivor is untouched', () => {
    const s1 = stepGame(playing(4242, { rocks: [rockA, rockB], bullets: [bulletAt(CENTER)] }), NO_INPUT, DT)
    expect(s1.rocks.filter((r) => r.size === 'large')).toHaveLength(0) // rockA destroyed
    // 2 new medium children (spawned at rockA/CENTER) + rockB (untouched, at CENTER+60) = 3 mediums total
    expect(s1.rocks.filter((r) => r.size === 'medium')).toHaveLength(3)
  })

  it('documents array-order semantics: rockB (second in array, medium) survives at its exact original position', () => {
    const s1 = stepGame(playing(4242, { rocks: [rockA, rockB], bullets: [bulletAt(CENTER)] }), NO_INPUT, DT)
    const survivor = s1.rocks.find(
      (r) => r.size === 'medium' && r.pos.x === rockB.pos.x && r.pos.y === rockB.pos.y,
    )
    expect(survivor).toBeDefined()
  })
})

describe('stepGame — fast bullet tunneling through two overlapping rocks (A2-7 AC-3, extends A-13)', () => {
  // Mirrors collision.test.ts's swept-collision fixture: a shot at the cardinal
  // muzzle speed (111 lo-units/frame) whose single-frame path crosses BOTH
  // rocks' hit windows must still destroy only the first one it sweeps.
  const R: Vec2 = { x: 5000, y: 3000 }
  const rockA = rockAt(R, 'small')
  const rockB = rockAt({ x: R.x + 40, y: R.y }, 'small') // 40 < ROCK_HITBOX.small (42): overlapping

  it('a fast shot sweeping through the overlap destroys only the first rock in its path', () => {
    const bullet = bulletAt({ x: R.x - 60, y: R.y }, { vel: { x: 111, y: 0 } })
    const s1 = stepGame(playing(4242, { rocks: [rockA, rockB], bullets: [bullet] }), NO_INPUT, DT)
    // rockA (small, first in array) despawns to nothing; rockB (small) survives untouched.
    expect(s1.rocks).toHaveLength(1)
    expect(s1.rocks[0].pos).toEqual(rockB.pos)
    expect(s1.bullets).toHaveLength(0) // shot consumed on the first hit
  })
})

describe('stepGame — overlapping-rocks determinism (A2-7 AC-5)', () => {
  it('same seed + same overlapping-rocks collision → deeply-equal state (replay determinism)', () => {
    const rockA = rockAt(CENTER, 'medium')
    const rockB = rockAt({ x: CENTER.x + 50, y: CENTER.y }, 'medium')
    const scenario = (): GameState =>
      stepGame(playing(99, { rocks: [rockA, rockB], bullets: [bulletAt(CENTER)] }), NO_INPUT, DT)
    expect(scenario()).toEqual(scenario())
  })
})
