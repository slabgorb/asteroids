// src/shell/audio.ts
//
// A-18 / SH2-17: asteroids' SFX manifest + engine constructor. The WebAudio ENGINE
// itself (lazy AudioContext, master gain, buffer load/decode, POKEY-style
// voice-stealing, silent degrade) was extracted to @arcade/shared/audio in SH2-16 and
// adopted here in SH2-17 — four cabinets shared the identical mechanism. This module
// keeps only asteroids' NUMBERS (the name->file SOUNDS manifest, the CHANNELS voice
// map, the R2 base, masterGain) and constructs the shared engine from them. The
// event->sound wiring stays in audio-dispatch.ts.
//
// This is IO (shell), not simulation (core) — the pure core emits `GameEvent` DATA and
// never imports this module (core-boundary guard, tests/core-boundary.test.ts).
//
// Plays the ACTUAL Atari 1979 Asteroids sound effects: the canonical
// community-recorded sample set (8-bit / 11 kHz mono .wav), fetched by URL from the
// shared arcade-assets R2 host. The real cabinet generated sound from discrete analog
// oscillator/noise circuits — no sound chip, no ROM audio to bake — so these field
// recordings ARE the authentic reference. Every failure mode still degrades silently
// (no WebAudio, blocked autoplay, failed fetch, undecodable sample) — that behaviour
// now lives in the shared engine.
import {
  createAudioEngine as createSharedAudioEngine,
  type AudioEngine as SharedAudioEngine,
} from '@arcade/shared/audio'

// The wiring contract the pure dispatcher (shell/audio-dispatch) and its unit tests
// speak in. DO NOT rename these without updating both — the dispatch test pins them
// exactly. This is the DISPATCHER-FACING sound set; the physical files it resolves to
// live in SOUNDS below (the heartbeat's lub-DUB is one logical name over two files).
export type SoundName =
  | 'fire'
  | 'explosionShip'
  | 'explosionLarge'
  | 'explosionMedium'
  | 'explosionSmall'
  | 'thrust'
  | 'saucerSiren' // the LARGE saucer's siren
  | 'saucerSirenSmall' // the SMALL saucer's siren (A-13 size split) — shares the siren channel
  | 'heartbeat'

// Served from the shared arcade-assets R2 host (the same custom domain tempest's
// samples live on), NOT the repo — upload the .wav files to R2 under `asteroids/sfx/`.
const SFX_BASE = 'https://arcade-assets.slabgorb.com/asteroids/sfx/'

// asteroids' NUMBERS — the PHYSICAL sound manifest handed to the shared engine.
// Buffers are keyed by FILENAME, so the several-names-per-file cases decode once:
//   - the ship explosion reuses the biggest rock bang (one explosion circuit):
//     explosionShip + explosionLarge both -> bangLarge.wav;
//   - the heartbeat alternates two thump files (the classic lub-DUB): heartbeatLow +
//     heartbeatHigh -> beat1/beat2.wav (the alternation is driven by the local wrapper
//     below so the dispatcher keeps calling play('heartbeat')).
// This REPLACES the bespoke file-keyed indirection asteroids used to carry (SH2-17
// AC-2) — the shared filename-keyed store subsumes it, so no asteroids-specific branch
// enters the shared code.
const SOUNDS = {
  fire: 'fire.wav',
  explosionShip: 'bangLarge.wav',
  explosionLarge: 'bangLarge.wav',
  explosionMedium: 'bangMedium.wav',
  explosionSmall: 'bangSmall.wav',
  thrust: 'thrust.wav',
  saucerSiren: 'saucerBig.wav',
  saucerSirenSmall: 'saucerSmall.wav',
  heartbeatLow: 'beat1.wav',
  heartbeatHigh: 'beat2.wav',
} as const

// The physical name union the shared engine is generic over (a superset of the
// dispatcher-facing SoundName: 'heartbeat' fans out to heartbeatLow/High).
type SampleName = keyof typeof SOUNDS

// Logical channels (POKEY-style voice stealing). Each one-shot gets its OWN channel so
// distinct sounds never cut each other off; a rapid retrigger of the SAME sound cuts in
// (POKEY-style) rather than stacking — the cabinet-wide convergence onto the shared
// VERB (as tempest's 10-10). The two sirens share one channel so only one ever rings
// (A-13); the two heartbeat thumps share one channel (they are sequential — never
// overlap). Keyed by SampleName, so a new manifest sound without a channel is a
// compile error.
const CHANNELS: Record<SampleName, string> = {
  fire: 'fire',
  explosionShip: 'explosion-ship',
  explosionLarge: 'explosion-large',
  explosionMedium: 'explosion-medium',
  explosionSmall: 'explosion-small',
  thrust: 'thrust',
  saucerSiren: 'saucer-siren',
  saucerSirenSmall: 'saucer-siren',
  heartbeatLow: 'heartbeat',
  heartbeatHigh: 'heartbeat',
}

export interface AudioEngine {
  // Create/resume the AudioContext and start loading samples. Safe to call repeatedly;
  // only the first call does work.
  resume(): void
  // Play a loaded sample once. Steals its channel. No-op if unloaded/unavailable.
  play(name: SoundName): void
  // Start a sustained (looping) sample on its channel (thrust, saucer siren).
  startLoop(name: SoundName): void
  // Stop the sustained sample on `name`'s channel. Safe no-op if nothing loops there.
  stopLoop(name: SoundName): void
  // True once at least one sample has decoded.
  ready(): boolean
}

// asteroids' concrete shared engine, specialised to its physical SampleName union.
type SampleEngine = SharedAudioEngine<SampleName>

export function createAudioEngine(): AudioEngine {
  const engine: SampleEngine = createSharedAudioEngine<SampleName>({
    baseUrl: SFX_BASE,
    masterGain: 0.5, // asteroids' long-standing headroom value (shared default is 0.4)
    sounds: SOUNDS,
    channels: CHANNELS,
  })

  // The heartbeat alternates lub (beat1) / DUB (beat2) on each beat. The shared engine
  // plays one file per name, so the alternation lives HERE (not in the shared code, and
  // not in the dispatcher — the dispatcher keeps calling play('heartbeat')).
  let beatHigh = false

  return {
    resume: () => engine.resume(),
    ready: () => engine.ready(),
    play(name: SoundName): void {
      if (name === 'heartbeat') {
        engine.play(beatHigh ? 'heartbeatHigh' : 'heartbeatLow')
        beatHigh = !beatHigh
        return
      }
      // Every remaining SoundName is a physical SampleName 1:1.
      engine.play(name)
    },
    startLoop(name: SoundName): void {
      // Loops are only ever thrust / saucerSiren / saucerSirenSmall — all SampleNames.
      if (name === 'thrust' || name === 'saucerSiren' || name === 'saucerSirenSmall') {
        engine.startLoop(name)
      }
    },
    stopLoop(name: SoundName): void {
      if (name === 'thrust' || name === 'saucerSiren' || name === 'saucerSirenSmall') {
        engine.stopLoop(name)
      }
    },
  }
}
