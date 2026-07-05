// tests/shipDebris.test.ts
//
// A2-5: ship death breakup animation — on the destruction edge (the SAME edge
// sim.ts fires the 'explosion' event, ~line 389: `!wasDeadBefore && shipDestroyed`),
// the ship's rendered silhouette fractures into its 4 polygon edges as
// independent drifting, fading debris segments.
//
// No ACs existed in the sprint YAML for this story — only the title (session
// Sm Assessment). The ACs pinned below are TEA's, established fresh against
// the title and the "consistent with the existing rock-split debris visual
// language" guidance:
//   - geometry: the ship's 4-vertex polygon (nose, right wing, tail notch,
//     left wing — shell/render.ts's drawShip) fractures into its 4 edges.
//   - motion: each edge drifts with its own velocity and diverges from the
//     others — splitRock's "inherited heading + independent random spread"
//     idiom (rocks.ts), not a rigid rebroadcast of the ship's own velocity.
//   - lifetime: each piece counts down and is dropped at zero — Bullet.life's
//     countdown-to-removal idiom (bullet.ts), applied in SECONDS (dt) rather
//     than bullet.ts's frame-timer cadence (a TEA judgment call, not a spec
//     deviation — there is no existing spec for this story to deviate from).
//   - purely cosmetic: debris has no hitbox and does not gate respawn.
//
// Ship geometry (NOSE=130, TAIL=70, HALF_WIDTH=75, NOTCH=35, and the
// heading() formula) mirrors shell/render.ts's drawShip and is reproduced
// INDEPENDENTLY here — house convention (see collision.test.ts header:
// "expectations reproduced from an independent clone", same idea applied to
// geometry instead of RNG) — so these tests pin the CONTRACT (debris matches
// what was on screen the instant before death), not render.ts's
// implementation. TEA finding (session Delivery Findings): render.ts's
// NOSE/TAIL/HALF_WIDTH/NOTCH/heading() are private to shell — core cannot
// import them, so this is a genuine cross-boundary duplication risk; Dev
// should consider hoisting them into a shared core module (bounds.ts's own
// "one function, not parallel copies" precedent) rather than re-tuning one
// copy and silently drifting from the other.
//
// RED until core/shipDebris.ts exists, GameState grows `shipDebris`, and
// sim.ts spawns/advances it on the death edge.

import { describe, it, expect } from 'vitest'
import { breakShip, updateShipDebris } from '../src/core/shipDebris'
import {
  initialState,
  WORLD_W,
  WORLD_H,
  type GameState,
  type Ship,
  type ShipDebrisSegment,
  type Rock,
  type Bullet,
  type Vec2,
} from '../src/core/state'
import { createRng } from '../src/core/rng'
import { stepGame } from '../src/core/sim'
import { NO_INPUT } from '../src/core/input'

const DT = 1 / 60

// Mirrors shell/render.ts's private drawShip constants (see file header) —
// kept independent so these tests pin the CONTRACT, not the implementation.
const NOSE = 130
const TAIL = 70
const HALF_WIDTH = 75
const NOTCH = 35

function heading(dir: number): { fx: number; fy: number; px: number; py: number } {
  const theta = (dir / 256) * Math.PI * 2
  const fx = Math.cos(theta)
  const fy = Math.sin(theta)
  return { fx, fy, px: -fy, py: fx }
}

/** The ship's 4 polygon vertices in world space — nose, right wing, tail
 * notch, left wing — reproducing shell/render.ts's drawShip geometry
 * independently of the implementation under test. */
function shipVertices(ship: Ship): [Vec2, Vec2, Vec2, Vec2] {
  const { fx, fy, px, py } = heading(ship.dir)
  const { x, y } = ship.pos
  return [
    { x: x + fx * NOSE, y: y + fy * NOSE },
    { x: x - fx * TAIL + px * HALF_WIDTH, y: y - fy * TAIL + py * HALF_WIDTH },
    { x: x - fx * NOTCH, y: y - fy * NOTCH },
    { x: x - fx * TAIL - px * HALF_WIDTH, y: y - fy * TAIL - py * HALF_WIDTH },
  ]
}

/** The 4 edges of the closed ship polygon, in the same order drawShip strokes
 * them: nose -> right wing -> notch -> left wing -> back to nose. */
function shipEdges(ship: Ship): Array<[Vec2, Vec2]> {
  const [nose, rightWing, notch, leftWing] = shipVertices(ship)
  return [
    [nose, rightWing],
    [rightWing, notch],
    [notch, leftWing],
    [leftWing, nose],
  ]
}

