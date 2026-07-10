// tests/input-controller.test.ts
//
// A2-4: mouse controls — left button fires, right button triggers hyperspace,
// and the browser's context menu is suppressed on the game canvas so a
// right-click reads as a game input instead of popping the OS/browser menu.
//
// createInputController() currently takes no argument; this story adds mouse
// support and requires a bind target (the canvas), mirroring the sibling
// games' pattern (tempest's `createInputController(target: HTMLElement)`).
// The suite runs in the 'node' env (no jsdom), so — matching
// tests/loop.test.ts and tempest/tests/shell/input.test.ts — we drive the
// controller with fake EventTarget stubs instead of real DOM events.
//
// The keyboard tests here are a regression pin: this story's signature
// change touches the one function that owns ALL keyboard input, so pinning
// the pre-existing key map guards against an accidental regression while
// mouse support is bolted on.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createInputController, shouldEmitRotate } from '../src/shell/input'

function makeBus() {
  const handlers: Record<string, ((e: unknown) => void)[]> = {}
  return {
    addEventListener(type: string, cb: (e: unknown) => void) {
      ;(handlers[type] ||= []).push(cb)
    },
    emit(type: string, event: Record<string, unknown> = {}) {
      const e = { preventDefault() {}, ...event }
      ;(handlers[type] || []).forEach((cb) => cb(e))
      return e
    },
  }
}

let target: ReturnType<typeof makeBus>
let windowBus: ReturnType<typeof makeBus>

