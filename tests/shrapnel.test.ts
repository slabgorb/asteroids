// tests/shrapnel.test.ts
//
// A2-8: subtle debris particles on every rock break — a dim, short-lived scatter
// of dots at the impact point of every destroyed asteroid. This is the ROM's
// SHRAPNEL system (DrawObjectExplode $7349 -> ShrapPatPtrTbl $50F8), distinct
// from the ship-explosion line fragments A2-5 already ported (core/shipDebris.ts).
//
// No ACs existed in the sprint YAML — only the title (session Sm Assessment) and
// the Architect's ROM quarry (sprint/context/context-story-A2-8.md, memory
// `asteroids-a2-8-shrapnel-quarry`). The ACs pinned below are TEA's, established
// against the title + that quarry:
//
//   AC-1  EVERY rock break (large, medium, AND small — including the small tier
//         that despawns with no children) spawns a scatter of debris dots.
//   AC-2  The scatter is ANCHORED at the impact point — it does NOT inherit the
//         destroyed rock's velocity (contrast shipDebris, which carries ship.vel),
//         so the burst stays local instead of sailing across the field. ROM: the
//         shrapnel object is stationary (DoExplodeObj $6F64 skips UpdateObjPos);
//         only its render SCALE grows.
//   AC-3  The dots SCATTER and expand outward from that point (a burst of several
//         distinct dots, not a single point; the cloud spreads over its life).
//   AC-4  SHORT-LIVED + fades: each dot counts down to removal over a lifetime
//         much shorter than the ship's breakup (ROM ~20 frames ~= 0.33s vs A2-5's
//         1.5s), and the whole scatter is gone by SHRAPNEL_LIFETIME_S.
//   AC-5  DETERMINISTIC / RNG-FREE: spawning shrapnel consumes NO randomness (the
//         ROM patterns are fixed data), so a rock break advances state.rng EXACTLY
//         as splitRock alone would — it must not perturb the wave/saucer spawn
//         stream (the A2-6 determinism lesson: extra draws shift wave spawns).
//   AC-6  PURELY COSMETIC: no hitbox (a bullet passes through) and never gates
//         respawn (mirrors shipDebris's guardrails).
//   AC-7  Keeps fading across modes: a scatter still animating when the run ends
//         must keep aging through game-over and into attract, never freeze (the
//         A2-5 Reviewer-HIGH cross-mode-aging lesson, applied to shrapnel).
//   AC-8  Rendered: the renderer reads state.shrapnel and draws the dots (pinned
//         in render-wiring.test.ts; the exact "dim" brightness is a render-fidelity
//         / playtest knob, eyeball-verified per the house convention, not unit-pinned).
//
// MODELING NOTE (logged as a TEA Design Deviation): the ROM expands a fixed-anchor
// shrapnel PATTERN by a growing render SCALE. This port models the expansion as a
// symmetric per-dot outward VELOCITY (each dot starts at the impact point and
// drifts out, the net drift staying far below the per-dot spread speed so the
// CENTROID stays anchored) — a core-testable equivalent that reuses shipDebris.ts's
// proven pos/vel/life particle structure and yields the same visual (an anchored,
// spreading, fading dot cloud). These tests pin that CONTRACT, not the ROM's exact
// scale-step formula; a future ROM-exact scale port can replace the velocity model
// without touching the spawn/age/fade contract.
//
// RED until core/shrapnel.ts exists, GameState grows `shrapnel`, sim.ts spawns it
// on every rock-break edge and ages it in every mode, and render.ts draws it.

import { describe, it, expect } from 'vitest'
import {
  spawnShrapnel,
  updateShrapnel,
  SHRAPNEL_LIFETIME_S,
} from '../src/core/shrapnel'
import { DEBRIS_LIFETIME_S } from '../src/core/shipDebris'
import {
  initialState,
  WORLD_W,
  WORLD_H,
  type GameState,
  type Ship,
  type Shrapnel,
  type Rock,
  type RockSize,
  type Bullet,
  type Vec2,
} from '../src/core/state'
import { splitRock } from '../src/core/rocks'
import { stepGame, GAME_OVER_DISPLAY_S } from '../src/core/sim'
import { NO_INPUT } from '../src/core/input'

const DT = 1 / 60

/** Assert two positions are equal component-wise (tolerant of float dust) — the
 * rocks.test.ts / shipDebris.test.ts expectVec convention. */
