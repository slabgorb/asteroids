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
// tempest's `createInputController(target)` pattern. The left button also
// doubles as start (like Space), so a click begins a game from attract.

import type { Input } from '../core/input'
import { DEFAULT_TUNING, type RotationTuning } from './tuning'

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

export function createInputController(
  target: HTMLElement,
  tuning: RotationTuning = DEFAULT_TUNING,
): InputController {
  const held = new Set<string>()
  let mouseFireHeld = false
  let mouseHyperspaceHeld = false

  // Tap-to-nudge state (A-20): consecutive sim-frames each rotate direction has
  // been held, advanced by sample() ticks (NOT wall-clock). The *Edge latches a
  // rising keydown so a tap that presses AND releases between two samples still
  // lands exactly one nudge frame.
  let leftFrames = 0
  let rightFrames = 0
  let leftEdge = false
  let rightEdge = false

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!held.has(e.code)) {
      if ((KEYS.left as readonly string[]).includes(e.code)) leftEdge = true
      if ((KEYS.right as readonly string[]).includes(e.code)) rightEdge = true
    }
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

  // Advance one rotate direction's frame counter for this sample and decide its
  // output. Held → increment (0→1 is the press edge, which nudges). Not held but
  // an edge latched since the last sample (sub-frame tap) → force a one-frame
  // nudge. Otherwise → released, reset to rest.
  const rotate = (
    codes: readonly string[],
    frames: number,
    edge: boolean,
  ): { frames: number; out: boolean } => {
    const next = any(codes) ? frames + 1 : edge ? 1 : 0
    return { frames: next, out: shouldEmitRotate(next, tuning.tapHoldDelayFrames) }
  }

  return {
    sample(): Input {
      const l = rotate(KEYS.left, leftFrames, leftEdge)
      const r = rotate(KEYS.right, rightFrames, rightEdge)
      leftFrames = l.frames
      rightFrames = r.frames
      leftEdge = false
      rightEdge = false
      return {
        left: l.out,
        right: r.out,
        thrust: any(KEYS.thrust),
        fire: any(KEYS.fire) || mouseFireHeld,
        hyperspace: any(KEYS.hyperspace) || mouseHyperspaceHeld,
        // The left mouse button doubles as start, exactly as Space does: fire
        // during play, start from attract/gameover — the sim gates each by mode.
        start: any(KEYS.start) || mouseFireHeld,
      }
    },
  }
}
