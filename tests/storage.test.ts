// tests/storage.test.ts
//
// RED-phase suite for Story A-16, Part B: the SHELL persistence seam
// (src/shell/storage.ts), localStorage-backed high scores. This MIRRORS
// star-wars' tests/shell/storage.test.ts (the explicit port-near-verbatim
// mandate in context-story-A-16.md) with the ONE required change from a straight
// copy: the storage key is `asteroids-high-scores`. An entry records the `wave`
// reached — asteroids' own counter name already (state.ts, A-2).
//
// The key is ALSO the lobby contract: lobby/src/shell/storage.ts derives
// `highScoreKey('asteroids')` === 'asteroids-high-scores' from its registry
// entry and reads `Math.max` over rows carrying a finite numeric `.score` —
// exactly the rows saveHighScores persists. Get the literal wrong and the tile
// silently shows NO SCORE, so the literal is pinned here, not re-imported.
//
// The module imports the table TYPES from core/ — never the reverse — so the
// pure core can depend on the shape without importing shell/. It is IO, not
// simulation: every failure mode (missing, corrupt, unavailable, quota-exceeded)
// must degrade gracefully so the game keeps playing; scores just don't persist.
//
// src/shell/storage.ts does NOT exist pre-GREEN, so this file fails to LOAD until
// Dev creates it — that import failure IS the RED signal. Tests run in the `node`
// environment (vite.config.ts), which has no localStorage, so each test installs
// a fake on globalThis.
//
// Lang-review (typescript.md) rules this suite enforces:
//  - #10 / #1 input-validation: JSON.parse() output is runtime-validated per
//    entry (`isHighScoreEntry`), never trusted via `as T`.
//  - #2 generic/interface: saveHighScores takes a `readonly` array (no mutation).
//  - #4 null/undefined + #11 error-handling: storage access degrades gracefully,
//    never throws.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { HighScoreEntry, HighScoreTable } from '../src/core/highscore'
import { loadHighScores, saveHighScores } from '../src/shell/storage'

// The persisted key is part of the public contract (the lobby reads this same
// key), so assert the literal rather than re-importing it.
const STORAGE_KEY = 'asteroids-high-scores'

// A representative table: descending by score, mixing entries WITH and WITHOUT
// the optional `date` to exercise `date?`.
const SAMPLE_TABLE: HighScoreTable = [
  { name: 'AAA', score: 50000, wave: 4, date: '2026-07-03T00:00:00.000Z' },
  { name: 'BOB', score: 30000, wave: 3 },
  { name: 'CDE', score: 10000, wave: 1, date: '2026-07-02T12:00:00.000Z' },
]

// ---- Fake Storage (node test env has no localStorage) -----------------------

function makeFakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial))
  const storage = {
    get length(): number {
      return map.size
    },
    clear(): void {
      map.clear()
    },
    getItem(key: string): string | null {
      return map.has(key) ? (map.get(key) as string) : null
    },
    key(index: number): string | null {
      return Array.from(map.keys())[index] ?? null
    },
    removeItem(key: string): void {
      map.delete(key)
    },
    setItem(key: string, value: string): void {
      map.set(key, String(value))
    },
  }
  return storage as unknown as Storage
}

// A Storage whose setItem always throws, simulating a full quota. A plain Error
// (not a DOMException) on purpose: the impl must catch broadly.
function makeQuotaStorage(): Storage {
  const storage = makeFakeStorage()
  storage.setItem = () => {
    throw new Error('QuotaExceededError: storage is full')
  }
  return storage
}

function setLocalStorage(value: Storage | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value,
  })
}

// Private-browsing / sandboxed iframes where even *accessing* localStorage throws.
function setThrowingLocalStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get(): never {
      throw new Error('SecurityError: localStorage access denied')
    },
  })
}

beforeEach(() => {
  // Graceful-degradation paths may log; keep test output clean. We do NOT assert
  // on logging (impl may use warn/error/none) — only on behaviour.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  vi.restoreAllMocks()
})

// ---- loadHighScores ---------------------------------------------------------

