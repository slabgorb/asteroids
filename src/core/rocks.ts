// src/core/rocks.ts
//
// A-6: asteroid entities — three size tiers, a fixed shape variant, and seeded
// drift around the toroidal playfield. Entity + passive movement ONLY:
// splitting is A-7, collisions A-8, the wave director (spawn timing / counts /
// ship-safe placement) A-10, authentic ROM shape point data A-17.
//
// ROM-confirmed (computerarcheology.com + 6502disassembly.com, independently):
// rocks never turn. There is no facing field and no per-tick visual change —
// rock position updates are pure velocity accumulation ($6FCA-$7013); only the
// ship has ShipDir. `shapeVariant` is fixed visual identity, set once at spawn.
//
// Provisional constants are named + isolated below so A-17's quarry
// verification is a data-only swap, not a refactor.

import type { Rock, RockSize } from './state'
import { wrapPosition, type Bounds } from './bounds'
import { nextFloat, nextInt, type Rng } from './rng'

/** How many distinct rock outlines exist. Leans-confirmed at 4: a GetRandNum
 * read masked %00011000 (two random bits) near rock spawn/update code —
 * verify the exact table vs the reference/ quarry (A-17). */
export const ROCK_SHAPE_VARIANT_COUNT = 4

/** Collision extent per tier, world lo-units — corroborated by two independent
 * sources at 132/72/42; whether that is a box width or a radius-like
 * half-extent is unresolved (consumed by A-8; verify vs quarry in A-17). */
export const ROCK_HITBOX: Readonly<Record<RockSize, number>> = {
  large: 132,
  medium: 72,
  small: 42,
}

/** Drift-speed band per tier, world-units per 60 Hz frame (the Ship.vel /
 * Bullet.vel unit). Feel-based provisional magnitudes — the fetched excerpts
 * located AstXSpeed/AstYSpeed storage but no per-size caps; smaller-is-faster
 * per the cabinet's convention. Verify vs quarry (A-17). */
export const ROCK_SPEED_MIN: Readonly<Record<RockSize, number>> = {
  large: 4,
  medium: 8,
  small: 16,
}
export const ROCK_SPEED_MAX: Readonly<Record<RockSize, number>> = {
  large: 8,
  medium: 16,
  small: 32,
}

/** Spawn one rock: random position inside bounds, random fixed shape variant,
 * and a drift velocity drawn as a random heading with a scalar speed in the
 * tier's band (so the speed is always within [MIN, MAX) by construction).
 * Consumes the passed rng (advances its seed) — deterministic per seed. */
export function spawnRock(rng: Rng, size: RockSize, bounds: Bounds): Rock {
  const pos = { x: nextFloat(rng) * bounds.width, y: nextFloat(rng) * bounds.height }
  const shapeVariant = nextInt(rng, ROCK_SHAPE_VARIANT_COUNT)
  const heading = nextFloat(rng) * 2 * Math.PI
  const speed =
    ROCK_SPEED_MIN[size] + nextFloat(rng) * (ROCK_SPEED_MAX[size] - ROCK_SPEED_MIN[size])
  return {
    pos,
    velocity: { x: Math.cos(heading) * speed, y: Math.sin(heading) * speed },
    size,
    shapeVariant,
  }
}

/** Spawn `count` rocks of one tier. Bare seam for A-10's wave director, which
 * either calls this directly or supersedes it. */
export function spawnRocks(rng: Rng, count: number, size: RockSize, bounds: Bounds): Rock[] {
  const rocks: Rock[] = []
  for (let i = 0; i < count; i++) rocks.push(spawnRock(rng, size, bounds))
  return rocks
}

/** Advance one rock one step: pure translation — pos += velocity * frames
 * (frames = dt*60, the ship/bullet per-frame unit convention) — then the
 * shared toroidal fold. Nothing else changes, deliberately, per the ROM. */
export function updateRock(rock: Rock, dt: number, bounds: Bounds): Rock {
  const frames = dt * 60
  return {
    ...rock,
    pos: wrapPosition(
      { x: rock.pos.x + rock.velocity.x * frames, y: rock.pos.y + rock.velocity.y * frames },
      bounds,
    ),
  }
}

/** Advance every rock. Fresh array, inputs untouched. */
export function updateRocks(rocks: readonly Rock[], dt: number, bounds: Bounds): Rock[] {
  return rocks.map((rock) => updateRock(rock, dt, bounds))
}
