// src/core/highscore.ts
//
// High-score table shape and the two pure table helpers. These live in the PURE
// core so the framing state machine (sim.ts's gameover branch) can depend on
// them without importing shell/. The localStorage persistence seam
// (shell/storage.ts) imports these TYPES — the dependency points shell -> core,
// never the reverse.
//
// Ported near-verbatim from star-wars' src/core/highscore.ts (itself a mirror of
// tempest's) per the A-16 context. No terminology adaptation needed: asteroids
// already calls its level counter `wave` (state.ts, A-2) — the exact field
// star-wars records.

/** Board depth — the classic 10-deep arcade ladder. */
export const MAX_HIGH_SCORES = 10

export interface HighScoreEntry {
  name: string // player initials (3 chars, arcade convention)
  score: number // points
  wave: number // wave reached
  date?: string // optional ISO-8601 timestamp of the entry
}

// Table: entries ordered descending by score (lowest last). Ordering/truncation
// is insertHighScore's concern; the persistence seam stores whatever it is given.
export type HighScoreTable = HighScoreEntry[]

// Precondition: `table` is assumed sorted DESCENDING by score (lowest entry
// last). True when `score` is worth recording. A non-positive score never
// qualifies. While the board has open slots, any positive score makes it; once
// full, the score must STRICTLY beat the lowest entry to displace it (a tie does
// not).
export function qualifiesForHighScore(table: readonly HighScoreEntry[], score: number): boolean {
  if (score <= 0) return false
  if (table.length < MAX_HIGH_SCORES) return true
  const lowest = table[table.length - 1].score
  return score > lowest
}

// Returns a NEW table with `entry` inserted in descending-score order, truncated
// to MAX_HIGH_SCORES. Ties place the new entry AFTER existing equal-score entries
// (existing holders keep the higher rank). The input table is not mutated.
export function insertHighScore(
  table: readonly HighScoreEntry[],
  entry: HighScoreEntry,
): HighScoreTable {
  const out = table.slice()
  let i = out.length
  for (let k = 0; k < out.length; k++) {
    if (out[k].score < entry.score) {
      i = k
      break
    }
  }
  out.splice(i, 0, entry)
  return out.slice(0, MAX_HIGH_SCORES)
}