describe('loadHighScores', () => {
  it('returns [] when no high-score key is present', () => {
    setLocalStorage(makeFakeStorage())
    expect(loadHighScores()).toEqual([])
  })

  it('parses and returns a valid stored table', () => {
    setLocalStorage(makeFakeStorage({ [STORAGE_KEY]: JSON.stringify(SAMPLE_TABLE) }))
    expect(loadHighScores()).toEqual(SAMPLE_TABLE)
  })

  // Entry shape is {name, score, wave, date?} — `date` is optional and its
  // absence must survive the load (not become null / a placeholder).
  it('preserves entry shape including the optional date field', () => {
    setLocalStorage(makeFakeStorage({ [STORAGE_KEY]: JSON.stringify(SAMPLE_TABLE) }))
    const table = loadHighScores()

    expect(table).toHaveLength(3)
    const [first, second] = table as HighScoreEntry[]

    expect(first).toMatchObject({ name: 'AAA', score: 50000, wave: 4 })
    expect(first.date).toBe('2026-07-03T00:00:00.000Z')

    expect(second).toMatchObject({ name: 'BOB', score: 30000, wave: 3 })
    expect(second.date).toBeUndefined()
    expect('date' in second).toBe(false)
  })

  it('returns [] for corrupt JSON without throwing', () => {
    setLocalStorage(makeFakeStorage({ [STORAGE_KEY]: '{ this is not: valid json' }))
    expect(() => loadHighScores()).not.toThrow()
    expect(loadHighScores()).toEqual([])
  })

  it('returns [] when stored JSON is valid but not a table array', () => {
    for (const malformed of ['{"foo":"bar"}', 'null', '42', '"a string"', 'true']) {
      setLocalStorage(makeFakeStorage({ [STORAGE_KEY]: malformed }))
      expect(loadHighScores()).toEqual([])
    }
  })

  it('returns [] when localStorage is undefined without throwing', () => {
    setLocalStorage(undefined)
    expect(() => loadHighScores()).not.toThrow()
    expect(loadHighScores()).toEqual([])
  })

  it('returns [] when accessing localStorage throws without throwing', () => {
    setThrowingLocalStorage()
    expect(() => loadHighScores()).not.toThrow()
    expect(loadHighScores()).toEqual([])
  })
})

// ---- saveHighScores ---------------------------------------------------------

describe('saveHighScores', () => {
  it('writes the table as JSON under the asteroids-high-scores key', () => {
    const fake = makeFakeStorage()
    setLocalStorage(fake)

    saveHighScores(SAMPLE_TABLE)

    const raw = fake.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)).toEqual(SAMPLE_TABLE)
  })

  it('round-trips: a saved table loads back equal', () => {
    setLocalStorage(makeFakeStorage())
    saveHighScores(SAMPLE_TABLE)
    expect(loadHighScores()).toEqual(SAMPLE_TABLE)
  })

  it('persists an empty table without throwing', () => {
    setLocalStorage(makeFakeStorage())
    expect(() => saveHighScores([])).not.toThrow()
    expect(loadHighScores()).toEqual([])
  })

  it('does not throw when the storage quota is exceeded', () => {
    setLocalStorage(makeQuotaStorage())
    expect(() => saveHighScores(SAMPLE_TABLE)).not.toThrow()
  })

  it('does not throw when localStorage is undefined', () => {
    setLocalStorage(undefined)
    expect(() => saveHighScores(SAMPLE_TABLE)).not.toThrow()
  })

  it('does not throw when accessing localStorage throws', () => {
    setThrowingLocalStorage()
    expect(() => saveHighScores(SAMPLE_TABLE)).not.toThrow()
  })
})

// ---- lobby-contract cross-check ---------------------------------------------
//
// The lobby's getTopScore('asteroids') takes Math.max over stored rows carrying
// a finite numeric `.score`. This round-trip pins that what saveHighScores
// persists is exactly consumable that way — the cross-repo wiring in one assert,
// without importing lobby code (the arcade shares a convention, not a library).
describe('lobby high-score contract', () => {
  it('persists rows whose max finite score is the table top (what the lobby tile shows)', () => {
    const fake = makeFakeStorage()
    setLocalStorage(fake)
    saveHighScores(SAMPLE_TABLE)

    const parsed: unknown = JSON.parse(fake.getItem(STORAGE_KEY) as string)
    expect(Array.isArray(parsed)).toBe(true)
    const scores = (parsed as Array<Record<string, unknown>>)
      .map((row) => row.score)
      .filter((s): s is number => typeof s === 'number' && Number.isFinite(s))
    expect(scores.length).toBeGreaterThan(0)
    expect(Math.max(...scores)).toBe(50000)
  })
})

