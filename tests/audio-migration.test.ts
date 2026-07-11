// tests/audio-migration.test.ts
//
// SH2-17 (epic SH2) — RED phase (O'Brien / TEA). asteroids migrates its shell-side SFX
// engine onto the shared @arcade/shared/audio `createAudioEngine` (SH2-16, released
// v0.12.0), keeping its per-cabinet NUMBERS (the SFX manifest, the R2 base) and its
// dispatcher-facing SoundName union + audio-dispatch.ts wiring untouched.
//
// Contract-altitude guards, mirroring the SH2-8 glow-adoption idiom — they assert the
// migration HAPPENED, not HOW the engine is composed. The game's existing
// tests/audio-dispatch.test.ts (event -> play/startLoop/stopLoop wiring, incl.
// play('heartbeat')) is the behavioural net and must stay green through the migration.
//
//   1. adoption      — src/shell/audio.ts imports from @arcade/shared/audio
//                      (fails today: asteroids hand-rolls its own engine).
//   2. resolution    — the pinned @arcade/shared exposes ./audio with createAudioEngine
//                      (fails today: the pin #v0.11.0 predates /audio — Dev bumps the pin
//                      to >= v0.12.0 and reinstalls to turn this GREEN).
//   3. SampleId gone — the bespoke SampleId / SAMPLE_FILES file-keyed indirection is
//                      removed (AC-2); the shared filename-keyed store subsumes it.
//   4. body-deleted  — the local engine internals (getAudioContextCtor,
//                      createBufferSource, decodeAudioData) are gone (asteroids has no
//                      speech to retain them — mirrors tempest's migrated audio.ts).
//   5. guardrails    — the per-cabinet NUMBERS (SoundName union + R2 base) stay local.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const audioPath = fileURLToPath(new URL('../src/shell/audio.ts', import.meta.url))
const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url))
const audioSrc = (): string => readFileSync(audioPath, 'utf8')

const AUDIO_IMPORT = /from\s+['"]@arcade\/shared\/audio['"]/

describe('SH2-17 — asteroids adopts @arcade/shared/audio (AC-1, AC-2)', () => {
  it('src/shell/audio.ts imports the shared audio engine (engine no longer hand-rolled)', () => {
    expect(
      AUDIO_IMPORT.test(audioSrc()),
      'src/shell/audio.ts does not import @arcade/shared/audio — the shared engine was not adopted',
    ).toBe(true)
  })

  it('the pinned @arcade/shared exposes ./audio with createAudioEngine', async () => {
    // Non-literal + @vite-ignore so the missing subpath does not fail this file at
    // COLLECTION time (which would suppress every other driver below) — it must reject
    // at RUNTIME, as its own granular miss, until Dev bumps the pin and reinstalls.
    const spec = '@arcade/shared/audio'
    const audio = await import(/* @vite-ignore */ spec)
    expect(
      typeof audio.createAudioEngine,
      'createAudioEngine must be exported by the pinned @arcade/shared/audio — bump the pin to >= v0.12.0 and reinstall',
    ).toBe('function')
  })

  it('removes the bespoke SampleId / SAMPLE_FILES file-keyed indirection (AC-2)', () => {
    // The shared engine keys buffers by FILENAME, so several logical names → one .wav
    // decode once (asteroids explosionShip/explosionLarge → bangLarge.wav). asteroids'
    // own SampleId union + SAMPLE_FILES map are therefore deleted; no asteroids-specific
    // indirection survives.
    const src = audioSrc()
    expect(src, 'the SampleId indirection type must be removed (AC-2)').not.toMatch(/\bSampleId\b/)
    expect(src, 'the SAMPLE_FILES file-keyed map must be removed (AC-2)').not.toMatch(/\bSAMPLE_FILES\b/)
  })

  it('deletes the local engine body (getAudioContextCtor / createBufferSource / decodeAudioData)', () => {
    // asteroids has no speech to keep any of these — the shared engine owns the whole
    // WebAudio mechanism now (mirrors tempest/src/shell/audio.ts, which has none).
    const src = audioSrc()
    expect(src, 'getAudioContextCtor must be gone — the shared engine resolves the context').not.toMatch(
      /getAudioContextCtor/,
    )
    expect(src, 'createBufferSource must be gone — the shared engine starts sources').not.toMatch(
      /createBufferSource/,
    )
    expect(src, 'decodeAudioData must be gone — the shared engine loads/decodes samples').not.toMatch(
      /decodeAudioData/,
    )
  })

  it('keeps the per-cabinet NUMBERS in the game (SoundName union + R2 base)', () => {
    const src = audioSrc()
    expect(src, 'the dispatcher-facing SoundName union must stay local (audio-dispatch.ts imports it)').toMatch(
      /export\s+type\s+SoundName\b/,
    )
    expect(src, "the asteroids R2 SFX base ('.../asteroids/sfx/') must stay local").toMatch(/asteroids\/sfx\//)
  })

  it('pins @arcade/shared as a git-URL dependency', () => {
    expect(readFileSync(pkgPath, 'utf8')).toMatch(/"@arcade\/shared":\s*"github:slabgorb\/arcade-shared#/)
  })
})