function expectVec(actual: Vec2, expected: Vec2, precision = 6): void {
  expect(actual.x).toBeCloseTo(expected.x, precision)
  expect(actual.y).toBeCloseTo(expected.y, precision)
}

function shipAt(pos: Vec2, over: Partial<Ship> = {}): Ship {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, dir: 64, visible: true, ...over }
}

function rockAt(pos: Vec2, size: RockSize = 'large'): Rock {
  return { pos: { ...pos }, velocity: { x: 0, y: 0 }, size, shapeVariant: 0 }
}

function bulletAt(pos: Vec2): Bullet {
  return { pos: { ...pos }, vel: { x: 0, y: 0 }, life: 60, owner: 'player' }
}

function particle(over: Partial<Shrapnel> = {}): Shrapnel {
  return { pos: { x: 0, y: 0 }, vel: { x: 5, y: 0 }, life: SHRAPNEL_LIFETIME_S, ...over }
}

/** Centroid of a dot cloud. */
function centroid(dots: readonly Shrapnel[]): Vec2 {
  const n = dots.length
  return {
    x: dots.reduce((s, d) => s + d.pos.x, 0) / n,
    y: dots.reduce((s, d) => s + d.pos.y, 0) / n,
  }
}

/** Max distance of any dot from a reference point — the cloud's spatial extent. */
function extentFrom(dots: readonly Shrapnel[], ref: Vec2): number {
  return Math.max(...dots.map((d) => Math.hypot(d.pos.x - ref.x, d.pos.y - ref.y)))
}

// ----------------------------------------------------------------------------
// spawnShrapnel — a scatter of dots at the impact point (RNG-FREE)
// ----------------------------------------------------------------------------

const IMPACT: Vec2 = { x: 3000, y: 2500 }

