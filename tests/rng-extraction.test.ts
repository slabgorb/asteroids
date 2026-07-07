// tests/rng-extraction.test.ts
//
// SH-3 (ADR-0001) — asteroids' migration guard for the RNG extraction. The
// seeded PRNG is retired from src/core/rng.ts and consumed from
// @arcade/shared/rng at a pinned git-URL ref (the MUTABLE contract, of which
// asteroids was the source of truth). These invariants replace the old local
// rng.ts + its tests/rng.test.ts unit suite — the determinism/behaviour lock now
// lives in arcade-shared/tests/rng.test.ts (byte-identical golden, incl. every
// game). This guard is pure fs/text (it never imports the shared module, so it
// always collects and reports each miss granularly, matching SH-2's
// scaffold.test.ts idiom). Standalone-repo pure: reads only asteroids' own
// files. RED until GREEN removes the local copy, pins the dep, and re-points the
// consumers.

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
const someSrcImportsSharedRng = (): boolean =>
  walkTs(path('src')).some((f) => readFileSync(f, 'utf8').includes('@arcade/shared/rng'))

describe('rng extraction — local copy retired, consumed from @arcade/shared (SH-3)', () => {
  it('no longer keeps a local src/core/rng.ts (extracted to @arcade/shared/rng)', () => {
    expect(
      existsSync(path('src/core/rng.ts')),
      'asteroids/src/core/rng.ts must be deleted — the PRNG now lives in @arcade/shared/rng (SH-3)',
    ).toBe(false)
  })

  it('pins @arcade/shared as a git-URL dependency', () => {
    expect(read('package.json')).toMatch(/"@arcade\/shared":\s*"github:slabgorb\/arcade-shared#/)
  })

  it('re-points at least one core consumer to import from @arcade/shared/rng', () => {
    expect(
      someSrcImportsSharedRng(),
      'no src/*.ts imports @arcade/shared/rng — consumers were not migrated off the local copy',
    ).toBe(true)
  })
})
