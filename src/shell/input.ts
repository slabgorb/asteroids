// src/shell/input.ts
//
// A-5: keyboard → Input capture. The pure core consumes the abstract Input shape
// (core/input.ts); this shell controller is the ONLY place raw browser key events
// are read. It tracks the currently-held keys and hands the loop a fresh Input
// snapshot each frame via sample(). Mirrors the sibling games' input controller
// (star-wars/src/shell/input.ts).
//
// A2-4 adds mouse controls: left button fires, right button triggers
// hyperspace, ORed with the existing keyboard state. Mousedown/contextmenu
// bind to `target` (the canvas); mouseup/blur bind to `window` so a release
// off-canvas or a lost-focus alt-tab still clears a held button — mirrors
// tempest's `createInputController(target)` pattern.

import type { Input } from '../core/input'

export interface InputController {
  /** A fresh Input reflecting the keys held this instant. */
  sample(): Input
}

// Cabinet controls: rotate left/right, thrust, fire, hyperspace, start. Arrow
// keys are primary; WASD + K are convenience alternates. Space doubles as fire
// AND start — safe because start is inert during play and fire is inert in
// attract/gameover (the sim gates each by mode); Enter is the start/confirm
// primary, matching the initials-entry confirm (A-16).
const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  thrust: ['ArrowUp', 'KeyW'],
  fire: ['Space', 'KeyK'],
  hyperspace: ['ArrowDown', 'KeyS', 'ShiftLeft', 'ShiftRight'],
  start: ['Enter', 'Space'],
} as const

// Keys the browser would otherwise scroll the page with — the cabinet owns them.
const SCROLL_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'])

const MOUSE_BUTTON = { left: 0, right: 2 } as const

/** Given how many consecutive sim-frames a rotate key has been held (0 = not
 * held, 1 = the frame it was first seen down), decide whether to emit rotation
 * this frame: one nudge on the press edge, silence through the hold-delay, then
 * continuous rotation once the key is held past the delay. This is what turns a
 * keyboard tap into a single ROM step while a hold still spins continuously
 * (A-20). Frames are counted by sample() ticks, so the decision is deterministic
 * in sim time, not wall-clock. */
export function shouldEmitRotate(framesHeld: number, delayFrames: number): boolean {
  if (framesHeld <= 0) return false
  if (framesHeld === 1) return true
  return framesHeld > delayFrames
}

export function createInputController(target: HTMLElement): InputController {
  const held = new Set<string>()
  let mouseFireHeld = false
  let mouseHyperspaceHeld = false

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    held.add(e.code)
    if (SCROLL_KEYS.has(e.code)) e.preventDefault()
  })
  window.addEventListener('keyup', (e: KeyboardEvent) => {
    held.delete(e.code)
  })

  target.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button === MOUSE_BUTTON.left) mouseFireHeld = true
    else if (e.button === MOUSE_BUTTON.right) mouseHyperspaceHeld = true
  })
  window.addEventListener('mouseup', (e: MouseEvent) => {
    if (e.button === MOUSE_BUTTON.left) mouseFireHeld = false
    else if (e.button === MOUSE_BUTTON.right) mouseHyperspaceHeld = false
  })
  // Right-click is hyperspace, not the OS context menu.
  target.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault()
  })
  // Losing focus (alt-tab) must release a held button, or it sticks "on".
  window.addEventListener('blur', () => {
    mouseFireHeld = false
    mouseHyperspaceHeld = false
  })

  const any = (codes: readonly string[]): boolean => codes.some((c) => held.has(c))

  return {
    sample(): Input {
      return {
        left: any(KEYS.left),
        right: any(KEYS.right),
        thrust: any(KEYS.thrust),
        fire: any(KEYS.fire) || mouseFireHeld,
        hyperspace: any(KEYS.hyperspace) || mouseHyperspaceHeld,
        start: any(KEYS.start),
      }
    },
  }
}
