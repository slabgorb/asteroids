// src/shell/audio-dispatch.ts
//
// A-18: the shell's event->sound dispatch, extracted as a pure, importable
// function so the wiring is testable WITHOUT booting a canvas/AudioContext.
// Mirrors the sibling tempest game's shell/audio-dispatch.ts pattern.
import type { GameEvent } from '../core/events'
import type { AudioEngine } from './audio'

// Just the slice of the audio engine this dispatcher needs.
type SoundPlayer = Pick<AudioEngine, 'play' | 'startLoop' | 'stopLoop'>

/** Play one sound per gameplay event the core emitted this frame, in order. */
export function playEventSounds(audio: SoundPlayer, events: readonly GameEvent[]): void {
  for (const event of events) {
    switch (event.type) {
      case 'fire':
        audio.play('fire')
        break
      case 'explosion':
        switch (event.source) {
          case 'ship':
            audio.play('explosionShip')
            break
          case 'large':
            audio.play('explosionLarge')
            break
          case 'medium':
            audio.play('explosionMedium')
            break
          case 'small':
            audio.play('explosionSmall')
            break
          default: {
            const _exhaustive: never = event.source
            void _exhaustive
            break
          }
        }
        break
      case 'thrust-start':
        audio.startLoop('thrust')
        break
      case 'thrust-stop':
        audio.stopLoop('thrust')
        break
      case 'saucer-siren-start':
        // A-13 size split: the small saucer gets its own siren sample; both share
        // one loop channel in the engine, so only one ever rings.
        audio.startLoop(event.size === 'small' ? 'saucerSirenSmall' : 'saucerSiren')
        break
      case 'saucer-siren-stop':
        audio.stopLoop('saucerSiren')
        break
      case 'heartbeat':
        audio.play('heartbeat')
        break
      default: {
        // Exhaustiveness guard: every GameEvent discriminant is handled above,
        // so `event` narrows to `never` here. Add a new event type without
        // wiring a case and this becomes a COMPILE error.
        const _exhaustive: never = event
        void _exhaustive
        break
      }
    }
  }
}
