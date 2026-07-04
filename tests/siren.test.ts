// tests/siren.test.ts
//
// A-13: the SIREN STATE HOOK. The arcade Asteroids siren famously shifts pitch
// depending on which saucer size is on screen. A-18 owns all sound synthesis;
// this story's only job is to make "which saucer is alive right now" observable
// as a PURE derived value A-18 can poll or diff each tick. Zero audio here.
//
//   sirenState(state) → 'large' while a large saucer is alive
//                     → 'small' while a small saucer is alive
//                     → null    when no saucer is alive
//
// It is a pure function of state.saucer — no timers, no wall-clock, no audio.
//
// RED until saucer.ts exports `sirenState`. The core/-purity scan below extends
// A-2's banned-globals guard (tests/core-boundary.test.ts) with an AUDIO ban:
// the siren's timing hook must not smuggle any Web Audio surface into core/.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initialState, type GameState, type Saucer, type SaucerSize, type Vec2 } from '../src/core/state'
import { sirenState } from '../src/core/saucer'

/** A motionless saucer at `pos` (timer fields parked; sirenState reads only
 * `size`, but a full literal keeps the fixture honest against the real type). */
function saucerAt(pos: Vec2, size: SaucerSize): Saucer {
  return { pos: { ...pos }, velocity: { x: 0, y: 0 }, size, courseTimer: 999, fireTimer: 999 }
}

const AT: Vec2 = { x: 2000, y: 2000 }

/** A playing-mode state overlaid with the saucer under test. */
function playing(over: Partial<GameState> = {}): GameState {
  return { ...initialState(4242), mode: 'playing', ...over }
}

describe('sirenState — which saucer is alive, as a pure value (AC-6)', () => {
  it('returns null when no saucer is alive', () => {
    expect(sirenState(playing({ saucer: null }))).toBeNull()
  })

  it('returns null on a fresh boot state (attract, no saucer)', () => {
    expect(sirenState(initialState())).toBeNull()
  })

  it("returns 'large' while a large saucer is alive", () => {
    expect(sirenState(playing({ saucer: saucerAt(AT, 'large') }))).toBe('large')
  })

  it("returns 'small' while a small saucer is alive", () => {
    expect(sirenState(playing({ saucer: saucerAt(AT, 'small') }))).toBe('small')
  })

  it('is pure — it does not mutate the state it inspects', () => {
    const s = playing({ saucer: saucerAt(AT, 'small') })
    const snapshot = structuredClone(s)
    sirenState(s)
    expect(s).toEqual(snapshot)
  })
})

// ── core/ purity: no Web Audio surface (AC-6 source scan) ────────────────────
// Extends A-2's banned-globals guard pattern. A-18 owns sound; core/ must stay
// audio-free even though this story introduces the siren TIMING hook.
const CORE_DIR = fileURLToPath(new URL('../src/core/', import.meta.url))

// Match Web Audio references as constructor/identifier uses.
const BANNED_AUDIO: ReadonlyArray<readonly [string, RegExp]> = [
  ['AudioContext', /\bAudioContext\b/],
  ['webkitAudioContext', /\bwebkitAudioContext\b/],
  ['new Audio()', /\bnew\s+Audio\s*\(/],
  ['navigator.mediaDevices', /\bnavigator\s*\.\s*mediaDevices\b/],
]

function collectCoreTsFiles(): string[] {
  if (!existsSync(CORE_DIR)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = dir + name
      if (statSync(full).isDirectory()) {
        walk(full + '/')
      } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
        out.push(full)
      }
    }
  }
  walk(CORE_DIR)
  return out
}

describe('core/ audio-purity guard (AC-6)', () => {
  it('never references any Web Audio surface anywhere in core/', () => {
    const files = collectCoreTsFiles()
    expect(files.length, 'expected at least one core .ts file to scan').toBeGreaterThan(0)
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const [name, pattern] of BANNED_AUDIO) {
        expect(pattern.test(src), `${file} must not reference ${name} — A-18 owns audio, not core/`).toBe(false)
      }
    }
  })
})
