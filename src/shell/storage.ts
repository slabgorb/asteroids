// src/shell/storage.ts
//
// Shell-side persistence seam for the high-score table, backed by localStorage.
// This is IO (shell), not simulation (core): it imports the table TYPES from
// core but the pure core never imports this module. Every failure mode (missing,
// corrupt, unavailable, quota-exceeded storage) degrades gracefully — the game
// keeps playing, scores just don't persist.
//
// Ported near-verbatim from star-wars' src/shell/storage.ts (itself a mirror of
// tempest's) per the A-16 context. The ONE change from a straight copy is the
// key: `asteroids-high-scores` — which is also the lobby contract
// (lobby/src/shell/storage.ts derives `${gameId}-high-scores` from its registry
// entry, so the tile's top score reads this exact key).

import type { HighScoreEntry, HighScoreTable } from '../core/highscore'

const STORAGE_KEY = 'asteroids-high-scores'

// Per-entry validation for a parsed localStorage payload. Array-shape alone is
// not enough: a corrupt-but-array value like `[{}]` or `[{name:9,score:'x'}]`
// would otherwise reach the renderer, which reads entry.name/score/wave. A row is
// well-formed only when its three required fields carry the right TYPES; the
// optional `date` is left untouched (survivors keep it, absentees stay absent).
function isHighScoreEntry(value: unknown): value is HighScoreEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  // Number.isFinite (false for any non-number AND for ±Infinity/NaN): a
  // poisoned `1e999` row would otherwise render "Infinity" on the HUD and
  // permanently win the qualify boundary. The lobby's scoreOf demands finite
  // scores for these same rows — the game's guard holds the same line.
  return (
    typeof entry.name === 'string' &&
    Number.isFinite(entry.score) &&
    Number.isFinite(entry.wave)
  )
}

// Access localStorage defensively: in private-browsing / sandboxed contexts even
// *reading* the global can throw, and outside a browser it is simply absent.
function getStorage(): Storage | null {
  try {
    const ls = globalThis.localStorage
    return ls ?? null
  } catch {
    return null
  }
}

// Load the persisted table. Returns [] for any unhappy path (absent key,
// unavailable storage, corrupt JSON, or JSON that is not a table array), and
// drops any individual entries that are not well-formed (see isHighScoreEntry).
export function loadHighScores(): HighScoreTable {
  const storage = getStorage()
  if (!storage) return []

  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return []
  }
  if (raw === null) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.warn(`[storage] high-score data is not a table array; ignoring`)
      return []
    }
    return parsed.filter(isHighScoreEntry)
  } catch {
    console.warn(`[storage] high-score data is corrupt JSON; ignoring`)
    return []
  }
}

// Persist the table. Swallows write failures (quota exceeded, unavailable
// storage) so a failed save never crashes the game. Takes a `readonly` array —
// it only serialises the table, never mutates it.
export function saveHighScores(table: readonly HighScoreEntry[]): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(table))
  } catch {
    console.warn(`[storage] could not persist high scores (storage full or unavailable)`)
  }
}
