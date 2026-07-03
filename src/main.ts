// src/main.ts
//
// Bootstrap: owns the canvas and wires the shell's fixed-timestep loop to the
// pure core. `step` advances `GameState` through `stepGame`; `render` is a
// stub for this story (A-5 does real rendering) — it just re-draws the A-1
// placeholder ship triangle so the tab isn't blank. No input capture yet
// (NO_INPUT stands in); that arrives with A-3+.

import { createLoop } from './shell/loop'
import { initialState } from './core/state'
import { stepGame } from './core/sim'
import { NO_INPUT } from './core/input'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

let state = initialState()

function draw(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const W = window.innerWidth
  const H = window.innerHeight
  canvas.width = Math.floor(W * dpr)
  canvas.height = Math.floor(H * dpr)
  canvas.style.width = `${W}px`
  canvas.style.height = `${H}px`

  ctx.save()
  ctx.scale(dpr, dpr)

  // Black field.
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  // Placeholder ship: a glowing vector triangle at screen centre, nose up.
  const cx = W / 2
  const cy = H / 2
  const r = 24
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.shadowColor = '#ffffff'
  ctx.shadowBlur = 8
  ctx.beginPath()
  ctx.moveTo(cx, cy - r) // nose
  ctx.lineTo(cx + r * 0.7, cy + r) // right tail
  ctx.lineTo(cx, cy + r * 0.5) // notch
  ctx.lineTo(cx - r * 0.7, cy + r) // left tail
  ctx.closePath()
  ctx.stroke()

  ctx.restore()
}

window.addEventListener('resize', draw)
draw()

const loop = createLoop(
  (dt) => {
    state = stepGame(state, NO_INPUT, dt)
  },
  () => {
    draw()
  },
)
loop.start()
