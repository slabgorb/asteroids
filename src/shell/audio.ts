// src/shell/audio.ts
//
// A-18: shell-side WebAudio SFX engine. This is IO (shell), not simulation
// (core) — the pure core emits `GameEvent` DATA and never imports this module
// (core-boundary guard, tests/core-boundary.test.ts).
//
// Plays the ACTUAL Atari 1979 Asteroids sound effects: the canonical
// community-recorded sample set (8-bit / 11 kHz mono .wav), fetched by URL from
// the shared arcade-assets R2 host. The samples are NOT committed to the repo
// (see .gitignore `sfx/`) — they are recordings of Atari's copyrighted audio,
// kept out of git and served separately, exactly like tempest's set. The real
// cabinet generated sound from discrete analog oscillator/noise circuits — no
// sound chip, no ROM audio to bake — so these field recordings ARE the
// authentic reference (there is no digital source to extract). They replace the
// earlier oscillator-synthesis guess now that the real samples are in hand.
//
// Every failure mode degrades silently: no WebAudio support, a blocked autoplay
// context, a failed fetch, or an undecodable sample all leave the game running
// without sound rather than throwing. The context is built lazily inside
// `resume()` (browsers forbid one before a user gesture) and every method is a
// no-op until the samples decode.

// The wiring contract the pure dispatcher (shell/audio-dispatch) and its unit
// tests speak in. DO NOT rename these without updating both — the dispatch test
// pins them exactly.
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

export interface AudioEngine {
  // Create/resume the AudioContext and start loading samples. Safe to call
  // repeatedly (e.g. on every user gesture); only the first call does work.
  resume(): void
  // Play a loaded sample once. No-op if the sound is not loaded, the context is
  // not ready, or audio is unavailable.
  play(name: SoundName): void
  // Start a sustained (looping) sample on its channel (thrust, saucer siren).
  // Steals the channel like play() does, so a retrigger cuts in instead of
  // stacking. Same silent no-ops as play() when unavailable/unloaded.
  startLoop(name: SoundName): void
  // Stop the sustained sample on `name`'s channel. Safe no-op if nothing loops there.
  stopLoop(name: SoundName): void
  // True once at least one sample has decoded.
  ready(): boolean
}

// The decoded samples the engine holds, keyed by FILE rather than by SoundName
// because the mapping is not 1:1:
//   - the ship explosion reuses the biggest rock bang — the cabinet has a single
//     explosion circuit, with no distinct ship-death sound;
//   - the heartbeat alternates two thump samples (the classic lub-DUB).
// `extraShip.wav` (bonus-life cue) is in the R2 sample set too but stays
// UNWIRED here — it belongs to a future bonus-life story, not A-18's scope.
// `saucerSmall.wav` IS wired now (A-13 integration: the small saucer's siren).
type SampleId =
  | 'fire'
  | 'bangLarge'
  | 'bangMedium'
  | 'bangSmall'
  | 'thrust'
  | 'saucerBig'
  | 'saucerSmall'
  | 'beat1'
  | 'beat2'

const SAMPLE_FILES: Record<SampleId, string> = {
  fire: 'fire.wav',
  bangLarge: 'bangLarge.wav',
  bangMedium: 'bangMedium.wav',
  bangSmall: 'bangSmall.wav',
  thrust: 'thrust.wav',
  saucerBig: 'saucerBig.wav',
  saucerSmall: 'saucerSmall.wav',
  beat1: 'beat1.wav',
  beat2: 'beat2.wav',
}

// Served from the shared arcade-assets R2 host (the same custom domain tempest's
// samples live on), NOT the repo — see the file header. Upload the 10 .wav files
// to R2 under `asteroids/sfx/` to make sound play in dev and prod alike.
const SFX_BASE = 'https://arcade-assets.slabgorb.com/asteroids/sfx/'

// Resolve the AudioContext constructor, covering the legacy `webkitAudioContext`
// prefix and non-browser environments. Read off `globalThis` with an explicit
// shape — `AudioContext` is a global ambient, not a `Window` member.
function getAudioContextCtor(): typeof AudioContext | undefined {
  const g = globalThis as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  return g.AudioContext ?? g.webkitAudioContext
}

