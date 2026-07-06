// tests/saucerDebris.test.ts
//
// A-21: saucer death breakup — when the flying saucer is DESTROYED (a player
// shot, a ship ram, or a rock), its rendered silhouette fractures into
// independent drifting, fading line-segment debris, exactly the treatment the
// player ship got in A2-5 (core/shipDebris.ts). Today the saucer just vanishes
// (`saucer = null`) at all three death sites with no breakup.
//
// No ACs existed in the sprint YAML — the ACs pinned below are TEA's, originated
// from the enriched story context (sprint/context/context-story-A-21.md) and the
// A2-5 precedent, per the SM handoff note. The crux the SM flagged is RNG
// DISCIPLINE: breakShip CONSUMES rng, but a saucer death is followed IN THE SAME
// FRAME by stepSaucer + updateSpawnDirector reading the shared rng — so a
// rng-consuming breakup would shift the wave/saucer spawn stream (the A2-6/A2-8
// determinism trap that made core/shrapnel.ts spawnShrapnel RNG-FREE). This suite
// therefore pins breakSaucer as RNG-FREE and asserts a saucer death does NOT
// advance state.rng.seed.
//
// Contract established for Dev (mirrors A2-5's shape, retargeted + RNG-free):
//   - core/saucerShape.ts: the saucer geometry constants (hoisted out of
//     shell/render.ts's drawSaucer) + `saucerSegments(saucer)` returning the 10
//     silhouette edges (a closed 6-point hull lens + a 3-edge open canopy dome +
//     a 1-segment waistline). One geometry source for BOTH the renderer and the
//     breakup, so the fractured pieces match what was on screen (A2-5's
//     "one function, not two parallel copies" precedent — shipShape.ts).
//   - core/saucerDebris.ts: `breakSaucer(saucer): ShipDebrisSegment[]` — PURE and
//     RNG-FREE (no rng param); one segment per silhouette edge, each inheriting
//     the saucer's velocity plus a fixed outward drift; `life` =
//     SAUCER_DEBRIS_LIFETIME_S.
//   - state.ts: `GameState.saucerDebris: ShipDebrisSegment[]`, seeded [] in
//     initialState (the ShipDebrisSegment type is a generic p1/p2/vel/life line
//     segment — reused, not duplicated).
//   - sim.ts: spawn breakSaucer at the 3 death sites (player shot ~L378, ship ram
//     ~L406, rock ~L418) into saucerDebris; age saucerDebris in EVERY mode
//     pipeline (playing, stepGameOver, stepAttract) — A2-5's headline HIGH bug was
//     debris freezing once mode left 'playing'. Debris is COSMETIC: never in a
//     collision loop, never in lives.ts isCenterClear.
//
// GEOMETRY NOTE (paranoia): the waistline edge's midpoint IS the saucer center
// (it spans [x-HALF_W, y]..[x+HALF_W, y]), so a naive "velocity = outward from
// center" scheme gives that one piece a ZERO velocity — degenerate. The
// "every segment moves" test below forbids that, nudging Dev to a fixed
// index-based outward pattern (à la core/shrapnel.ts's SHRAPNEL_PATTERN), which
// is also the natural RNG-free way to make the pieces diverge.
//
// RED until core/saucerShape.ts + core/saucerDebris.ts exist, GameState grows
// `saucerDebris`, and sim.ts spawns/ages it on the death edges.

import { describe, it, expect } from 'vitest'
import { breakSaucer, SAUCER_DEBRIS_LIFETIME_S } from '../src/core/saucerDebris'
import { saucerSegments } from '../src/core/saucerShape'
import {
  initialState,
  WORLD_W,
  type GameState,
  type Saucer,
  type Ship,
  type ShipDebrisSegment,
  type Rock,
  type Bullet,
  type Vec2,
} from '../src/core/state'
import { SAUCER_SPEED } from '../src/core/saucer'
import { stepGame } from '../src/core/sim'
import { NO_INPUT } from '../src/core/input'

const DT = 1 / 60

