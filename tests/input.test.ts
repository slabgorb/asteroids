// tests/input.test.ts
//
// Input shape + NO_INPUT rest-state fixture. Pins the exact device-abstracted
// field set (left/right/thrust/fire/hyperspace/start) so a stray or missing
// control is caught immediately, and guarantees NO_INPUT is genuinely all-false.
//
// A-16 adds `start` — the cabinet's start button (shell maps Space/Enter). It is
// the ONLY field A-16 adds: initials characters are edge events, not per-frame
// held state, so they enter the core through `enterInitial(state, char)`
// (tests/framing.test.ts), keeping this type's plain-boolean contract intact.

import { describe, it, expect } from 'vitest'
import { NO_INPUT, type Input } from '../src/core/input'

const EXPECTED_FIELDS = ['fire', 'hyperspace', 'left', 'right', 'start', 'thrust']

describe('Input / NO_INPUT', () => {
  it('exposes exactly the six abstract controls', () => {
    expect(Object.keys(NO_INPUT).sort()).toEqual(EXPECTED_FIELDS)
  })

  it('has every control set to false at rest', () => {
    for (const [key, value] of Object.entries(NO_INPUT)) {
      expect(typeof value, `${key} must be a boolean`).toBe('boolean')
      expect(value, `${key} must be false in NO_INPUT`).toBe(false)
    }
  })

  it('is fully at rest (no truthy control)', () => {
    expect(Object.values(NO_INPUT).every((v) => v === false)).toBe(true)
  })

  it('accepts an all-pressed Input (compile-time field contract)', () => {
    // If the Input type drops or renames a field, this stops typechecking and
    // the build (tsc --noEmit) goes red.
    const allPressed: Input = {
      left: true,
      right: true,
      thrust: true,
      fire: true,
      hyperspace: true,
      start: true,
    }
    expect(Object.values(allPressed).every((v) => v === true)).toBe(true)
    expect(Object.keys(allPressed).sort()).toEqual(EXPECTED_FIELDS)
  })
})
