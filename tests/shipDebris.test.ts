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
import { breakShip, updateShipDebris, DEBRIS_LIFETIME_S } from '../src/core/shipDebris'
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
import { stepGame, GAME_OVER_DISPLAY_S } from '../src/core/sim'
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

  // Reviewer finding (rework): only `> 0` was pinned, not the exact constant —
  // a mutant changing DEBRIS_LIFETIME_S's value would have passed every test.
  it('every segment starts with exactly DEBRIS_LIFETIME_S of life', () => {
    const ship = shipAt({ x: 1000, y: 1000 })
    for (const seg of breakShip(ship, createRng(3))) {
      expect(seg.life).toBe(DEBRIS_LIFETIME_S)
    }
  })

  // Reviewer finding (rework, high confidence): every fixture elsewhere in this
  // file uses a stationary ship (vel {0,0}), so `ship.vel.x +`/`ship.vel.y +`
  // in breakShip was completely unverified — deleting those terms would have
  // passed every other test. Same rng seed for both ships isolates the DELTA
  // between them to exactly the ship's own velocity (the outward-spread angle
  // per edge is identical either way, since it's drawn from the same rng
  // sequence and doesn't depend on ship.vel).
  it("inherits the ship's own velocity as a base drift component (splitRock's precedent: children inherit the parent's motion)", () => {
    const stationary = shipAt({ x: 1000, y: 1000 })
    const moving = shipAt({ x: 1000, y: 1000 }, { vel: { x: 20, y: -10 } })
    const segsStationary = breakShip(stationary, createRng(3))
    const segsMoving = breakShip(moving, createRng(3))
    for (let i = 0; i < 4; i++) {
      expectVec(
        {
          x: segsMoving[i].vel.x - segsStationary[i].vel.x,
          y: segsMoving[i].vel.y - segsStationary[i].vel.y,
        },
        moving.vel,
      )
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

  // Reviewer finding (rework, low): never exercised with no segments at all.
  it('returns an empty array when given no segments', () => {
    expect(updateShipDebris([], DT)).toEqual([])
  })

  // Reviewer finding (rework, low): the TEA-logged "no toroidal wrap" design
  // choice (Design Deviations) was never pinned by a test — bullet.ts's own
  // analogous choice has both a doc comment AND a regression test
  // (tests/bullet.test.ts: "does NOT wrap"). A piece drifting past WORLD_W
  // must NOT fold back toward 0 the way a rock would (rocks.ts's updateRock).
  it('does not wrap at the world boundary (unlike rocks) — a piece drifting past the edge just keeps going', () => {
    const seg = segment({ p1: { x: WORLD_W - 2, y: 100 }, p2: { x: WORLD_W + 8, y: 100 }, vel: { x: 5, y: 0 } })
    const [out] = updateShipDebris([seg], DT)
    // raw x = (WORLD_W - 2) + 5*1 = WORLD_W + 3 — past the edge, not folded to ~3.
    expect(out.p1.x).toBeGreaterThan(WORLD_W)
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

  // Reviewer finding (rework, medium): only same-tick and stays-dead scenarios
  // were covered — never a SECOND, independent death while debris from an
  // earlier one is still animating. Constructed directly (a respawn already
  // landed: shipDestroyed false, one aged leftover segment) rather than
  // simulating the full multi-hundred-tick respawn sequence, to isolate
  // exactly the array-append behavior at the death edge (sim.ts).
  it('appends a fresh batch to any still-animating debris from an earlier death (does not replace it)', () => {
    const priorDebris: ShipDebrisSegment[] = [
      segment({ p1: { x: 500, y: 500 }, p2: { x: 510, y: 500 }, vel: { x: 1, y: 0 }, life: 1 }),
    ]
    const s0 = playing(4242, {
      shipDestroyed: false, // a respawn already happened; the ship is alive again
      shipDebris: priorDebris,
      ship: shipAt(CENTER),
      rocks: [rockAt(CENTER)], // a second, independent ram
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.shipDestroyed).toBe(true)
    expect(out.shipDebris).toHaveLength(5) // the 1 pre-existing (aged) + 4 fresh
  })
})

// Reviewer finding (HIGH, rework headline): stepGame's 'attract'/'gameover'
// early returns (sim.ts ~228-229) never reach updateShipDebris (sim.ts ~282),
// so debris spawned by a run-ending death FREEZES — stops fading AND stops
// drifting — for the entire GAME OVER card and into the following attract
// loop, directly contradicting the story's own "fading line segments" title.
// Reproduces on every terminal death, not an edge case. RED until sim.ts ages
// shipDebris regardless of mode (or explicitly clears it on the terminal
// transition).
describe('stepGame — ship debris keeps fading through game over (Reviewer finding, HIGH)', () => {
  it('fades the debris to nothing within DEBRIS_LIFETIME_S even after the run ends', () => {
    let s = playing(4242, { lives: 1, ship: shipAt(CENTER), rocks: [rockAt(CENTER)] })
    s = stepGame(s, NO_INPUT, DT) // the death tick — mode flips to 'gameover', 4 segments spawn
    expect(s.mode).toBe('gameover')
    expect(s.shipDebris).toHaveLength(4)

    // Step well past DEBRIS_LIFETIME_S (1.5s) while the game-over card is up —
    // GAME_OVER_DISPLAY_S is 3s, so this window stays inside the card either
    // way (qualifying or not) and isolates the fade question from the
    // attract-mode transition.
    const ticksToOutlastLifetime = Math.ceil(DEBRIS_LIFETIME_S / DT) + 10
    for (let i = 0; i < ticksToOutlastLifetime; i++) {
      s = stepGame(s, NO_INPUT, DT)
    }
    expect(s.mode).toBe('gameover') // sanity: still in the window this test means to cover
    expect(s.shipDebris).toHaveLength(0) // fully faded — must keep aging through gameover
  })

  it('keeps fading into attract mode too, if the card ends before the debris does', () => {
    // A non-qualifying run: the gameover card lasts exactly GAME_OVER_DISPLAY_S
    // (3s) — longer than DEBRIS_LIFETIME_S (1.5s) — so by the time the cabinet
    // returns to attract, the debris must already be gone, not carried over
    // frozen into the attract-mode demo loop. score: 0 (playing()'s default)
    // guarantees the non-qualifying path — qualifiesForHighScore rejects any
    // non-positive score outright (highscore.ts), regardless of the board.
    // NOTE (rework 2): this path does NOT exercise stepAttract's aging — on the
    // non-qualifying 3s-timed card, debris (1.5s) is always fully faded by the
    // gameover pipeline BEFORE attract is reached, so this test passes even if
    // stepAttract stops aging debris. It stays to document the non-qualifying
    // transition; the genuine attract-aging pins live in the describe block below.
    let s = playing(4242, { lives: 1, ship: shipAt(CENTER), rocks: [rockAt(CENTER)] })
    s = stepGame(s, NO_INPUT, DT)
    expect(s.mode).toBe('gameover')
    expect(s.gameOver?.qualifies).toBe(false) // sanity: takes the timed, non-qualifying path

    const ticksToReachAttract = Math.ceil((GAME_OVER_DISPLAY_S + 0.5) / DT) // past GAME_OVER_DISPLAY_S with margin
    for (let i = 0; i < ticksToReachAttract; i++) {
      s = stepGame(s, NO_INPUT, DT)
    }
    expect(s.mode).toBe('attract') // sanity: the card really did end
    expect(s.shipDebris).toHaveLength(0) // no frozen wreckage carried into attract
  })
})

// A2-5 (Reviewer H-1, rework round 2): the "keeps fading into attract mode too"
// test above is a VACUOUS guard for the stepAttract aging — it routes through
// the non-qualifying 3s-timed gameover path, where the gameover pipeline always
// fades debris to nothing (DEBRIS_LIFETIME_S 1.5s < GAME_OVER_DISPLAY_S 3s)
// BEFORE attract is ever reached, so it stays green even with stepAttract's
// aging reverted (mutation-verified by the Reviewer: reverting it left the whole
// suite green). The three tests below pin stepAttract's aging FOR REAL — each was
// mutation-verified during test design to go RED when the stepAttract aging is
// reverted (see TEA Assessment, rework round 2). The stepAttract path is reachable
// in real play: a qualifying high score confirmed fast returns to attract with
// live wreckage (third test), and only stepAttract keeps it fading from there.
describe('stepGame — attract mode itself ages ship debris (Reviewer H-1 pin, rework 2)', () => {
  it('drifts and fades a live debris segment on a single attract tick', () => {
    // In attract, stepAttract is the ONLY thing that can touch shipDebris (no
    // death edge, no gameover pipeline), so this isolates the aging line under
    // test: frozen debris keeps its exact life and position; aged debris moves.
    const seg = segment({ p1: { x: 1000, y: 1000 }, p2: { x: 1040, y: 1000 }, vel: { x: 6, y: -3 }, life: 1 })
    const s0: GameState = { ...initialState(4242), mode: 'attract', shipDebris: [seg] }
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.mode).toBe('attract') // sanity: no start pressed, still attract
    expect(out.shipDebris).toHaveLength(1)
    // fade: life strictly decremented by exactly dt (frozen debris keeps life: 1)
    expect(out.shipDebris[0].life).toBeCloseTo(1 - DT, 9)
    // drift: both endpoints translated by vel * dt*60 (frozen debris would not move)
    const frames = DT * 60
    expectVec(out.shipDebris[0].p1, { x: 1000 + 6 * frames, y: 1000 - 3 * frames })
    expectVec(out.shipDebris[0].p2, { x: 1040 + 6 * frames, y: 1000 - 3 * frames })
  })

  it('clears ship debris within DEBRIS_LIFETIME_S while idling in attract', () => {
    let s: GameState = { ...initialState(4242), mode: 'attract', shipDebris: [segment({ life: DEBRIS_LIFETIME_S })] }
    const ticks = Math.ceil(DEBRIS_LIFETIME_S / DT) + 10
    for (let i = 0; i < ticks; i++) s = stepGame(s, NO_INPUT, DT)
    expect(s.mode).toBe('attract')
    expect(s.shipDebris).toHaveLength(0) // frozen-in-attract wreckage would sit here forever
  })

  it('keeps fading wreckage after a fast qualifying high-score confirm re-enters attract', () => {
    // The REACHABLE real path round 1 missed: a qualifying score + 3 initials +
    // a start press returns to attract THIS tick with NO minimum-display gate
    // (stepGameOver qualifying-confirm branch), so wreckage enters attract still
    // alive — and only stepAttract keeps it fading. Pins both the confirm-tick
    // aging (stepGameOver base) AND the subsequent attract aging (Reviewer L-1 + H-1).
    const liveSeg = segment({ p1: { x: 2000, y: 2000 }, p2: { x: 2040, y: 2000 }, vel: { x: 4, y: 0 }, life: 1 })
    const s0: GameState = {
      ...initialState(4242),
      mode: 'gameover',
      gameOver: { qualifies: true, confirmed: false, initials: 'AAA', displayTimer: GAME_OVER_DISPLAY_S },
      shipDebris: [liveSeg],
      startPrev: false,
    }
    // start pressed with 3 initials -> confirm returns to attract this tick
    const confirmed = stepGame(s0, { ...NO_INPUT, start: true }, DT)
    expect(confirmed.mode).toBe('attract') // sanity: confirmed into attract
    expect(confirmed.shipDebris).toHaveLength(1) // wreckage survived the transition...
    expect(confirmed.shipDebris[0].life).toBeCloseTo(1 - DT, 9) // ...and aged one tick on the confirm (stepGameOver base)

    // now idle in attract: it must KEEP fading to nothing (stepAttract)
    let s = confirmed
    const ticks = Math.ceil(DEBRIS_LIFETIME_S / DT) + 10
    for (let i = 0; i < ticks; i++) s = stepGame(s, NO_INPUT, DT)
    expect(s.mode).toBe('attract')
    expect(s.shipDebris).toHaveLength(0) // frozen-in-attract wreckage would never clear
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