export function createAudioEngine(): AudioEngine {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let loadStarted = false
  const buffers = new Map<SampleId, AudioBuffer>()
  // The looping source sounding on each channel ('thrust' | 'saucerSiren'), so
  // stopLoop/retrigger can find and tear it down. Cleared by `onended` when a
  // source stops, so a later trigger never stops an already-ended node.
  const loops = new Map<string, AudioBufferSourceNode>()
  // The heartbeat alternates lub (beat1) / DUB (beat2) on each beat.
  let beatHigh = false

  // Fetch + decode every sample once. A failure on any one (network, decode) is
  // swallowed — that sound simply never plays.
  function load(): void {
    if (loadStarted || !ctx) return
    loadStarted = true
    const context = ctx
    for (const id of Object.keys(SAMPLE_FILES) as SampleId[]) {
      fetch(SFX_BASE + SAMPLE_FILES[id])
        .then((res) => res.arrayBuffer())
        .then((data) => context.decodeAudioData(data))
        .then((buffer) => {
          buffers.set(id, buffer)
        })
        .catch(() => {
          /* one missing/undecodable sample is non-fatal — stay silent */
        })
    }
  }

  function resume(): void {
    if (!ctx) {
      const Ctor = getAudioContextCtor()
      if (!Ctor) return // no WebAudio — engine stays inert
      try {
        ctx = new Ctor()
        master = ctx.createGain()
        master.gain.value = 0.5 // headroom so overlapping SFX don't clip
        master.connect(ctx.destination)
      } catch {
        ctx = null
        master = null
        return
      }
    }
    // The context can start 'suspended' until a gesture unlocks it.
    if (ctx.state === 'suspended') void ctx.resume()
    load()
  }

  // Steal a channel: stop whatever loops on it so a new trigger cuts in. Its own
  // guard — a source that already ended would throw on stop(), and that must not
  // abort the cut-in.
  function stopChannel(channel: string): void {
    const prev = loops.get(channel)
    if (!prev) return
    loops.delete(channel)
    try {
      prev.stop()
      prev.disconnect()
    } catch {
      /* prior source may have already ended — ignore */
    }
  }

  // Start a decoded sample on the master bus. A `channel` (loops only) enables
  // stop/steal; one-shots pass none and fire-and-forget (rapid fire and stacked
  // bangs are meant to overlap). Silent no-op if the sample hasn't decoded yet.
  function playSample(id: SampleId, loop: boolean, channel?: string): void {
    if (!ctx || !master) return
    const buffer = buffers.get(id)
    if (!buffer) return // not loaded (yet) or failed to decode — silent no-op
    try {
      if (channel) stopChannel(channel)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = loop
      source.connect(master)
      if (channel) {
        source.onended = () => {
          if (loops.get(channel) === source) loops.delete(channel)
        }
        loops.set(channel, source)
      }
      source.start()
    } catch {
      /* never let a single sound failure crash the frame */
    }
  }

  function play(name: SoundName): void {
    switch (name) {
      case 'fire':
        playSample('fire', false)
        break
      // The ship's death reuses the largest rock bang — one explosion circuit.
      case 'explosionShip':
      case 'explosionLarge':
        playSample('bangLarge', false)
        break
      case 'explosionMedium':
        playSample('bangMedium', false)
        break
      case 'explosionSmall':
        playSample('bangSmall', false)
        break
      case 'heartbeat':
        playSample(beatHigh ? 'beat2' : 'beat1', false)
        beatHigh = !beatHigh
        break
      case 'thrust':
      case 'saucerSiren':
      case 'saucerSirenSmall':
        // Sustained sounds — driven through startLoop/stopLoop, not play().
        break
      default: {
        const _exhaustive: never = name
        void _exhaustive
        break
      }
    }
  }

  function startLoop(name: SoundName): void {
    // Both sirens share the 'saucerSiren' channel, so starting one (or the same
    // saucer changing size mid-life, which never happens) steals the other —
    // only one siren ever rings.
    if (name === 'thrust') playSample('thrust', true, 'thrust')
    else if (name === 'saucerSiren') playSample('saucerBig', true, 'saucerSiren')
    else if (name === 'saucerSirenSmall') playSample('saucerSmall', true, 'saucerSiren')
  }

  function stopLoop(name: SoundName): void {
    if (name === 'thrust') stopChannel('thrust')
    else if (name === 'saucerSiren' || name === 'saucerSirenSmall') stopChannel('saucerSiren')
  }

  function ready(): boolean {
    return buffers.size > 0
  }

  return { resume, play, startLoop, stopLoop, ready }
}
