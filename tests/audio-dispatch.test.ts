// tests/audio-dispatch.test.ts
//
// RED-phase suite for Story A-18 — the shell's event->sound dispatch. A pure,
// importable function so the wiring is exercised BEHAVIOURALLY: feed it
// GameEvents plus a recording fake and assert the exact playback calls made.
// No AudioContext/DOM dependency, so this test runs in plain node (unlike a
// real AudioEngine, which can only be verified by ear in the browser — see
// the session Sm Assessment / TEA Assessment for that "listen to it" AC).
//
// Mirrors tempest's tests/shell/audio-dispatch.test.ts idiom exactly (typed
// recording fake, one row per GameEvent variant, exhaustiveness-of-coverage
// guard) — a proven pattern for this project family, not shared code.
//
// `src/shell/audio-dispatch`, `src/shell/audio` (SoundName), and
// `src/core/events` (GameEvent) do not exist yet, so this file fails to
// compile today (valid RED).
import { describe, it, expect } from 'vitest'
import type { GameEvent } from '../src/core/events'
import type { SoundName } from '../src/shell/audio'

// The slice of the audio engine the dispatcher drives: one-shot `play` plus
// the sustained-loop pair (thrust, saucer siren). A test fake satisfies
// exactly this shape — no `as any`.
interface SoundSurface {
  play(name: SoundName): void
  startLoop(name: SoundName): void
  stopLoop(name: SoundName): void
}

// Dynamic import: the dispatcher is loaded lazily so a RED failure is a clean
// per-test failure rather than aborting collection of the whole file.
async function loadDispatch(): Promise<{
  playEventSounds(audio: SoundSurface, events: readonly GameEvent[]): void
}> {
  return await import('../src/shell/audio-dispatch')
}

// One observable playback effect, tagged by the engine method that produced
// it, so a one-shot `play` can be told apart from a sustained `startLoop`/
// `stopLoop`.
type Effect =
  | { kind: 'play'; sound: SoundName }
  | { kind: 'startLoop'; sound: SoundName }
  | { kind: 'stopLoop'; sound: SoundName }

function recordingAudio(): SoundSurface & { calls: Effect[] } {
  const calls: Effect[] = []
  return {
    calls,
    play(name) {
      calls.push({ kind: 'play', sound: name })
    },
    startLoop(name) {
      calls.push({ kind: 'startLoop', sound: name })
    },
    stopLoop(name) {
      calls.push({ kind: 'stopLoop', sound: name })
    },
  }
}

// Every core GameEvent variant paired with the playback effect the dispatcher
// must produce for it. This table IS the wiring contract — the coverage test
// below guards it against a missing type discriminant or explosion source.
const EVENT_EFFECT: ReadonlyArray<{ event: GameEvent; effect: Effect }> = [
  { event: { type: 'fire' }, effect: { kind: 'play', sound: 'fire' } },
  { event: { type: 'explosion', source: 'ship' }, effect: { kind: 'play', sound: 'explosionShip' } },
  { event: { type: 'explosion', source: 'large' }, effect: { kind: 'play', sound: 'explosionLarge' } },
  { event: { type: 'explosion', source: 'medium' }, effect: { kind: 'play', sound: 'explosionMedium' } },
  { event: { type: 'explosion', source: 'small' }, effect: { kind: 'play', sound: 'explosionSmall' } },
  { event: { type: 'heartbeat' }, effect: { kind: 'play', sound: 'heartbeat' } },
  { event: { type: 'thrust-start' }, effect: { kind: 'startLoop', sound: 'thrust' } },
  { event: { type: 'thrust-stop' }, effect: { kind: 'stopLoop', sound: 'thrust' } },
  { event: { type: 'saucer-siren-start' }, effect: { kind: 'startLoop', sound: 'saucerSiren' } },
  { event: { type: 'saucer-siren-stop' }, effect: { kind: 'stopLoop', sound: 'saucerSiren' } },
]

