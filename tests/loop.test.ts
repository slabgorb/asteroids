// tests/loop.test.ts
//
// AC-4: createLoop drains the accumulator in fixed dt slices regardless of the
// wall-clock gap between frames, and clamps a single oversized frame gap to
// 0.25s so a backgrounded tab cannot spiral into a catch-up death loop.
//
// The loop is the ONE place wall-clock time is read (via requestAnimationFrame's
// `now` timestamp, in milliseconds). We drive it deterministically by stubbing
// requestAnimationFrame/cancelAnimationFrame and invoking the captured callback
// with hand-picked `now` values. Both the bare globals and a `window` mirror are
// stubbed so a verbatim star-wars port (bare rAF or window.rAF) runs unchanged
// in the node test environment — no jsdom required.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLoop } from '../src/shell/loop'

type FrameCb = (now: number) => void

function makeRaf() {
  let queue: FrameCb[] = []
  let nextId = 1
  const raf = vi.fn((cb: FrameCb) => {
    queue.push(cb)
    return nextId++
  })
  const caf = vi.fn((_id: number) => {})
  // One animation frame: run every callback queued so far with `now` (ms).
  // Callbacks re-queue themselves for the next frame, so snapshot first.
  function frame(now: number): void {
    const pending = queue
    queue = []
    for (const cb of pending) cb(now)
  }
  return { raf, caf, frame }
}

let env: ReturnType<typeof makeRaf>

beforeEach(() => {
  env = makeRaf()
  vi.stubGlobal('requestAnimationFrame', env.raf)
  vi.stubGlobal('cancelAnimationFrame', env.caf)
  vi.stubGlobal('window', {
    requestAnimationFrame: env.raf,
    cancelAnimationFrame: env.caf,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// hz = 50 → dt = 0.02s = 20ms. Chosen so the expected step counts fall clear of
// integer boundaries (floor(8.5)=8, floor(12.5)=12) and stay float-safe.
const HZ = 50

describe('createLoop — lifecycle', () => {
  it('requests an animation frame on start()', () => {
    const loop = createLoop(vi.fn(), vi.fn(), HZ)
    loop.start()
    expect(env.raf).toHaveBeenCalled()
  })

  it('cancels the pending frame on stop()', () => {
    const loop = createLoop(vi.fn(), vi.fn(), HZ)
    loop.start()
    env.frame(0)
    loop.stop()
    expect(env.caf).toHaveBeenCalled()
  })
})

describe('createLoop — fixed-timestep drain (AC-4)', () => {
  it('runs floor(elapsed / dt) steps across sub-clamp frames', () => {
    const step = vi.fn()
    const loop = createLoop(step, vi.fn(), HZ)
    loop.start()
    env.frame(0) // baseline
    env.frame(90) // +90ms
    env.frame(170) // +80ms → total 170ms since baseline
    // floor(0.170 / 0.02) = floor(8.5) = 8, independent of how the elapsed
    // time was split across frames (remainder carries in the accumulator).
    expect(step).toHaveBeenCalledTimes(8)
  })

  it('accumulates sub-dt frames instead of resetting them', () => {
    const step = vi.fn()
    const loop = createLoop(step, vi.fn(), HZ)
    loop.start()
    env.frame(0)
    env.frame(10) // +10ms < 20ms → not enough for a step yet
    expect(step).toHaveBeenCalledTimes(0)
    env.frame(25) // +15ms → total 25ms → one full dt drained
    expect(step).toHaveBeenCalledTimes(1)
  })

  it('clamps a single oversized frame gap to 0.25s', () => {
    const step = vi.fn()
    const loop = createLoop(step, vi.fn(), HZ)
    loop.start()
    env.frame(0)
    env.frame(1000) // +1000ms, but clamped to 250ms
    // floor(0.25 / 0.02) = floor(12.5) = 12 — NOT floor(1.0 / 0.02) = 50.
    expect(step).toHaveBeenCalledTimes(12)
  })
})

describe('createLoop — rendering', () => {
  it('renders once per animation frame', () => {
    const render = vi.fn()
    const loop = createLoop(vi.fn(), render, HZ)
    loop.start()
    env.frame(0)
    env.frame(20)
    env.frame(40)
    expect(render).toHaveBeenCalledTimes(3)
  })

  it('passes an interpolation alpha in [0, 1) to render', () => {
    const render = vi.fn()
    const loop = createLoop(vi.fn(), render, HZ)
    loop.start()
    env.frame(0)
    env.frame(30) // 30ms → one 20ms step drained, 10ms remainder → alpha = 0.5
    const lastAlpha = render.mock.calls.at(-1)?.[0]
    expect(typeof lastAlpha).toBe('number')
    expect(lastAlpha).toBeGreaterThanOrEqual(0)
    expect(lastAlpha).toBeLessThan(1)
  })
})
