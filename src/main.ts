// src/main.ts
//
// Bootstrap: own the canvas and wire the shell (keyboard input + fixed-timestep
// loop + vector renderer) to the pure core. A-5 makes the cabinet playable — the
// ship the core has simulated since A-3 is finally drawn, and real keys drive it.
// Through A-4 the sim ran headless behind NO_INPUT with a placeholder triangle;
// now `render()` paints the live GameState and `createInputController` feeds real
// rotate/thrust/fire/hyperspace into `stepGame`.

import { createLoop } from './shell/loop'
import { initialState, type GameState } from './core/state'
import { stepGame } from './core/sim'
import type { Input } from './core/input'
import { createInputController } from './shell/input'
import { render } from './shell/render'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

let dpr = Math.min(2, window.devicePixelRatio || 1)
let W = window.innerWidth
let H = window.innerHeight

function resize(): void {
  dpr = Math.min(2, window.devicePixelRatio || 1)
  W = window.innerWidth
  H = window.innerHeight
  canvas.width = Math.floor(W * dpr)
  canvas.height = Math.floor(H * dpr)
  canvas.style.width = `${W}px`
  canvas.style.height = `${H}px`
}
window.addEventListener('resize', resize)
resize()

const input = createInputController()
// PROVISIONAL (A-16 replaces this): boot straight into play. initialState()
// boots 'attract' and nothing transitions out of it until A-16 lands the
// attract/start flow — but the wave and saucer directors and collisions all
// gate on 'playing' (waves.ts updateWaveDirector), so an attract boot is a
// rockless field forever. A-16 swaps this for the real attract→start flow.
let state: GameState = { ...initialState(), mode: 'playing' }
// The renderer needs the frame's input to draw the thrust flame — the pure core
// carries no "thrusting" flag (GameState.ship is pos/vel/dir only). Sample once
// per fixed step and reuse in render; seeded with an all-false sample so the
// first frame (which runs before any step) already has a value.
let frameInput: Input = input.sample()

const loop = createLoop(
  (dt) => {
    frameInput = input.sample()
    state = stepGame(state, frameInput, dt)
  },
  () => {
    ctx.save()
    ctx.scale(dpr, dpr)
    render(ctx, state, W, H, frameInput)
    ctx.restore()
  },
)
loop.start()
