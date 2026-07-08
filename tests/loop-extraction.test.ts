// tests/loop-extraction.test.ts
//
// SH-5 (ADR-0001) — asteroids' migration guard for the game-loop extraction. The
// fixed-timestep createLoop is retired from src/shell/loop.ts and consumed from
// @arcade/shared/loop at a pinned git-URL ref (asteroids was the source of truth
// for the CORRECTED started-boolean form). These invariants replace the old local
// shell/loop.ts + its tests/loop.test.ts unit suite — the behavioural lock now
// lives in arcade-shared/tests/loop.test.ts (byte-identical golden). This guard is
// pure fs/text (it never imports the shared module, so it collects each miss
// granularly, matching the SH-3 rng-extraction idiom). Standalone-repo pure: reads
// only asteroids' own files.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const path = (rel: string): string => join(root, rel)
const read = (rel: string): string => readFileSync(path(rel), 'utf8')

function walkTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkTs(full))
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}
const someSrcImportsSharedLoop = (): boolean =>
  walkTs(path('src')).some((f) => readFileSync(f, 'utf8').includes('@arcade/shared/loop'))

describe('loop extraction — local copy retired, consumed from @arcade/shared (SH-5)', () => {
  it('no longer keeps a local src/shell/loop.ts (extracted to @arcade/shared/loop)', () => {
    expect(
      existsSync(path('src/shell/loop.ts')),
      'asteroids/src/shell/loop.ts must be deleted — the loop now lives in @arcade/shared/loop (SH-5)',
    ).toBe(false)
  })

  it('pins @arcade/shared as a git-URL dependency', () => {
    expect(read('package.json')).toMatch(/"@arcade\/shared":\s*"github:slabgorb\/arcade-shared#/)
  })

  it('re-points at least one consumer to import from @arcade/shared/loop', () => {
    expect(
      someSrcImportsSharedLoop(),
      'no src/*.ts imports @arcade/shared/loop — the loop was not migrated off the local copy',
    ).toBe(true)
  })
})
