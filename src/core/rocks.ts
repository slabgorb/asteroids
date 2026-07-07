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
import { nextFloat, nextInt, type Rng } from '@arcade/shared/rng'

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

/** A2-6: per-axis random velocity kick (world-units/frame) added INDEPENDENTLY to
 * each child's inherited velocity on split — the ROM's SetAstVel ($7203):
 * `GetRandNum AND #$8F` ⇒ a signed kick of magnitude ≤16 lo-units per axis, added
 * to the parent's AstXSpeed/AstYSpeed, then clamped (GetAstVelocity $7233). This
 * Cartesian per-axis perturbation (NOT a polar heading rotation) is what makes the
 * cabinet's two children fly apart, so momentum is not over-conserved. Port models
 * it symmetric ±this; unit correspondence to ROM lo-units is provisional — verify
 * vs quarry (A-17). */
export const SPLIT_VELOCITY_KICK = 16

/** A-7: per child-tier multiplier applied to the inherited parent speed before
 * re-clamping into the child tier's band (smaller children scale up slightly —
 * the cabinet's "smaller rocks are faster" feel). Indexed by the CHILD tier;
 * children are only ever medium (from large) or small (from medium). Feel-based
 * provisional, not found in the fetches — verify vs quarry (A-17). */
export const SPLIT_SPEED_SCALE: Readonly<Record<RockSize, number>> = {
  large: 1,
  medium: 1.1,
  small: 1.25,
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

/** The tier a rock splits INTO, or null if it despawns: large → medium,
 * medium → small, small → gone ("2 small → gone"). */
const SPLIT_CHILD: Readonly<Record<RockSize, RockSize | null>> = {
  large: 'medium',
  medium: 'small',
  small: null,
}

/** Clamp x into [lo, hi]. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}

/** A-7: split a destroyed rock into its children — large → 2 medium, medium →
 * 2 small, small → [] (gone). The GEOMETRIC half of destruction only: what
 * TRIGGERS a split is A-8 (collision), scoring is A-9. Each child spawns at the
 * parent's exact position (no offset) and takes its DIRECTION from the parent's
 * velocity plus an INDEPENDENT per-axis random kick (ROM SetAstVel $7203), so the
 * two fly apart; its speed is the inherited speed scaled by the child tier's
 * factor and RE-CLAMPED into that tier's band (the provisional speed model, so a
 * fast parent can't hand down an over-speed child, and a near-still parent still
 * yields drifting children); its shape variant is rerolled. Velocity stays in
 * the cabinet's per-60Hz-frame unit, so children drift consistently via updateRock.
 *
 * Pure over the rock (never mutates it). Consumes the passed rng — advances its
 * seed, exactly like spawnRock — so A-8's caller clones state.rng before calling.
 * A small rock draws NO randomness (early return) so despawns never desync spawns. */
export function splitRock(rock: Rock, rng: Rng): Rock[] {
  const childSize = SPLIT_CHILD[rock.size]
  if (childSize === null) return []

  const parentSpeed = Math.hypot(rock.velocity.x, rock.velocity.y)

  const child = (): Rock => {
    // A2-6: ROM SetAstVel ($7203) — child velocity is the parent's plus an
    // INDEPENDENT per-axis random kick (GetRandNum AND #$8F ⇒ ±SPLIT_VELOCITY_KICK).
    // Take the DIRECTION from that Cartesian perturbation (this is what makes the
    // pair fly apart) and keep the provisional per-tier speed magnitude (A-17 owns
    // the speed model). Draw order per child: kick_x, kick_y, shapeVariant.
    const vx = rock.velocity.x + (nextFloat(rng) * 2 - 1) * SPLIT_VELOCITY_KICK
    const vy = rock.velocity.y + (nextFloat(rng) * 2 - 1) * SPLIT_VELOCITY_KICK
    const angle = Math.atan2(vy, vx)
    const speed = clamp(
      parentSpeed * SPLIT_SPEED_SCALE[childSize],
      ROCK_SPEED_MIN[childSize],
      ROCK_SPEED_MAX[childSize],
    )
    const shapeVariant = nextInt(rng, ROCK_SHAPE_VARIANT_COUNT)
    return {
      pos: { x: rock.pos.x, y: rock.pos.y },
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      size: childSize,
      shapeVariant,
    }
  }

  return [child(), child()]
}
