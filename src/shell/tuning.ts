// src/shell/tuning.ts
//
// A-20: live rotation tuning for the dev-only ?tune slider panel. Kept OUT of
// the pure core — the shell owns mutable, device-facing state. `turnRate` is
// injected into stepGame each frame (default = the ROM SHIP_ROTATION_RATE, so
// the un-tuned game is byte-identical); `tapHoldDelayFrames` is read by the
// input controller to split a keyboard tap from a hold.
//
// Persistence mirrors storage.ts: defensive localStorage that degrades to
// defaults on every unhappy path (absent / corrupt / unavailable storage).

import { SHIP_ROTATION_RATE } from '../core/ship'

export interface RotationTuning {
  /** Continuous rotation, direction-units per 60 Hz frame. ROM value = 3. */
  turnRate: number
  /** Sim-frames a rotate key must be held before continuous spin engages; a
   * release on or before this many frames reads as a single-step tap. */
  tapHoldDelayFrames: number
}

export const DEFAULT_TUNING: Readonly<RotationTuning> = {
  turnRate: SHIP_ROTATION_RATE,
  // Playtested default (A-20): 3 frames ≈ 50 ms — a quick tap still lands a
  // single ROM nudge, while a held key settles into continuous spin almost
  // immediately. Live-adjustable via the ?tune panel.
  tapHoldDelayFrames: 3,
}

export function createTuning(overrides?: Partial<RotationTuning>): RotationTuning {
  return { ...DEFAULT_TUNING, ...overrides }
}

const STORAGE_KEY = 'asteroids-tuning'

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function loadTuning(): Partial<RotationTuning> {
  const storage = getStorage()
  if (!storage) return {}

  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return {}
  }
  if (raw === null) return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const p = parsed as Record<string, unknown>
    const out: Partial<RotationTuning> = {}
    if (Number.isFinite(p.turnRate)) out.turnRate = p.turnRate as number
    if (Number.isFinite(p.tapHoldDelayFrames)) out.tapHoldDelayFrames = p.tapHoldDelayFrames as number
    return out
  } catch {
    return {}
  }
}

export function saveTuning(tuning: RotationTuning): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ turnRate: tuning.turnRate, tapHoldDelayFrames: tuning.tapHoldDelayFrames }),
    )
  } catch {
    // Dev tuning is best-effort; a failed persist never disrupts play.
  }
}