/** Assert two positions are equal component-wise (tolerant of float dust) —
 * same helper + tolerance convention as rocks.test.ts's expectVec. */
function expectVec(actual: Vec2, expected: Vec2, precision = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, precision)
  expect(actual.y).toBeCloseTo(expected.y, precision)
}

function shipAt(pos: Vec2, over: Partial<Ship> = {}): Ship {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, dir: 64, visible: true, ...over }
}

function rockAt(pos: Vec2): Rock {
  return { pos: { ...pos }, velocity: { x: 0, y: 0 }, size: 'large', shapeVariant: 0 }
}

function bulletAt(pos: Vec2): Bullet {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, life: 60, owner: 'player' }
}

function segment(over: Partial<ShipDebrisSegment> = {}): ShipDebrisSegment {
  return {
    p1: { x: 0, y: 0 },
    p2: { x: 10, y: 0 },
    vel: { x: 5, y: 0 },
    life: 1,
    ...over,
  }
}

// --- breakShip: geometry (consistent with the rendered ship) -------------

describe('breakShip — fractures the ship into its 4 rendered polygon edges', () => {
  it('returns exactly 4 segments', () => {
    const ship = shipAt({ x: 1000, y: 1000 })
    expect(breakShip(ship, createRng(1))).toHaveLength(4)
  })

  it("each segment's endpoints match one edge of the ship's rendered silhouette (dir 64)", () => {
    const ship = shipAt({ x: 1000, y: 1000 })
    const segments = breakShip(ship, createRng(1))
    const edges = shipEdges(ship)
    for (let i = 0; i < 4; i++) {
      expectVec(segments[i].p1, edges[i][0])
      expectVec(segments[i].p2, edges[i][1])
    }
  })

  it('matches the rendered silhouette at a different heading too (dir 0, not just the spawn default)', () => {
    const ship = shipAt({ x: 2000, y: 2000 }, { dir: 0 })
    const segments = breakShip(ship, createRng(1))
    const edges = shipEdges(ship)
    for (let i = 0; i < 4; i++) {
      expectVec(segments[i].p1, edges[i][0])
      expectVec(segments[i].p2, edges[i][1])
    }
  })
})

// --- breakShip: motion (drifting apart, not a rigid rebroadcast) ---------

