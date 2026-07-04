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

import type { RockSize, SaucerSize } from './state'

/** Points awarded for destroying a rock of each tier (ROM-faithful values). */
export const SCORE_VALUES: Readonly<Record<RockSize, number>> = {
  large: 20,
  medium: 50,
  small: 100,
}

/** Points awarded for destroying a saucer, by size (A-13). Large is the one
 * uncontested value — the epic, both disassembly fetches, and a corroborating
 * web search all read 200. SMALL is a live CONFLICT: the epic + this story's
 * title say 1000, but three independent research reads (both disassembly fetches
 * + a web search) read the ROM byte as $99 BCD → 990. Following spec authority
 * (story scope > research pass) this ships the story's stated 1000, but the
 * number is FLAGGED for A-17 to settle against the actual quarry bytes — hence
 * A-13's tests assert against THIS exported constant, never a literal, so a
 * later correction to 990 can't silently drift the two stories apart.
 * verify vs quarry (A-17). */
export const SAUCER_SCORE_LARGE = 200
export const SAUCER_SCORE_SMALL = 1000

/** Saucer point values keyed by size — the single lookup sim.ts scores a kill
 * from, so the 200/1000 decision lives in exactly one place. */
export const SAUCER_SCORE: Readonly<Record<SaucerSize, number>> = {
  large: SAUCER_SCORE_LARGE,
  small: SAUCER_SCORE_SMALL,
}

/** The score wraps modulo this — it climbs to 99990, then the next award rolls
 * it back toward 0 (the authentic Asteroids score rollover). */
export const SCORE_ROLLOVER = 100000

/** A bonus ship is awarded on each multiple of this that the score crosses. */
export const EXTRA_LIFE_INTERVAL = 10000

/** Award an arbitrary point value: roll the score over at SCORE_ROLLOVER and
 * grant a bonus ship for every 10000-point boundary the award crosses. The
 * boundary count runs on the pre-rollover sum, so bonus ships keep coming across
 * the 99990 wrap. The single canonical scoring entry point — rocks (applyScore)
 * and saucers (A-13) both route through here so extra-life and rollover rules are
 * decided in exactly one place. Pure — never mutates. */
export function addScore(
  score: number,
  lives: number,
  points: number,
): { score: number; lives: number } {
  const sum = score + points
  const earned = Math.floor(sum / EXTRA_LIFE_INTERVAL) - Math.floor(score / EXTRA_LIFE_INTERVAL)
  return { score: sum % SCORE_ROLLOVER, lives: lives + earned }
}

/** Award points for one destroyed rock (by the rock's own tier) via addScore. */
export function applyScore(
  score: number,
  lives: number,
  size: RockSize,
): { score: number; lives: number } {
  return addScore(score, lives, SCORE_VALUES[size])
}

/** Format a score as the cabinet's 6-digit zero-padded (BCD-style) display
 * string: 0 → "000000", 20 → "000020", 99990 → "099990". */
export function formatScore(score: number): string {
  return score.toString().padStart(6, '0')
}
