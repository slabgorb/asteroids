// src/shell/render.ts
//
// A-5: the vector render foundation. Paints the pure core's GameState as glowing
// vector lines on black — the shared arcade visual language. The shell owns the
// canvas; the core owns the sim. render() only READS state and strokes lines; it
// runs no game math and never advances the simulation — that is the loop's job.
//
// Coordinate system: the core's world is ROM lo-units (8192 x 6144 = 8 per screen
// pixel at 1024x768). We map it to the live canvas centred, at a uniform fit
// scale, and FLIP y — world +y is up, so the ship spawned at dir 64 ("pointing
// up", state.ts) renders nose-toward-the-top. Wrapping is a sim concern; the
// renderer just draws wherever the core placed things.
//
// The ship silhouette is faithful-but-provisional (a nose + two swept wings +
// centre notch); A-17 ports the ROM-exact shape table and A-19 calibrates
// glow/feel. Heading uses continuous trig off `dir` (a 256-unit circle, 0 = +x,
// CCW positive) — smoother for an outline than quantising through the coarse
// ThrustTbl, and it agrees with ship.ts's flight model at every heading.

import { WORLD_W, WORLD_H, type GameState, type Ship } from '../core/state'
import type { Input } from '../core/input'

const SHIP_COLOR = '#ffffff' // 1979 Asteroids is white-phosphor monochrome
const FLAME_COLOR = '#ffb454' // warm thrust flame (A-19 recalibrates palette)
const GLOW_BLUR = 8
const LINE_WIDTH = 2

// Ship silhouette dimensions, in world lo-units (~200 tip-to-tail → ~25px on a
// 1024-wide field). Provisional — see file header.
const NOSE = 130
const TAIL = 70
const HALF_WIDTH = 75
const NOTCH = 35
const FLAME_LEN = 90
const FLAME_HALF = 32

interface View {
  w: number
  h: number
  scale: number
}

/** World point → screen point: centre-anchored, uniform fit scale, y flipped so
 *  world +y draws toward the top of the screen. */
function toScreen(x: number, y: number, view: View): [number, number] {
  return [view.w / 2 + (x - WORLD_W / 2) * view.scale, view.h / 2 - (y - WORLD_H / 2) * view.scale]
}

/** Heading basis from `dir` (256-unit circle): forward unit vector (fx, fy) and
 *  its +90° perpendicular (px, py). At dir 64 forward is (0, 1) = world-up,
 *  matching the flight model (ship.ts thrusts +y at dir 64). */
function heading(dir: number): { fx: number; fy: number; px: number; py: number } {
  const theta = (dir / 256) * Math.PI * 2
  const fx = Math.cos(theta)
  const fy = Math.sin(theta)
  return { fx, fy, px: -fy, py: fx }
}

/** Stroke a world-space polyline as a glowing vector shape. */
function strokePoly(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<readonly [number, number]>,
  view: View,
  color: string,
  close: boolean,
): void {
  ctx.strokeStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = GLOW_BLUR
  ctx.lineWidth = LINE_WIDTH
  ctx.beginPath()
  pts.forEach(([wx, wy], i) => {
    const [sx, sy] = toScreen(wx, wy, view)
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  })
  if (close) ctx.closePath()
  ctx.stroke()
}

/** The player ship: nose forward along the heading, two swept-back wings, and a
 *  shallow centre notch on the tail. */
function drawShip(ctx: CanvasRenderingContext2D, ship: Ship, view: View): void {
  const { fx, fy, px, py } = heading(ship.dir)
  const { x, y } = ship.pos
  strokePoly(
    ctx,
    [
      [x + fx * NOSE, y + fy * NOSE], // nose
      [x - fx * TAIL + px * HALF_WIDTH, y - fy * TAIL + py * HALF_WIDTH], // right wing
      [x - fx * NOTCH, y - fy * NOTCH], // tail notch
      [x - fx * TAIL - px * HALF_WIDTH, y - fy * TAIL - py * HALF_WIDTH], // left wing
    ],
    view,
    SHIP_COLOR,
    true,
  )
}

/** The thrust flame: a wedge trailing aft (opposite the nose), drawn only while
 *  thrust is held. Static shape — flicker is an A-19 feel concern. */
function drawFlame(ctx: CanvasRenderingContext2D, ship: Ship, view: View): void {
  const { fx, fy, px, py } = heading(ship.dir)
  const { x, y } = ship.pos
  strokePoly(
    ctx,
    [
      [x - fx * TAIL + px * FLAME_HALF, y - fy * TAIL + py * FLAME_HALF], // aft-right
      [x - fx * (TAIL + FLAME_LEN), y - fy * (TAIL + FLAME_LEN)], // flame tip
      [x - fx * TAIL - px * FLAME_HALF, y - fy * TAIL - py * FLAME_HALF], // aft-left
    ],
    view,
    FLAME_COLOR,
    false,
  )
}

/** Paint one frame: a fresh black field, then the ship, then the thrust flame
 *  when the current input is thrusting. Pure over `state` — reads, never writes. */
export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  w: number,
  h: number,
  input: Input,
): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)

  const view: View = { w, h, scale: Math.min(w / WORLD_W, h / WORLD_H) }
  drawShip(ctx, state.ship, view)
  if (input.thrust) drawFlame(ctx, state.ship, view)
}