beforeEach(() => {
  target = makeBus()
  windowBus = makeBus()
  vi.stubGlobal('window', windowBus)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function build() {
  return createInputController(target as unknown as HTMLElement)
}

describe('createInputController — keyboard (regression pin)', () => {
  it('is fully at rest before any event fires', () => {
    const ctrl = build()
    const sample = ctrl.sample()
    expect(Object.values(sample).every((v) => v === false)).toBe(true)
  })

  it.each([
    ['left', 'ArrowLeft'],
    ['left', 'KeyA'],
    ['right', 'ArrowRight'],
    ['right', 'KeyD'],
    ['thrust', 'ArrowUp'],
    ['thrust', 'KeyW'],
    ['fire', 'Space'],
    ['fire', 'KeyK'],
    ['hyperspace', 'ArrowDown'],
    ['hyperspace', 'KeyS'],
    ['hyperspace', 'ShiftLeft'],
    ['hyperspace', 'ShiftRight'],
    ['start', 'Enter'],
  ] as const)('%s responds to keydown/keyup of %s', (field, code) => {
    const ctrl = build()
    windowBus.emit('keydown', { code })
    expect(ctrl.sample()[field], `${field} should be true while ${code} is held`).toBe(true)

    windowBus.emit('keyup', { code })
    expect(ctrl.sample()[field], `${field} should be false after ${code} is released`).toBe(false)
  })
})

describe('createInputController — left mouse button fires (AC-1)', () => {
  it('sets fire while the left button is held on the target', () => {
    const ctrl = build()
    target.emit('mousedown', { button: 0 })
    expect(ctrl.sample().fire).toBe(true)
  })

  it('clears fire once the left button is released', () => {
    const ctrl = build()
    target.emit('mousedown', { button: 0 })
    expect(ctrl.sample().fire).toBe(true)

    windowBus.emit('mouseup', { button: 0 })
    expect(ctrl.sample().fire).toBe(false)
  })

  it('releases fire even when the button-up lands outside the canvas (drag-off)', () => {
    // mouseup is bound on window, not the target, precisely so a press that
    // started on the canvas but was released elsewhere on the page still
    // clears — otherwise fire sticks "on" until the next click.
    const ctrl = build()
    target.emit('mousedown', { button: 0 })
    ctrl.sample()
    windowBus.emit('mouseup', { button: 0 })
    expect(ctrl.sample().fire).toBe(false)
  })
})

describe('createInputController — left mouse button also starts a game (out-of-band)', () => {
  // The left button already feeds `fire`; it now doubles as `start` too — the
  // exact mirror of how Space doubles as fire AND start. Safe because the sim
  // gates each by mode (start is inert during play, fire in attract/gameover),
  // so a single click begins a game from attract without any mode plumbing here.
  it('sets start while the left button is held on the target', () => {
    const ctrl = build()
    target.emit('mousedown', { button: 0 })
    expect(ctrl.sample().start).toBe(true)
  })

  it('clears start once the left button is released', () => {
    const ctrl = build()
    target.emit('mousedown', { button: 0 })
    expect(ctrl.sample().start).toBe(true)

    windowBus.emit('mouseup', { button: 0 })
    expect(ctrl.sample().start).toBe(false)
  })

  it('the right button does not start a game — only the left click does', () => {
    const ctrl = build()
    target.emit('mousedown', { button: 2 })
    expect(ctrl.sample().start, 'right button is hyperspace, not start').toBe(false)
  })
})

describe('createInputController — right mouse button triggers hyperspace (AC-2)', () => {
  it('sets hyperspace while the right button is held on the target', () => {
    const ctrl = build()
    target.emit('mousedown', { button: 2 })
    expect(ctrl.sample().hyperspace).toBe(true)
  })

  it('clears hyperspace once the right button is released', () => {
    const ctrl = build()
    target.emit('mousedown', { button: 2 })
    expect(ctrl.sample().hyperspace).toBe(true)

    windowBus.emit('mouseup', { button: 2 })
    expect(ctrl.sample().hyperspace).toBe(false)
  })
})

describe('createInputController — right-click context menu suppressed (AC-3)', () => {
  it('prevents the default context menu on the target', () => {
    build()
    let prevented = false
    target.emit('contextmenu', {
      preventDefault() {
        prevented = true
      },
    })
    expect(prevented, 'contextmenu must be preventDefault()-ed').toBe(true)
  })
})

describe('createInputController — button discrimination (guard)', () => {
  it('ignores the middle button — no fire, no hyperspace', () => {
    const ctrl = build()
    target.emit('mousedown', { button: 1 })
    const sample = ctrl.sample()
    expect(sample.fire).toBe(false)
    expect(sample.hyperspace).toBe(false)
  })

  it('a right-button mouseup does not clear a left-button fire still held', () => {
    const ctrl = build()
    target.emit('mousedown', { button: 0 })
    target.emit('mousedown', { button: 2 })
    windowBus.emit('mouseup', { button: 2 })
    const sample = ctrl.sample()
    expect(sample.fire, 'left button still held — fire must stay true').toBe(true)
    expect(sample.hyperspace, 'right button released — hyperspace must clear').toBe(false)
  })
})

describe('createInputController — mouse and keyboard combine without interference', () => {
  it('keeps fire true from the keyboard after the mouse button is released', () => {
    const ctrl = build()
    target.emit('mousedown', { button: 0 })
    windowBus.emit('keydown', { code: 'Space' })
    expect(ctrl.sample().fire).toBe(true)

    windowBus.emit('mouseup', { button: 0 })
    expect(ctrl.sample().fire, 'Space is still held — fire stays true').toBe(true)

    windowBus.emit('keyup', { code: 'Space' })
    expect(ctrl.sample().fire, 'both released — fire clears').toBe(false)
  })

  it('keeps hyperspace true from the mouse after the hyperspace key is released', () => {
    const ctrl = build()
    windowBus.emit('keydown', { code: 'ShiftLeft' })
    target.emit('mousedown', { button: 2 })
    expect(ctrl.sample().hyperspace).toBe(true)

    windowBus.emit('keyup', { code: 'ShiftLeft' })
    expect(ctrl.sample().hyperspace, 'right mouse button still held').toBe(true)

    windowBus.emit('mouseup', { button: 2 })
    expect(ctrl.sample().hyperspace, 'both released — hyperspace clears').toBe(false)
  })
})

describe('createInputController — window blur releases held mouse buttons (guard)', () => {
  it('clears fire and hyperspace on blur so a held button cannot stick across an alt-tab', () => {
    const ctrl = build()
    target.emit('mousedown', { button: 0 })
    target.emit('mousedown', { button: 2 })
    expect(ctrl.sample().fire).toBe(true)
    expect(ctrl.sample().hyperspace).toBe(true)

    windowBus.emit('blur')
    const sample = ctrl.sample()
    expect(sample.fire, 'blur must release a held left button').toBe(false)
    expect(sample.hyperspace, 'blur must release a held right button').toBe(false)
  })
})

describe('shouldEmitRotate — tap vs hold decision (A-20)', () => {
  const DELAY = 12
  it('emits nothing when the key is not held', () => {
    expect(shouldEmitRotate(0, DELAY)).toBe(false)
    expect(shouldEmitRotate(-1, DELAY)).toBe(false)
  })
  it('emits a single nudge on the press frame', () => {
    expect(shouldEmitRotate(1, DELAY)).toBe(true)
  })
  it('stays silent through the hold-delay dwell', () => {
    for (let f = 2; f <= DELAY; f++) {
      expect(shouldEmitRotate(f, DELAY), `frame ${f} should dwell`).toBe(false)
    }
  })
  it('emits continuously once held past the delay', () => {
    expect(shouldEmitRotate(DELAY + 1, DELAY)).toBe(true)
    expect(shouldEmitRotate(DELAY + 50, DELAY)).toBe(true)
  })
})

describe('createInputController — rotate tap-to-nudge (A-20)', () => {
  const DELAY = 12
  function buildTuned() {
    return createInputController(target as unknown as HTMLElement, {
      turnRate: 3,
      tapHoldDelayFrames: DELAY,
    })
  }

  it('a tap (press, one sample, release) yields exactly one frame of rotation', () => {
    const ctrl = buildTuned()
    windowBus.emit('keydown', { code: 'ArrowLeft' })
    expect(ctrl.sample().left, 'press frame nudges').toBe(true)
    windowBus.emit('keyup', { code: 'ArrowLeft' })
    expect(ctrl.sample().left, 'released → rest').toBe(false)
  })

  it('a held key nudges once, dwells through the delay, then spins continuously', () => {
    const ctrl = buildTuned()
    windowBus.emit('keydown', { code: 'ArrowLeft' })
    expect(ctrl.sample().left, 'frame 1 nudge').toBe(true)
    for (let f = 2; f <= DELAY; f++) {
      expect(ctrl.sample().left, `frame ${f} dwell`).toBe(false)
    }
    expect(ctrl.sample().left, 'past delay → continuous').toBe(true)
    expect(ctrl.sample().left, 'still continuous').toBe(true)
  })

  it('registers one nudge for a sub-frame tap (press AND release between samples)', () => {
    const ctrl = buildTuned()
    windowBus.emit('keydown', { code: 'ArrowLeft' })
    windowBus.emit('keyup', { code: 'ArrowLeft' }) // released before any sample()
    expect(ctrl.sample().left, 'edge latch → one nudge').toBe(true)
    expect(ctrl.sample().left, 'then rest').toBe(false)
  })

  it('each fresh tap after a release nudges again', () => {
    const ctrl = buildTuned()
    windowBus.emit('keydown', { code: 'ArrowLeft' })
    expect(ctrl.sample().left).toBe(true)
    windowBus.emit('keyup', { code: 'ArrowLeft' })
    expect(ctrl.sample().left).toBe(false)
    windowBus.emit('keydown', { code: 'ArrowLeft' })
    expect(ctrl.sample().left, 'second tap nudges').toBe(true)
  })

  it('left and right track independently', () => {
    const ctrl = buildTuned()
    windowBus.emit('keydown', { code: 'ArrowRight' })
    const s = ctrl.sample()
    expect(s.right).toBe(true)
    expect(s.left).toBe(false)
  })
})
