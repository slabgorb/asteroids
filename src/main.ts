// src/main.ts
//
// Wave-0 scaffold bootstrap (story A-1). Own the canvas, size it to the window,
// fill it black, and stroke one placeholder vector shape — a small ship triangle
// — so hitting http://localhost:5275/asteroids/ shows a glowing outline instead
// of a blank tab. No input loop, no game state, no simulation: those arrive in
// A-2, split across the pure core/ (sim/state/rng) and the shell/ (render/io)
// per the epic's hard core/shell boundary.

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

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