// Clear of the default ship spawn ({WORLD_W/2, WORLD_H/2} = {4096, 3072}) so a
// saucer/rock fixture at CENTER never trips an unintended ship collision.
const CENTER: Vec2 = { x: 2000, y: 2000 }
const FAR: Vec2 = { x: 6000, y: 5000 }
const WORLD_CENTER: Vec2 = { x: WORLD_W / 2, y: 3072 }

function saucerAt(pos: Vec2, over: Partial<Saucer> = {}): Saucer {
  // High course/fire timers so a single step never rerolls the course or fires a
  // shot (either would only matter for the far-edge despawn fixture, where the
  // saucer must survive the collision block and then just drift off-edge).
  return {
    pos: { ...pos },
    velocity: { x: 0, y: 0 },
    size: 'large',
    courseTimer: 100,
    fireTimer: 100,
    ...over,
  }
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

/** Component-wise position equality tolerant of float dust (rocks.test.ts's expectVec). */
function expectVec(actual: Vec2, expected: Vec2, precision = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, precision)
  expect(actual.y).toBeCloseTo(expected.y, precision)
}

function playing(seed: number, over: Partial<GameState> = {}): GameState {
  return { ...initialState(seed), mode: 'playing', lives: 3, saucerDebris: [], ...over }
}

// The saucer silhouette decomposes into 10 edges: a closed 6-point hull lens (6),
// an open 3-edge canopy dome (3), and the 1-segment waistline (1) — see
// shell/render.ts drawSaucer.
const SILHOUETTE_EDGE_COUNT = 10

// --- breakSaucer: geometry (matches the rendered silhouette) --------------

describe('breakSaucer — fractures the saucer into its rendered silhouette edges', () => {
  it('returns one segment per silhouette edge (6 hull + 3 canopy + 1 waistline = 10)', () => {
    const saucer = saucerAt(CENTER)
    expect(breakSaucer(saucer)).toHaveLength(SILHOUETTE_EDGE_COUNT)
  })

  it('returns exactly as many segments as saucerSegments defines (one per edge)', () => {
    const saucer = saucerAt(CENTER)
    expect(breakSaucer(saucer)).toHaveLength(saucerSegments(saucer).length)
  })

  it("each segment's endpoints match one edge of the saucer's rendered silhouette", () => {
    const saucer = saucerAt(CENTER)
    const segments = breakSaucer(saucer)
    const edges = saucerSegments(saucer)
    for (let i = 0; i < edges.length; i++) {
      expectVec(segments[i].p1, edges[i][0])
      expectVec(segments[i].p2, edges[i][1])
    }
  })

  it('tracks the saucer position — geometry translates with the saucer (it does not rotate)', () => {
    const here = saucerAt(CENTER)
    const there = saucerAt({ x: CENTER.x + 500, y: CENTER.y - 300 })
    const segHere = breakSaucer(here)
    const segThere = breakSaucer(there)
    for (let i = 0; i < segHere.length; i++) {
      // Every endpoint shifts by exactly the saucer's translation — a rigid move.
      expectVec(
        { x: segThere[i].p1.x - segHere[i].p1.x, y: segThere[i].p1.y - segHere[i].p1.y },
        { x: 500, y: -300 },
      )
    }
  })
})

// --- breakSaucer: motion (drifting apart, inheriting the saucer's velocity) -

