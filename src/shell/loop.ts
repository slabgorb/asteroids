// src/shell/loop.ts
//
// Fixed-timestep loop. This is the ONLY place wall-clock time is read; it feeds
// the core a constant `dt` so the simulation stays deterministic and frame-rate
// independent. Rendering interpolates with the leftover accumulator `alpha`.
//
// Deviation from the star-wars pattern this was ported from: the source loop
// uses a `last === 0` check to detect "no prior frame yet". That sentinel is
// ambiguous — it can't tell "not started" apart from "the previous frame's
// timestamp genuinely was zero" — so a `started` flag stands in for it here.
// See the session's Design Deviations for the full writeup.

export type StepFn = (dt: number) => void
export type RenderFn = (alpha: number) => void

export interface Loop {
  start(): void
  stop(): void
}

export function createLoop(step: StepFn, render: RenderFn, hz = 60): Loop {
  const dt = 1 / hz
  let acc = 0
  let last = 0
  let started = false
  let raf = 0

  function frame(now: number): void {
    if (!started) {
      started = true
      last = now
    } else {
      acc += Math.min(0.25, (now - last) / 1000) // clamp huge tab-switch gaps
      last = now
    }
    while (acc >= dt) {
      step(dt)
      acc -= dt
    }
    render(acc / dt)
    raf = requestAnimationFrame(frame)
  }

  return {
    start(): void {
      acc = 0
      last = 0
      started = false
      raf = requestAnimationFrame(frame)
    },
    stop(): void {
      cancelAnimationFrame(raf)
    },
  }
}
