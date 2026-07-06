// tests/tuning.test.ts
//
// A-20: live rotation-tuning config for the dev slider panel. Persistence is a
// defensive localStorage seam (mirrors storage.ts): every unhappy path degrades
// to defaults so a corrupt/absent/unavailable store never breaks boot.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEFAULT_TUNING, createTuning, loadTuning, saveTuning } from '../src/shell/tuning'
import { SHIP_ROTATION_RATE } from '../src/core/ship'

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('DEFAULT_TUNING / createTuning', () => {
  it('defaults turnRate to the ROM rate and a positive tap/hold delay', () => {
    expect(DEFAULT_TUNING.turnRate).toBe(SHIP_ROTATION_RATE)
    expect(DEFAULT_TUNING.tapHoldDelayFrames).toBeGreaterThan(0)
    expect(Number.isInteger(DEFAULT_TUNING.tapHoldDelayFrames)).toBe(true)
  })

  it('createTuning() returns the defaults as a fresh, mutable object', () => {
    const t = createTuning()
    expect(t).toEqual({ ...DEFAULT_TUNING })
    t.turnRate = 99
    expect(DEFAULT_TUNING.turnRate).toBe(SHIP_ROTATION_RATE) // default untouched
  })

  it('createTuning applies only the given overrides', () => {
    expect(createTuning({ turnRate: 5 })).toEqual({
      turnRate: 5,
      tapHoldDelayFrames: DEFAULT_TUNING.tapHoldDelayFrames,
    })
  })
})

describe('loadTuning / saveTuning persistence', () => {
  it('round-trips saved values', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    saveTuning({ turnRate: 4.5, tapHoldDelayFrames: 20 })
    expect(loadTuning()).toEqual({ turnRate: 4.5, tapHoldDelayFrames: 20 })
  })

  it('returns {} when nothing is stored', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    expect(loadTuning()).toEqual({})
  })

  it('returns {} for corrupt JSON', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'asteroids-tuning': '{not json' }))
    expect(loadTuning()).toEqual({})
  })

  it('ignores non-finite / unknown keys', () => {
    vi.stubGlobal(
      'localStorage',
      fakeStorage({ 'asteroids-tuning': JSON.stringify({ turnRate: 'x', tapHoldDelayFrames: 9, junk: 1 }) }),
    )
    expect(loadTuning()).toEqual({ tapHoldDelayFrames: 9 })
  })

  it('degrades to {} / no-throw when localStorage access throws', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    })
    expect(loadTuning()).toEqual({})
    expect(() => saveTuning({ turnRate: 3, tapHoldDelayFrames: 12 })).not.toThrow()
  })
})