// ---- loadHighScores: per-entry validation guard -----------------------------
//
// Array-shape alone is not enough: a corrupt-but-array payload like `[{}]` or
// `[{name:9,score:'x'}]` would otherwise reach the renderer, which reads
// entry.name / entry.score / entry.wave and prints garbage. A per-entry
// `isHighScoreEntry` guard (lang-review #10/#1: validate JSON.parse output, never
// `as T`) keeps only well-formed rows (bad rows dropped; `[]` if none).
//
// "Well-formed" == correct field TYPES:
//   - name : typeof === 'string'
//   - score: typeof === 'number'
//   - wave : typeof === 'number'
//   - date : optional; survivors KEEP it (the "preserves entry shape" test forbids
//            rebuilding entries with a spurious `date`, so the guard FILTERS).
describe('loadHighScores — per-entry validation guard', () => {
  const loadFrom = (payload: unknown): HighScoreTable => {
    setLocalStorage(makeFakeStorage({ [STORAGE_KEY]: JSON.stringify(payload) }))
    return loadHighScores()
  }

  it('drops an empty-object entry ([{}] -> [])', () => {
    expect(loadFrom([{}])).toEqual([])
  })

  it('drops a wrong-typed entry ([{name:9, score:"x"}] -> [])', () => {
    expect(loadFrom([{ name: 9, score: 'x' }])).toEqual([])
  })

  it('drops entries missing any required field (name | score | wave)', () => {
    expect(loadFrom([{ score: 100, wave: 3 }])).toEqual([]) // no name
    expect(loadFrom([{ name: 'ABC', wave: 3 }])).toEqual([]) // no score
    expect(loadFrom([{ name: 'ABC', score: 100 }])).toEqual([]) // no wave
  })

  it('drops entries whose required fields have the wrong type', () => {
    expect(loadFrom([{ name: 9, score: 100, wave: 3 }])).toEqual([]) // name not string
    expect(loadFrom([{ name: 'ABC', score: '100', wave: 3 }])).toEqual([]) // score not number
    expect(loadFrom([{ name: 'ABC', score: 100, wave: '3' }])).toEqual([]) // wave not number
  })

  it('drops non-object array members (null, number, string, boolean, array)', () => {
    expect(loadFrom([null, 42, 'AAA', true, []])).toEqual([])
  })

  it('returns [] when every entry is malformed', () => {
    const garbage: unknown[] = [
      {},
      { name: 9, score: 'x' },
      { name: 'ABC', score: 100 },
      { score: 100, wave: 3 },
      null,
      42,
      'AAA',
      true,
      [],
    ]
    expect(loadFrom(garbage)).toEqual([])
  })

  // Partial corruption: keep ONLY the well-formed rows, in order, date preserved.
  it('keeps only the well-formed rows from a mixed array, preserving order and date', () => {
    const mixed: unknown[] = [
      { name: 'AAA', score: 50000, wave: 4, date: '2026-07-03T00:00:00.000Z' }, // keep
      {}, // drop
      { name: 'BOB', score: 30000, wave: 3 }, // keep
      { name: 9, score: 'x' }, // drop
      null, // drop
      { name: 'CDE', score: 10000, wave: 1 }, // keep
    ]
    expect(loadFrom(mixed)).toEqual([
      { name: 'AAA', score: 50000, wave: 4, date: '2026-07-03T00:00:00.000Z' },
      { name: 'BOB', score: 30000, wave: 3 },
      { name: 'CDE', score: 10000, wave: 1 },
    ])
  })

  // The guard must not OVER-reject: a fully well-formed table returns unchanged.
  it('returns a fully well-formed table unchanged', () => {
    expect(loadFrom(SAMPLE_TABLE)).toEqual(SAMPLE_TABLE)
  })

  it('never throws on a garbage array payload', () => {
    expect(() => loadFrom([{}, null, { name: 1 }])).not.toThrow()
  })
})

// ---- saveHighScores: readonly parameter -------------------------------------
//
// saveHighScores never mutates its input, so its parameter is
// `readonly HighScoreEntry[]` (lang-review #2: readonly on array params not
// mutated). Two enforcement layers, because the test runner (esbuild) strips
// types while the type runner (`tsc --noEmit`) does not:
//   1. compile-time — the `readonlyTable` annotation only type-checks once the
//      signature is widened (a `readonly[]` is NOT assignable to a mutable `[]`).
//   2. source-text — the declared signature literally names `readonly`, giving the
//      type-stripped vitest run its own RED signal for the AC. Read via node:fs
//      (this repo's core-boundary.test.ts convention) rather than Vite `?raw`.
describe('saveHighScores — readonly parameter', () => {
  it('accepts a readonly HighScoreEntry[] and round-trips it', () => {
    setLocalStorage(makeFakeStorage())
    const readonlyTable: readonly HighScoreEntry[] = SAMPLE_TABLE
    saveHighScores(readonlyTable)
    expect(loadHighScores()).toEqual(SAMPLE_TABLE)
  })

  it('does not mutate a frozen input table', () => {
    setLocalStorage(makeFakeStorage())
    const frozen: readonly HighScoreEntry[] = Object.freeze(SAMPLE_TABLE.map((e) => ({ ...e })))
    expect(() => saveHighScores(frozen)).not.toThrow()
    expect(frozen).toEqual(SAMPLE_TABLE)
  })

  it('declares its parameter `readonly` in the source signature', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/shell/storage.ts', import.meta.url)),
      'utf8',
    )
    expect(src).toMatch(/export function saveHighScores\s*\([^)]*\breadonly\b[^)]*\)/)
  })
})
