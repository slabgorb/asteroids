// src/shell/input.ts
//
// A-5: keyboard → Input capture. The pure core consumes the abstract Input shape
// (core/input.ts); this shell controller is the ONLY place raw browser key events
// are read. It tracks the currently-held keys and hands the loop a fresh Input
// snapshot each frame via sample(). Mirrors the sibling games' input controller
// (star-wars/src/shell/input.ts).

import type { Input } from '../core/input'

export interface InputController {
  /** A fresh Input reflecting the keys held this instant. */
  sample(): Input
}

// Cabinet controls: rotate left/right, thrust, fire, hyperspace. Arrow keys are
// primary; WASD + K are convenience alternates.
const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  thrust: ['ArrowUp', 'KeyW'],
  fire: ['Space', 'KeyK'],
  hyperspace: ['ArrowDown', 'KeyS', 'ShiftLeft', 'ShiftRight'],
} as const

// Keys the browser would otherwise scroll the page with — the cabinet owns them.
const SCROLL_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'])

export function createInputController(): InputController {
  const held = new Set<string>()

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    held.add(e.code)
    if (SCROLL_KEYS.has(e.code)) e.preventDefault()
  })
  window.addEventListener('keyup', (e: KeyboardEvent) => {
    held.delete(e.code)
  })

  const any = (codes: readonly string[]): boolean => codes.some((c) => held.has(c))

  return {
    sample(): Input {
      return {
        left: any(KEYS.left),
        right: any(KEYS.right),
        thrust: any(KEYS.thrust),
        fire: any(KEYS.fire),
        hyperspace: any(KEYS.hyperspace),
      }
    },
  }
}
