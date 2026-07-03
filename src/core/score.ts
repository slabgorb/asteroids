// src/core/score.ts
//
// A-9: scoring + bonus-ship (extra life) rules. Faithful 1979 Asteroids —
// destroying a rock awards points by the destroyed rock's OWN tier (large 20,
// medium 50, small 100); its split children are only scored when they are
// themselves shot. The running score rolls over modulo 100000 (99990 is the
// largest reachable value — the famous Asteroids rollover), and a bonus ship is
// earned on every 10000-point boundary the score crosses, continuing past the
// rollover (one ship per 10000 points earned, forever).
//
// Pure arithmetic — no rng, no I/O — so scoring never perturbs replay
// determinism. sim.ts calls applyScore once per bullet-destroyed rock.

import type { RockSize } from './state'

/** Points awarded for destroying a rock of each tier (ROM-faithful values). */
export const SCORE_VALUES: Readonly<Record<RockSize, number>> = {
  large: 20,
  medium: 50,
  small: 100,
}

/** The score wraps modulo this — it climbs to 99990, then the next award rolls
 * it back toward 0 (the authentic Asteroids score rollover). */
export const SCORE_ROLLOVER = 100000

/** A bonus ship is awarded on each multiple of this that the score crosses. */
export const EXTRA_LIFE_INTERVAL = 10000

/** Award points for one destroyed rock and grant a bonus ship for every
 * 10000-point boundary the award crosses. The boundary check runs on the
 * pre-rollover sum, so bonus ships keep coming across the 99990 wrap. A single
 * rock award (≤100) can cross at most one boundary. Pure — never mutates. */
export function applyScore(
  score: number,
  lives: number,
  size: RockSize,
): { score: number; lives: number } {
  const sum = score + SCORE_VALUES[size]
  const earned = Math.floor(sum / EXTRA_LIFE_INTERVAL) - Math.floor(score / EXTRA_LIFE_INTERVAL)
  return { score: sum % SCORE_ROLLOVER, lives: lives + earned }
}

/** Format a score as the cabinet's 6-digit zero-padded (BCD-style) display
 * string: 0 → "000000", 20 → "000020", 99990 → "099990". */
export function formatScore(score: number): string {
  return score.toString().padStart(6, '0')
}