describe('spawnShrapnel — a scatter of dots at the impact point', () => {
  it('returns several dots (a scatter, not a single point) — ROM shrapnel is ~10-11 dots', () => {
    // A floor that reads as a burst, not the exact ROM count (a render-fidelity knob).
    expect(spawnShrapnel(IMPACT).length).toBeGreaterThanOrEqual(6)
  })

  it('every dot originates AT the impact point (the burst starts where the rock died)', () => {
    for (const dot of spawnShrapnel(IMPACT)) {
      expectVec(dot.pos, IMPACT)
    }
  })

  it('takes ONLY a position — no rng — and is deterministic (same point -> deeply-equal dots)', () => {
    // The signature carries no Rng, so it structurally cannot consume randomness
    // (AC-5). Deep equality across two independent calls proves there is no hidden
    // state / Math.random reached into either.
    expect(spawnShrapnel(IMPACT)).toEqual(spawnShrapnel(IMPACT))
  })

  it('is translation-covariant — the same fixed pattern, re-centred on the impact point', () => {
    // Different impact -> the SAME relative scatter, just moved. Guards against a
    // hardcoded absolute pattern that ignores where the rock actually died.
    const a = spawnShrapnel({ x: 0, y: 0 })
    const b = spawnShrapnel({ x: 1000, y: -500 })
    expect(b.length).toBe(a.length)
    for (let i = 0; i < a.length; i++) {
      expectVec(
        { x: b[i].vel.x, y: b[i].vel.y },
        { x: a[i].vel.x, y: a[i].vel.y },
      )
    }
  })

  it('gives the dots DISTINCT velocities (a real scatter of directions, not one puff)', () => {
    const dots = spawnShrapnel(IMPACT)
    const distinct = new Set(dots.map((d) => `${d.vel.x.toFixed(6)},${d.vel.y.toFixed(6)}`))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('every dot has a nonzero velocity (each one actually spreads)', () => {
    for (const dot of spawnShrapnel(IMPACT)) {
      expect(Math.hypot(dot.vel.x, dot.vel.y)).toBeGreaterThan(0)
    }
  })

  it('is ANCHORED, not a jet — net drift stays well below the per-dot spread speed', () => {
    // A unidirectional puff (all dots same velocity) would sail across the field
    // like a rock; a balanced radial scatter stays centred on the impact point and
    // only EXPANDS. Pin: |mean velocity| < half the mean per-dot speed.
    const dots = spawnShrapnel(IMPACT)
    const mean = { x: dots.reduce((s, d) => s + d.vel.x, 0) / dots.length, y: dots.reduce((s, d) => s + d.vel.y, 0) / dots.length }
    const avgSpeed = dots.reduce((s, d) => s + Math.hypot(d.vel.x, d.vel.y), 0) / dots.length
    expect(Math.hypot(mean.x, mean.y)).toBeLessThan(avgSpeed * 0.5)
  })

  it('starts every dot with exactly SHRAPNEL_LIFETIME_S of life (spawn uses the constant, no hardcode)', () => {
    // Mirrors shipDebris.test.ts's Reviewer-hardened pin: > 0 is too weak — a
    // mutant spawning a different life would pass. Pin the exact constant.
    for (const dot of spawnShrapnel(IMPACT)) {
      expect(dot.life).toBe(SHRAPNEL_LIFETIME_S)
    }
  })

  it('exposes exactly {life, pos, vel} on each dot — a POINT, not a p1/p2 segment (unlike shipDebris)', () => {
    for (const dot of spawnShrapnel(IMPACT)) {
      expect(Object.keys(dot).sort()).toEqual(['life', 'pos', 'vel'])
    }
  })

  it('returns fresh, distinct dot + point objects (no aliasing across dots)', () => {
    const [a, b] = spawnShrapnel(IMPACT)
    expect(a).not.toBe(b)
    expect(a.pos).not.toBe(b.pos)
    expect(a.vel).not.toBe(b.vel)
  })

  it('does not mutate the input point', () => {
    const point = { x: 500, y: 600 }
    const snapshot = structuredClone(point)
    spawnShrapnel(point)
    expect(point).toEqual(snapshot)
  })
})

// ----------------------------------------------------------------------------
// SHRAPNEL_LIFETIME_S — short-lived (shorter than the ship breakup)
// ----------------------------------------------------------------------------

describe('SHRAPNEL_LIFETIME_S — short-lived', () => {
  it('is positive', () => {
    expect(SHRAPNEL_LIFETIME_S).toBeGreaterThan(0)
  })

  it('is brief — at most ~half a second (ROM shrapnel timer ~= 0.33s)', () => {
    expect(SHRAPNEL_LIFETIME_S).toBeLessThanOrEqual(0.5)
  })

  it('is SHORTER than the ship breakup debris (A2-5, 1.5s) — shrapnel is a quick flicker, not a lingering wreck', () => {
    expect(SHRAPNEL_LIFETIME_S).toBeLessThan(DEBRIS_LIFETIME_S)
  })
})

// ----------------------------------------------------------------------------
// updateShrapnel — expands outward, then fades
// ----------------------------------------------------------------------------

describe('updateShrapnel — the dots spread outward (expansion)', () => {
  it('translates each dot by vel * frames (the rocks.ts/bullet.ts per-frame convention)', () => {
    const dot = particle({ pos: { x: 100, y: 100 }, vel: { x: 6, y: -3 }, life: SHRAPNEL_LIFETIME_S })
    const [out] = updateShrapnel([dot], DT)
    const frames = DT * 60
    expectVec(out.pos, { x: 100 + 6 * frames, y: 100 - 3 * frames })
  })

  it('does not move a dot at dt = 0', () => {
    const dot = particle({ pos: { x: 50, y: 50 } })
    const [out] = updateShrapnel([dot], 0)
    expectVec(out.pos, { x: 50, y: 50 })
  })

  it('scales displacement with dt (half dt -> half the step)', () => {
    const dot = particle({ pos: { x: 100, y: 100 }, vel: { x: 6, y: -3 } })
    const [out] = updateShrapnel([dot], DT / 2)
    const frames = (DT / 2) * 60
    expectVec(out.pos, { x: 100 + 6 * frames, y: 100 - 3 * frames })
  })

  it('preserves velocity each tick (straight flight, no drag)', () => {
    const dot = particle({ vel: { x: 6, y: -3 } })
    const [out] = updateShrapnel([dot], DT)
    expectVec(out.vel, { x: 6, y: -3 })
  })

  it('grows the cloud extent — a fresh burst (all at the impact point) spreads after one step', () => {
    const dots = spawnShrapnel(IMPACT)
    expect(extentFrom(dots, IMPACT)).toBeCloseTo(0, 6) // all start at the impact point
    const stepped = updateShrapnel(dots, DT)
    expect(extentFrom(stepped, IMPACT)).toBeGreaterThan(0) // ...and have spread out
  })

  it('keeps the burst anchored — the centroid barely moves while the cloud expands', () => {
    // The dots spread, but the balanced scatter keeps the centre near the impact
    // point (contrast a rock, which would translate ~4+ units/frame and drift off).
    const dots = spawnShrapnel(IMPACT)
    let cloud = dots
    for (let i = 0; i < 10; i++) cloud = updateShrapnel(cloud, DT)
    const c = centroid(cloud)
    // 10 frames of a drifting rock (>= ROCK speed 4/frame) would be >= 40 units off;
    // the anchored burst's centroid stays within a rock's own hitbox of the impact.
    expect(Math.hypot(c.x - IMPACT.x, c.y - IMPACT.y)).toBeLessThan(132)
  })
})

describe('updateShrapnel — life counts down and expired dots vanish', () => {
  it('decrements life by dt each call', () => {
    const dot = particle({ life: 0.3 })
    const [out] = updateShrapnel([dot], DT)
    expect(out.life).toBeCloseTo(0.3 - DT, 9)
  })

  it('removes a dot once its life reaches zero', () => {
    expect(updateShrapnel([particle({ life: DT })], DT)).toHaveLength(0)
  })

  it('removes a dot whose life has already run out (negative)', () => {
    expect(updateShrapnel([particle({ life: -0.001 })], DT)).toHaveLength(0)
  })

  it('keeps a dot with life remaining after decrement', () => {
    expect(updateShrapnel([particle({ life: 0.3 })], DT)).toHaveLength(1)
  })

  it('ages dots independently — one expiring does not affect another', () => {
    const dying = particle({ pos: { x: 0, y: 0 }, life: DT })
    const surviving = particle({ pos: { x: 500, y: 500 }, vel: { x: 1, y: 0 }, life: 0.3 })
    const out = updateShrapnel([dying, surviving], DT)
    expect(out).toHaveLength(1)
    expectVec(out[0].pos, { x: 500 + 1 * DT * 60, y: 500 })
  })

  it('returns an empty array when given no dots', () => {
    expect(updateShrapnel([], DT)).toEqual([])
  })

  it('does NOT wrap at the world boundary (unlike rocks) — a dot past the edge keeps going', () => {
    const dot = particle({ pos: { x: WORLD_W - 2, y: 100 }, vel: { x: 5, y: 0 } })
    const [out] = updateShrapnel([dot], DT)
    expect(out.pos.x).toBeGreaterThan(WORLD_W) // (WORLD_W - 2) + 5 — past the edge, not folded to ~3
  })
})

describe('updateShrapnel — purity / immutable return', () => {
  it('does not mutate the input dots', () => {
    const dot = particle({ life: 0.3 })
    const snapshot = structuredClone(dot)
    updateShrapnel([dot], DT)
    expect(dot).toEqual(snapshot)
  })

  it('returns fresh dot + point objects, not the input references', () => {
    const dot = particle({ life: 0.3 })
    const [out] = updateShrapnel([dot], DT)
    expect(out).not.toBe(dot)
    expect(out.pos).not.toBe(dot.pos)
  })
})

// ----------------------------------------------------------------------------
// stepGame integration — spawns shrapnel on EVERY rock break
// ----------------------------------------------------------------------------

function playing(seed: number, over: Partial<GameState> = {}): GameState {
  return { ...initialState(seed), mode: 'playing', lives: 3, shrapnel: [], ...over }
}

// Clear of the default ship spawn ({WORLD_W/2, WORLD_H/2}) — the collision.test.ts
// CENTER convention, so a rock fixture never trips an unintended ship ram.
const CENTER: Vec2 = { x: 2000, y: 2000 }
const FAR: Vec2 = { x: 6000, y: 5000 }
const WORLD_CENTER: Vec2 = { x: WORLD_W / 2, y: WORLD_H / 2 }

describe('stepGame — spawns shrapnel on every rock break', () => {
  it('a fresh game starts with no shrapnel', () => {
    expect(initialState(1).shrapnel).toEqual([])
  })

  for (const size of ['large', 'medium', 'small'] as const) {
    it(`a player shot destroying a ${size} rock spawns a scatter of shrapnel at the break point`, () => {
      const s0 = playing(4242, {
        ship: shipAt(FAR),
        rocks: [rockAt(CENTER, size)],
        bullets: [bulletAt(CENTER)],
      })
      const out = stepGame(s0, NO_INPUT, DT)
      expect(out.shrapnel.length).toBeGreaterThanOrEqual(6)
      // anchored at the destroyed rock's position (the fresh burst is not aged the
      // spawn tick, mirroring shipDebris's append-after-age — so dots sit at IMPACT)
      for (const dot of out.shrapnel) expectVec(dot.pos, CENTER)
    })
  }

  it('the small tier — which despawns with NO children — still gets debris (the crux of "every rock break")', () => {
    const s0 = playing(4242, { ship: shipAt(FAR), rocks: [rockAt(CENTER, 'small')], bullets: [bulletAt(CENTER)] })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.rocks).toHaveLength(0) // the small rock is gone (no split children)
    expect(out.shrapnel.length).toBeGreaterThanOrEqual(6) // ...and it still scattered debris
  })

  it('a shot that hits nothing spawns no shrapnel', () => {
    const s0 = playing(4242, { ship: shipAt(FAR), rocks: [rockAt(CENTER)], bullets: [bulletAt({ x: 500, y: 500 })] })
    expect(stepGame(s0, NO_INPUT, DT).shrapnel).toHaveLength(0)
  })

  it('a quiet tick with no shots and no breaks spawns no shrapnel', () => {
    const s0 = playing(4242, { ship: shipAt(FAR), rocks: [rockAt(CENTER)], bullets: [] })
    expect(stepGame(s0, NO_INPUT, DT).shrapnel).toHaveLength(0)
  })
})

describe('stepGame — shrapnel is RNG-FREE (must not perturb the spawn stream)', () => {
  it('destroying a SMALL rock leaves the rng seed UNCHANGED (splitRock draws 0; shrapnel must add 0)', () => {
    // A small rock's splitRock returns [] with zero draws (rocks.ts). With a second
    // rock surviving (field not clear -> no wave spawn) and no saucer (spawn director
    // rests -> no draw), splitRock is the ONLY possible rng consumer this step — so a
    // changed seed could only be shrapnel reaching for randomness. It must not.
    const s0 = playing(4242, {
      ship: shipAt(FAR),
      rocks: [rockAt(CENTER, 'small'), rockAt({ x: 7000, y: 5500 }, 'large')],
      bullets: [bulletAt(CENTER)],
      saucer: null,
      saucerSpawnTimer: 999,
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.shrapnel.length).toBeGreaterThanOrEqual(6) // shrapnel really did spawn...
    expect(out.rocks.some((r) => r.size === 'large')).toBe(true) // ...the large rock survived (no wave respawn)
    expect(out.rng.seed).toBe(s0.rng.seed) // ...and the rng stream is untouched
  })

  it('destroying a LARGE rock advances the rng EXACTLY as splitRock alone would (shrapnel adds no draws)', () => {
    // Mirrors shipDebris.test.ts's RNG-clone discipline: reproduce the sole rng
    // consumer (splitRock on the destroyed rock) from an independent clone of the
    // same seed and assert the post-step seed lands there. If shrapnel drew even one
    // number, the seeds would diverge.
    const destroyed = rockAt(CENTER, 'large')
    const s0 = playing(4242, {
      ship: shipAt(FAR),
      rocks: [{ ...destroyed }],
      bullets: [bulletAt(CENTER)],
      saucer: null,
      saucerSpawnTimer: 999,
    })
    const out = stepGame(s0, NO_INPUT, DT)
    const clone = { seed: s0.rng.seed }
    splitRock(destroyed, clone) // the same 6 draws (kick_x, kick_y, variant) x2 children
    expect(out.shrapnel.length).toBeGreaterThanOrEqual(6)
    expect(out.rng.seed).toBe(clone.seed)
  })
})

describe('stepGame — shrapnel accumulates then ages (edge-triggered, additive)', () => {
  it('appends a fresh scatter to shrapnel still animating from an earlier break', () => {
    const priorDots: Shrapnel[] = [particle({ pos: { x: 500, y: 500 }, vel: { x: 1, y: 0 }, life: 0.2 })]
    const s0 = playing(4242, {
      ship: shipAt(FAR),
      shrapnel: priorDots,
      rocks: [rockAt(CENTER, 'small')],
      bullets: [bulletAt(CENTER)],
    })
    const out = stepGame(s0, NO_INPUT, DT)
    // the 1 pre-existing (aged, still alive) dot + the fresh scatter — not a replace
    expect(out.shrapnel.length).toBeGreaterThanOrEqual(1 + 6)
  })

  it('ages existing shrapnel every playing tick even when nothing breaks (fades on its own)', () => {
    const s0 = playing(4242, {
      ship: shipAt(FAR),
      shrapnel: [particle({ pos: { x: 1000, y: 1000 }, vel: { x: 6, y: -3 }, life: 0.2 })],
      rocks: [rockAt(FAR)], // far from the ship; no break this tick
      bullets: [],
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.shrapnel).toHaveLength(1)
    expect(out.shrapnel[0].life).toBeCloseTo(0.2 - DT, 9)
    const frames = DT * 60
    expectVec(out.shrapnel[0].pos, { x: 1000 + 6 * frames, y: 1000 - 3 * frames })
  })
})

// ----------------------------------------------------------------------------
// Cross-mode aging — the A2-5 Reviewer-HIGH lesson, applied to shrapnel.
// A run-ending death can leave a scatter still animating; it must keep fading
// through game-over and attract, never freeze.
// ----------------------------------------------------------------------------

describe('stepGame — shrapnel keeps fading across modes (never freezes)', () => {
  it('ages a live scatter on a single GAME-OVER tick', () => {
    const dot = particle({ pos: { x: 2000, y: 2000 }, vel: { x: 4, y: 0 }, life: 0.2 })
    const s0: GameState = {
      ...initialState(4242),
      mode: 'gameover',
      gameOver: { qualifies: false, confirmed: false, initials: '', displayTimer: GAME_OVER_DISPLAY_S },
      shrapnel: [dot],
    }
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.mode).toBe('gameover')
    expect(out.shrapnel[0].life).toBeCloseTo(0.2 - DT, 9) // faded
    const frames = DT * 60
    expectVec(out.shrapnel[0].pos, { x: 2000 + 4 * frames, y: 2000 }) // ...and still drifting
  })

  it('ages a live scatter on a single ATTRACT tick', () => {
    const dot = particle({ pos: { x: 1000, y: 1000 }, vel: { x: 6, y: -3 }, life: 0.2 })
    const s0: GameState = { ...initialState(4242), mode: 'attract', shrapnel: [dot] }
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.mode).toBe('attract')
    expect(out.shrapnel[0].life).toBeCloseTo(0.2 - DT, 9)
    const frames = DT * 60
    expectVec(out.shrapnel[0].pos, { x: 1000 + 6 * frames, y: 1000 - 3 * frames })
  })

  it('clears shrapnel within SHRAPNEL_LIFETIME_S while idling in attract (frozen wreckage would sit forever)', () => {
    let s: GameState = {
      ...initialState(4242),
      mode: 'attract',
      shrapnel: [particle({ pos: { x: 1000, y: 1000 }, life: SHRAPNEL_LIFETIME_S })],
    }
    const ticks = Math.ceil(SHRAPNEL_LIFETIME_S / DT) + 5
    for (let i = 0; i < ticks; i++) s = stepGame(s, NO_INPUT, DT)
    expect(s.mode).toBe('attract')
    expect(s.shrapnel).toHaveLength(0)
  })
})

// ----------------------------------------------------------------------------
// Purely cosmetic — no hitbox, never gates respawn (mirrors shipDebris guardrails)
// ----------------------------------------------------------------------------

describe('stepGame — shrapnel is purely cosmetic', () => {
  it('has no hitbox — a player bullet passes straight through a shrapnel dot', () => {
    const s0 = playing(4242, {
      ship: shipAt(FAR),
      shrapnel: [particle({ pos: { ...CENTER }, vel: { x: 0, y: 0 }, life: 0.3 })],
      bullets: [bulletAt(CENTER)],
      rocks: [], // nothing but a shrapnel dot sits at the bullet's position
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.bullets).toHaveLength(1) // survives — shrapnel is not a collidable entity
  })

  it('does not block or alter respawn — the ship still revives at a clear centre with shrapnel present', () => {
    const s0 = playing(4242, {
      shipDestroyed: true,
      shrapnel: [particle({ pos: { ...WORLD_CENTER }, vel: { x: 0, y: 0 }, life: 0.3 })],
      ship: shipAt(CENTER),
      rocks: [], // clear centre — only a shrapnel dot sits at the respawn point
    })
    const out = stepGame(s0, NO_INPUT, DT)
    expect(out.shipDestroyed).toBe(false) // respawned despite shrapnel at the exact spawn point
  })
})