describe('breakSaucer — each piece drifts independently (fracture, not a rigid rebroadcast)', () => {
  it('every segment has a nonzero velocity — including the waistline, whose midpoint is the saucer center', () => {
    // The degenerate case: the waistline edge midpoint coincides with the saucer
    // center, so a pure center-outward scheme would leave it motionless. Every
    // piece must actually move.
    for (const seg of breakSaucer(saucerAt(CENTER))) {
      expect(Math.hypot(seg.vel.x, seg.vel.y)).toBeGreaterThan(0)
    }
  })

  it('the pieces do not all share one velocity (they diverge, like a broken ship)', () => {
    const segments = breakSaucer(saucerAt(CENTER))
    const distinct = new Set(segments.map((s) => `${s.vel.x.toFixed(6)},${s.vel.y.toFixed(6)}`))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('every segment starts with a positive life (something left to fade)', () => {
    for (const seg of breakSaucer(saucerAt(CENTER))) {
      expect(seg.life).toBeGreaterThan(0)
    }
  })

  // Mirrors A2-5's Reviewer-added exact-constant pin: `> 0` alone would let a
  // mutant changing SAUCER_DEBRIS_LIFETIME_S's value pass undetected.
  it('every segment starts with exactly SAUCER_DEBRIS_LIFETIME_S of life', () => {
    for (const seg of breakSaucer(saucerAt(CENTER))) {
      expect(seg.life).toBe(SAUCER_DEBRIS_LIFETIME_S)
    }
  })

  // A moving saucer vs a stationary saucer at the SAME position isolates the
  // velocity DELTA to exactly the saucer's own velocity: the fixed outward-drift
  // component depends only on geometry/index (identical for both), so a mutant
  // dropping the `saucer.velocity +` term would fail here (every other motion
  // fixture uses a stationary saucer).
  it("inherits the saucer's own velocity as a base drift component (debris carries its momentum)", () => {
    const stationary = saucerAt(CENTER)
    const moving = saucerAt(CENTER, { velocity: { x: 12, y: -5 } })
    const segStationary = breakSaucer(stationary)
    const segMoving = breakSaucer(moving)
    for (let i = 0; i < segStationary.length; i++) {
      expectVec(
        {
          x: segMoving[i].vel.x - segStationary[i].vel.x,
          y: segMoving[i].vel.y - segStationary[i].vel.y,
        },
        moving.velocity,
      )
    }
  })
})

// --- breakSaucer: RNG-FREE + purity (the crux) ----------------------------

describe('breakSaucer — RNG-FREE and pure (must not perturb the spawn stream)', () => {
  it('takes only the saucer — no rng parameter (a break must not consume randomness)', () => {
    // Function arity guard: breakShip(ship, rng) has arity 2 and consumes rng;
    // breakSaucer must have arity 1. If Dev threads an rng, this fails — and so
    // does the state.rng.seed-invariance integration test below.
    expect(breakSaucer.length).toBe(1)
  })

  it('is deterministic: same saucer -> deeply-equal segments (no hidden randomness)', () => {
    const saucer = saucerAt(CENTER, { velocity: { x: 3, y: 2 } })
    expect(breakSaucer(saucer)).toEqual(breakSaucer(saucer))
  })

  it('does not mutate the input saucer', () => {
    const saucer = saucerAt(CENTER, { velocity: { x: 4, y: -1 } })
    const snapshot = structuredClone(saucer)
    breakSaucer(saucer)
    expect(saucer).toEqual(snapshot)
  })

  it('returns fresh, distinct segment + point objects (no aliasing across pieces)', () => {
    const [a, b] = breakSaucer(saucerAt(CENTER))
    expect(a).not.toBe(b)
    expect(a.p1).not.toBe(b.p1)
    expect(a.vel).not.toBe(b.vel)
  })

  it('exposes exactly {p1, p2, vel, life} on each segment', () => {
    for (const seg of breakSaucer(saucerAt(CENTER))) {
      expect(Object.keys(seg).sort()).toEqual(['life', 'p1', 'p2', 'vel'])
    }
  })
})

// --- stepGame integration: spawn on each death site, NOT on despawn --------

describe('stepGame — spawns saucer debris the frame the saucer is DESTROYED', () => {
  it('a fresh game starts with no saucer debris', () => {
    expect(initialState(1).saucerDebris).toEqual([])
  })

  it('spawns debris + removes the saucer when a PLAYER SHOT kills it', () => {
    const s0 = playing(4242, {
      saucer: saucerAt(CENTER),
      bullets: [bulletAt(CENTER)], // player shot on top of the saucer
      ship: shipAt(FAR),
      rocks: [],
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.saucer).toBe(null)
    expect(out.saucerDebris).toHaveLength(SILHOUETTE_EDGE_COUNT)
  })

  it('spawns debris + removes the saucer when the SHIP RAMS it (mutual destruction)', () => {
    const s0 = playing(4242, {
      saucer: saucerAt(CENTER),
      ship: shipAt(CENTER), // coincident -> ram
      rocks: [],
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.saucer).toBe(null)
    expect(out.shipDestroyed).toBe(true) // mutual: the ship dies too
    expect(out.saucerDebris).toHaveLength(SILHOUETTE_EDGE_COUNT)
  })

  // The RNG crux. A rock-kill isolates breakSaucer as the ONLY candidate rng
  // consumer this step: no player bullet (no splitRock), the ship is far (no ram,
  // no breakShip), the field is not clear (the killing rock remains -> no wave
  // spawn), and the saucer is already gone (no saucer spawn / stepSaucer draw).
  // So the seed is invariant IFF breakSaucer is RNG-free.
  it('spawns debris + removes the saucer when a ROCK kills it — WITHOUT advancing the rng', () => {
    const s0 = playing(4242, {
      saucer: saucerAt(CENTER),
      rocks: [rockAt(CENTER)], // rock on the saucer -> saucer↔rock kill
      ship: shipAt(FAR),
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.saucer).toBe(null)
    expect(out.saucerDebris).toHaveLength(SILHOUETTE_EDGE_COUNT)
    expect(out.rng.seed).toBe(s0.rng.seed) // RNG-FREE: a saucer death must not shift the spawn stream
  })

  // Despawn is NOT death. A saucer crossing the far edge becomes null in
  // stepSaucer — it flew away, it did not explode. It must spawn NO debris.
  it('spawns NO debris when the saucer merely DESPAWNS off the far edge', () => {
    const s0 = playing(4242, {
      saucer: saucerAt({ x: WORLD_W - 1, y: 3000 }, { velocity: { x: SAUCER_SPEED, y: 0 } }),
      ship: shipAt(FAR),
      rocks: [],
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.saucer).toBe(null) // crossed the far edge -> despawned
    expect(out.saucerDebris).toHaveLength(0) // ...but no breakup: despawn ≠ death
  })

  it('spawns no debris on a quiet frame where the saucer lives on', () => {
    const s0 = playing(4242, {
      saucer: saucerAt(CENTER),
      ship: shipAt(FAR),
      rocks: [rockAt(FAR)], // nowhere near the saucer
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.saucer).not.toBe(null) // still alive
    expect(out.saucerDebris).toHaveLength(0)
  })

  it('appends to any still-animating debris from an earlier kill (does not replace it)', () => {
    const prior: ShipDebrisSegment[] = [segment({ life: 1 })]
    const s0 = playing(4242, {
      saucerDebris: prior,
      saucer: saucerAt(CENTER),
      rocks: [rockAt(CENTER)], // a second saucer's death, debris from the first still alive
      ship: shipAt(FAR),
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.saucer).toBe(null)
    expect(out.saucerDebris).toHaveLength(1 + SILHOUETTE_EDGE_COUNT) // 1 aged leftover + 10 fresh
  })
})

// --- stepGame integration: age in EVERY mode pipeline (A2-5's HIGH-bug lesson)

describe('stepGame — saucer debris keeps drifting/fading in every mode (no freeze)', () => {
  const liveSeg = (): ShipDebrisSegment =>
    segment({ p1: { x: 1000, y: 1000 }, p2: { x: 1040, y: 1000 }, vel: { x: 6, y: -3 }, life: 1 })

  it('ages saucer debris on a PLAYING tick (drift + fade)', () => {
    const s0 = playing(4242, { saucerDebris: [liveSeg()], ship: shipAt(FAR), rocks: [] })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.saucerDebris).toHaveLength(1)
    expect(out.saucerDebris[0].life).toBeCloseTo(1 - DT, 9)
    const frames = DT * 60
    expectVec(out.saucerDebris[0].p1, { x: 1000 + 6 * frames, y: 1000 - 3 * frames })
  })

  it('ages saucer debris through the GAME OVER card (would freeze if only playing aged it)', () => {
    const s0: GameState = {
      ...initialState(4242),
      mode: 'gameover',
      gameOver: { qualifies: false, confirmed: false, initials: '', displayTimer: SAUCER_DEBRIS_LIFETIME_S + 10 },
      saucerDebris: [liveSeg()],
    }
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.mode).toBe('gameover') // card still up (long displayTimer)
    expect(out.saucerDebris[0].life).toBeCloseTo(1 - DT, 9)
  })

  it('clears saucer debris within SAUCER_DEBRIS_LIFETIME_S while the GAME OVER card holds', () => {
    let s: GameState = {
      ...initialState(4242),
      mode: 'gameover',
      gameOver: { qualifies: false, confirmed: false, initials: '', displayTimer: SAUCER_DEBRIS_LIFETIME_S + 10 },
      saucerDebris: [segment({ life: SAUCER_DEBRIS_LIFETIME_S })],
    }
    const ticks = Math.ceil(SAUCER_DEBRIS_LIFETIME_S / DT) + 10
    for (let i = 0; i < ticks; i++) s = stepGame(s, NO_INPUT, DT)
    expect(s.mode).toBe('gameover') // still inside the card window
    expect(s.saucerDebris).toHaveLength(0) // fully faded — would sit frozen if gameover stopped aging it
  })

  it('ages saucer debris in ATTRACT (a kill just before a run-ending death can carry over)', () => {
    const s0: GameState = { ...initialState(4242), mode: 'attract', saucerDebris: [liveSeg()] }
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.mode).toBe('attract') // no start pressed
    expect(out.saucerDebris).toHaveLength(1)
    expect(out.saucerDebris[0].life).toBeCloseTo(1 - DT, 9)
    const frames = DT * 60
    expectVec(out.saucerDebris[0].p1, { x: 1000 + 6 * frames, y: 1000 - 3 * frames })
  })

  it('clears saucer debris within SAUCER_DEBRIS_LIFETIME_S while idling in attract', () => {
    let s: GameState = {
      ...initialState(4242),
      mode: 'attract',
      saucerDebris: [segment({ life: SAUCER_DEBRIS_LIFETIME_S })],
    }
    const ticks = Math.ceil(SAUCER_DEBRIS_LIFETIME_S / DT) + 10
    for (let i = 0; i < ticks; i++) s = stepGame(s, NO_INPUT, DT)
    expect(s.mode).toBe('attract')
    expect(s.saucerDebris).toHaveLength(0) // frozen-in-attract wreckage would sit here forever
  })
})

// --- stepGame integration: purely cosmetic (guardrails) --------------------

describe('stepGame — saucer debris is purely cosmetic (no hitbox, no respawn gate)', () => {
  it('does not block respawn — the ship revives at a clear center with debris sitting on it', () => {
    const debrisAtSpawn: ShipDebrisSegment[] = [
      segment({ p1: { ...WORLD_CENTER }, p2: { x: WORLD_CENTER.x + 10, y: WORLD_CENTER.y }, life: 5 }),
    ]
    const s0 = playing(4242, {
      shipDestroyed: true,
      saucerDebris: debrisAtSpawn,
      ship: shipAt(CENTER),
      rocks: [], // clear center — only debris sits at the respawn point
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.shipDestroyed).toBe(false) // respawned despite debris at the exact spawn point
  })

  it('has no hitbox — a player bullet is not consumed by a debris segment in its path', () => {
    const debrisAtCenter: ShipDebrisSegment[] = [
      segment({ p1: { ...CENTER }, p2: { x: CENTER.x + 10, y: CENTER.y }, life: 5 }),
    ]
    const s0 = playing(4242, {
      saucerDebris: debrisAtCenter,
      ship: shipAt(FAR),
      bullets: [bulletAt(CENTER)],
      rocks: [],
      saucer: null,
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.bullets).toHaveLength(1) // survives — debris is not a collidable entity
  })
})