describe('breakShip — each piece drifts independently (fracture, not rigid translation)', () => {
  it('every segment has a nonzero velocity (the pieces actually move)', () => {
    const ship = shipAt({ x: 1000, y: 1000 })
    for (const seg of breakShip(ship, createRng(3))) {
      expect(Math.hypot(seg.vel.x, seg.vel.y)).toBeGreaterThan(0)
    }
  })

  it('the 4 pieces do not all share the same velocity (they diverge, like a split rock)', () => {
    const ship = shipAt({ x: 1000, y: 1000 })
    const segments = breakShip(ship, createRng(3))
    const distinct = new Set(segments.map((s) => `${s.vel.x.toFixed(6)},${s.vel.y.toFixed(6)}`))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('every segment starts with a positive life (something left to fade)', () => {
    const ship = shipAt({ x: 1000, y: 1000 })
    for (const seg of breakShip(ship, createRng(3))) {
      expect(seg.life).toBeGreaterThan(0)
    }
  })
})

// --- breakShip: rng discipline (mirrors splitRock's contract exactly) ----

describe('breakShip — determinism, purity, rng threading (mirrors splitRock)', () => {
  it('is deterministic: same ship + identically-seeded rng -> deeply-equal segments', () => {
    const ship = shipAt({ x: 1000, y: 1000 })
    expect(breakShip(ship, createRng(2626))).toEqual(breakShip(ship, createRng(2626)))
  })

  it('does not mutate the input ship', () => {
    const ship = shipAt({ x: 1000, y: 1000 }, { vel: { x: 4, y: -1 } })
    const snapshot = structuredClone(ship)
    breakShip(ship, createRng(4))
    expect(ship).toEqual(snapshot)
  })

  it('returns fresh, distinct segment + point objects (no aliasing across pieces)', () => {
    const ship = shipAt({ x: 1000, y: 1000 })
    const [a, b] = breakShip(ship, createRng(8))
    expect(a).not.toBe(b)
    expect(a.p1).not.toBe(b.p1)
    expect(a.vel).not.toBe(b.vel)
  })

  it('consumes randomness from the rng (advances the seed)', () => {
    const rng = createRng(1979)
    const before = rng.seed
    breakShip(shipAt({ x: 1000, y: 1000 }), rng)
    expect(rng.seed).not.toBe(before)
  })

  it('draws a different spread on successive calls from one rng (not memoized/hardcoded)', () => {
    const rng = createRng(1979)
    const ship = shipAt({ x: 1000, y: 1000 })
    const first = breakShip(ship, rng)
    const second = breakShip(ship, rng)
    expect(first.map((s) => s.vel)).not.toEqual(second.map((s) => s.vel))
  })

  it('exposes exactly {p1, p2, vel, life} on each segment', () => {
    for (const seg of breakShip(shipAt({ x: 1000, y: 1000 }), createRng(7))) {
      expect(Object.keys(seg).sort()).toEqual(['life', 'p1', 'p2', 'vel'])
    }
  })
})

// --- updateShipDebris: pure drift (rigid translation per piece) ----------

describe('updateShipDebris — rigid translation (the piece drifts, it does not stretch)', () => {
  it('translates both endpoints by the same delta (segment shape/length is preserved)', () => {
    const seg = segment({ p1: { x: 100, y: 100 }, p2: { x: 140, y: 100 }, vel: { x: 6, y: -3 }, life: 5 })
    const [out] = updateShipDebris([seg], DT)
    const frames = DT * 60 // the codebase-wide per-frame convention (rocks.ts/bullet.ts)
    expectVec(out.p1, { x: 100 + 6 * frames, y: 100 - 3 * frames })
    expectVec(out.p2, { x: 140 + 6 * frames, y: 100 - 3 * frames })
  })

  it('does not move the segment at dt = 0', () => {
    const seg = segment({ p1: { x: 50, y: 50 }, p2: { x: 60, y: 50 } })
    const [out] = updateShipDebris([seg], 0)
    expectVec(out.p1, { x: 50, y: 50 })
    expectVec(out.p2, { x: 60, y: 50 })
  })

  it('scales displacement with dt (half dt -> half the step)', () => {
    const seg = segment({ p1: { x: 100, y: 100 }, p2: { x: 140, y: 100 }, vel: { x: 6, y: -3 }, life: 5 })
    const [out] = updateShipDebris([seg], DT / 2)
    const frames = (DT / 2) * 60
    expectVec(out.p1, { x: 100 + 6 * frames, y: 100 - 3 * frames })
  })

  it('preserves velocity each tick (straight flight, no drag)', () => {
    const seg = segment({ vel: { x: 6, y: -3 } })
    const [out] = updateShipDebris([seg], DT)
    expectVec(out.vel, { x: 6, y: -3 })
  })
})

describe('updateShipDebris — life counts down and expired pieces fade out', () => {
  it('decrements life by dt each call', () => {
    const seg = segment({ life: 1 })
    const [out] = updateShipDebris([seg], DT)
    expect(out.life).toBeCloseTo(1 - DT, 9)
  })

  it('removes a segment once its life reaches zero', () => {
    const seg = segment({ life: DT })
    expect(updateShipDebris([seg], DT)).toHaveLength(0)
  })

  it('removes a segment whose life has already run out (negative)', () => {
    const seg = segment({ life: -0.001 })
    expect(updateShipDebris([seg], DT)).toHaveLength(0)
  })

  it('keeps a segment with life remaining after decrement', () => {
    const seg = segment({ life: 1 })
    expect(updateShipDebris([seg], DT)).toHaveLength(1)
  })

  it('ages and removes segments independently — one expiring does not affect another', () => {
    const dying = segment({ p1: { x: 0, y: 0 }, life: DT })
    const surviving = segment({
      p1: { x: 500, y: 500 },
      p2: { x: 510, y: 500 },
      vel: { x: 1, y: 0 },
      life: 5,
    })
    const out = updateShipDebris([dying, surviving], DT)
    expect(out).toHaveLength(1)
    expectVec(out[0].p1, { x: 500 + 1 * DT * 60, y: 500 })
  })
})

describe('updateShipDebris — purity / immutable return', () => {
  it('does not mutate the input segments', () => {
    const seg = segment({ life: 5 })
    const snapshot = structuredClone(seg)
    updateShipDebris([seg], DT)
    expect(seg).toEqual(snapshot)
  })

  it('returns fresh segment + point objects, not the input references', () => {
    const seg = segment({ life: 5 })
    const [out] = updateShipDebris([seg], DT)
    expect(out).not.toBe(seg)
    expect(out.p1).not.toBe(seg.p1)
  })
})

// --- stepGame integration: spawn on the death edge (mirrors the explosion
// event's own edge, sim.ts ~line 389) --------------------------------------

function playing(seed: number, over: Partial<GameState> = {}): GameState {
  return { ...initialState(seed), mode: 'playing', lives: 3, shipDebris: [], ...over }
}

// Clear of the default ship spawn ({4096, 3072}) — mirrors collision.test.ts's
// CENTER convention so rock fixtures never trip an unintended extra hit.
const CENTER: Vec2 = { x: 2000, y: 2000 }
const WORLD_CENTER: Vec2 = { x: WORLD_W / 2, y: WORLD_H / 2 }

describe('stepGame — spawns ship debris on the destruction edge', () => {
  it('a fresh game starts with no ship debris', () => {
    expect(initialState(1).shipDebris).toEqual([])
  })

  it('spawns 4 debris segments the frame a rock ram destroys the ship', () => {
    const s0 = playing(4242, { ship: shipAt(CENTER), rocks: [rockAt(CENTER)] })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.shipDestroyed).toBe(true)
    expect(out.shipDebris).toHaveLength(4)
  })

  it('spawns debris matching an independent clone of the same seed (RNG-clone discipline, mirrors AC-2 in collision.test.ts)', () => {
    const seed = 4242
    const ship = shipAt(CENTER)
    const s0 = playing(seed, { ship, rocks: [rockAt(CENTER)] })
    const out = stepGame(s0, NO_INPUT, DT)

    // Reproduced independently from a fresh clone of the SAME seed — breakShip
    // is this step's only rng consumer in this scenario (no bullet/splitRock,
    // no saucer/wave spawn: the ship dies before either director's "live ship"
    // gate can pass), so the threaded seed must land here.
    const clone = createRng(seed)
    const expected = breakShip(ship, clone)

    expect(out.rng.seed).toBe(clone.seed)
    expect(out.shipDebris.map((s) => s.vel)).toEqual(expected.map((s) => s.vel))
  })

  it('spawns no debris when no collision happens', () => {
    const s0 = playing(4242, { ship: shipAt(CENTER), rocks: [rockAt({ x: 6000, y: 5000 })] })
    expect(stepGame(s0, NO_INPUT, DT).shipDebris).toHaveLength(0)
  })

  it('spawns debris even on the last life, when the run ends (mirrors the explosion-event guard)', () => {
    const s0 = playing(4242, { lives: 1, ship: shipAt(CENTER), rocks: [rockAt(CENTER)] })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.mode).toBe('gameover')
    expect(out.shipDebris).toHaveLength(4)
  })

  it('spawns no debris while the post-respawn invulnerability window shields the ship', () => {
    const s0 = playing(4242, { ship: shipAt(CENTER), rocks: [rockAt(CENTER)], shipSpawnTimer: 1 })
    expect(stepGame(s0, NO_INPUT, DT).shipDebris).toHaveLength(0)
  })

  it('does not spawn a second batch on a later tick while the ship stays dead (edge-triggered, not sticky)', () => {
    const already: ShipDebrisSegment[] = [segment({ life: 5 })]
    const s0 = playing(4242, {
      shipDestroyed: true, // already dead going in — wasDeadBefore will be true
      shipDebris: already,
      ship: shipAt(CENTER),
      // A rock parked on the world-center respawn point blocks tryRespawnShip
      // this tick too, so the only thing this test measures is debris count.
      rocks: [rockAt(WORLD_CENTER)],
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.shipDestroyed).toBe(true) // still dead — respawn was blocked
    expect(out.shipDebris).toHaveLength(1) // the one pre-existing piece, not +4 more
  })
})

describe('stepGame — ship debris is purely cosmetic (guardrails)', () => {
  it('does not block or alter respawn — the ship still revives at a clear center with debris present', () => {
    const wornDebris: ShipDebrisSegment[] = [
      segment({ p1: { ...WORLD_CENTER }, p2: { x: WORLD_CENTER.x + 10, y: WORLD_CENTER.y }, life: 5 }),
    ]
    const s0 = playing(4242, {
      shipDestroyed: true,
      shipDebris: wornDebris,
      ship: shipAt(CENTER),
      rocks: [], // clear center — nothing but debris sits at the respawn point
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.shipDestroyed).toBe(false) // respawned despite debris at the exact spawn point
  })

  it('has no hitbox — a player bullet passes straight through a debris segment', () => {
    const debrisAtCenter: ShipDebrisSegment[] = [
      segment({ p1: { ...CENTER }, p2: { x: CENTER.x + 10, y: CENTER.y }, life: 5 }),
    ]
    const s0 = playing(4242, {
      shipDebris: debrisAtCenter,
      ship: shipAt({ x: 6000, y: 5000 }), // clear of CENTER — isolates debris as the only nearby "obstacle"
      bullets: [bulletAt(CENTER)],
      rocks: [],
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.bullets).toHaveLength(1) // survives — debris is not a collidable entity
  })
})