describe('audio-dispatch playEventSounds (Story A-18)', () => {
  it('is exported as an importable function (no DOM/canvas dependency)', async () => {
    const { playEventSounds } = await loadDispatch()
    expect(typeof playEventSounds, 'playEventSounds must be exported from audio-dispatch').toBe(
      'function',
    )
  })

  it.each(EVENT_EFFECT.map((row) => ({ ...row, type: row.event.type })))(
    "dispatches the right effect for a '$type' event",
    async ({ event, effect }) => {
      const { playEventSounds } = await loadDispatch()
      const audio = recordingAudio()
      playEventSounds(audio, [event])
      expect(audio.calls).toEqual([effect])
    },
  )

  it('dispatches a whole multi-event frame, one call per event, in order', async () => {
    const { playEventSounds } = await loadDispatch()
    const audio = recordingAudio()
    const frame = EVENT_EFFECT.map((r) => r.event)
    playEventSounds(audio, frame)
    expect(audio.calls).toEqual(EVENT_EFFECT.map((r) => r.effect))
  })

  it('plays the same one-shot twice when an event repeats in one frame', async () => {
    const { playEventSounds } = await loadDispatch()
    const audio = recordingAudio()
    const fire: GameEvent = { type: 'fire' }
    playEventSounds(audio, [fire, fire])
    expect(audio.calls).toEqual([
      { kind: 'play', sound: 'fire' },
      { kind: 'play', sound: 'fire' },
    ])
  })

  it('plays nothing for an empty event list', async () => {
    const { playEventSounds } = await loadDispatch()
    const audio = recordingAudio()
    playEventSounds(audio, [])
    expect(audio.calls).toEqual([])
  })

  // The headline loop behaviour: thrust and the saucer siren are SUSTAINED,
  // not one-shots — they must span exactly the held/alive interval.
  it('starts and stops the thrust loop on its edges', async () => {
    const { playEventSounds } = await loadDispatch()
    const audio = recordingAudio()
    playEventSounds(audio, [{ type: 'thrust-start' }, { type: 'thrust-stop' }])
    expect(audio.calls).toEqual([
      { kind: 'startLoop', sound: 'thrust' },
      { kind: 'stopLoop', sound: 'thrust' },
    ])
    expect(audio.calls.some((c) => c.kind === 'play')).toBe(false)
  })

  it('starts and stops the saucer siren loop on its edges', async () => {
    const { playEventSounds } = await loadDispatch()
    const audio = recordingAudio()
    playEventSounds(audio, [{ type: 'saucer-siren-start' }, { type: 'saucer-siren-stop' }])
    expect(audio.calls).toEqual([
      { kind: 'startLoop', sound: 'saucerSiren' },
      { kind: 'stopLoop', sound: 'saucerSiren' },
    ])
  })

  it('wires every GameEvent type discriminant and every explosion source', () => {
    // Guards the table itself: every GameEvent type present, plus all four
    // explosion sources. A new event type or explosion source added to the
    // union without a row here trips this — the prompt to wire it in the
    // dispatcher too (the dispatcher's own compile-time `never` guard
    // enforces the exhaustiveness half on `event.type`).
    const ALL_TYPES: GameEvent['type'][] = [
      'fire',
      'explosion',
      'thrust-start',
      'thrust-stop',
      'saucer-siren-start',
      'saucer-siren-stop',
      'heartbeat',
    ]
    const types = new Set(EVENT_EFFECT.map((r) => r.event.type))
    expect(types.size).toBe(ALL_TYPES.length)
    for (const t of ALL_TYPES) {
      expect(types.has(t), `missing dispatch row for '${t}'`).toBe(true)
    }

    const explosionSources = new Set(
      EVENT_EFFECT.filter(
        (r): r is { event: Extract<GameEvent, { type: 'explosion' }>; effect: Effect } =>
          r.event.type === 'explosion',
      ).map((r) => r.event.source),
    )
    expect(explosionSources).toEqual(new Set(['ship', 'large', 'medium', 'small']))
  })
})
