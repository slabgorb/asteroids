// tests/core-boundary.test.ts
//
// AC-3 (the guard star-wars never had): core/ must be pure. It must never
// import from shell/, and never call wall-clock / entropy globals
// (Date.now, performance.now, Math.random, requestAnimationFrame). All time
// enters as `dt`; all randomness comes from state.rng.
//
// This test scans the actual core/ source on disk. It is deliberately
// non-vacuous: it first asserts the expected core files exist and that at least
// one .ts file was scanned, so an empty core/ (RED) fails loudly instead of
// passing on a scan of nothing.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CORE_DIR = fileURLToPath(new URL('../src/core/', import.meta.url))

const EXPECTED_CORE_FILES = ['rng.ts', 'state.ts', 'input.ts', 'sim.ts', 'ship.ts']

// Match banned globals as *calls* (identifier followed by `(`).
const BANNED_GLOBALS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Date.now', /\bDate\s*\.\s*now\s*\(/],
  ['performance.now', /\bperformance\s*\.\s*now\s*\(/],
  ['Math.random', /\bMath\s*\.\s*random\s*\(/],
  ['requestAnimationFrame', /\brequestAnimationFrame\s*\(/],
]

// Match any import/export/dynamic-import whose module specifier mentions shell.
const SHELL_IMPORT =
  /(?:import|export)\b[^'"]*from\s*['"][^'"]*\bshell\b[^'"]*['"]|import\s*\(\s*['"][^'"]*\bshell\b/

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

describe('core/ boundary guard (AC-3)', () => {
  it('has the expected core source files', () => {
    for (const f of EXPECTED_CORE_FILES) {
      expect(existsSync(CORE_DIR + f), `src/core/${f} must exist`).toBe(true)
    }
  })

  it('never imports from shell/', () => {
    const files = collectCoreTsFiles()
    expect(files.length, 'expected at least one core .ts file to scan').toBeGreaterThan(0)
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      expect(SHELL_IMPORT.test(src), `${file} must not import from shell/`).toBe(false)
    }
  })

  it('never calls wall-clock or entropy globals', () => {
    const files = collectCoreTsFiles()
    expect(files.length, 'expected at least one core .ts file to scan').toBeGreaterThan(0)
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const [name, pattern] of BANNED_GLOBALS) {
        expect(pattern.test(src), `${file} must not call ${name}`).toBe(false)
      }
    }
  })
})
