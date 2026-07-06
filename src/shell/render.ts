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

import {
  WORLD_W,
  WORLD_H,
  type GameState,
  type Ship,
  type Rock,
  type Bullet,
  type Saucer,
  type ShipDebrisSegment,
  type Shrapnel,
} from '../core/state'
import { ROCK_HITBOX } from '../core/rocks'
import { shipHeading, shipVertices, SHIP_TAIL } from '../core/shipShape'
import { DEBRIS_LIFETIME_S } from '../core/shipDebris'
import { SHRAPNEL_LIFETIME_S } from '../core/shrapnel'
import { formatScore } from '../core/score'
import type { Input } from '../core/input'
import { marginRects, fitScale } from './margin'

const SHIP_COLOR = '#ffffff' // 1979 Asteroids is white-phosphor monochrome
const FLAME_COLOR = '#ffb454' // warm thrust flame (A-19 recalibrates palette)
const GLOW_BLUR = 8
const LINE_WIDTH = 2

// A2-1: the non-playable margin overlay. The play area is pure black (#000), so a
// *lightening* wash — not a dark one, which would vanish on black — frames the
// arena inside an off-4:3 window. Low alpha keeps it subtle; the HUD draws on top
// and stays crisp. Opacity is a feel value, calibrated in the dev server.
const MARGIN_MASK_COLOR = 'rgba(255, 255, 255, 0.06)'

// HUD / overlay type (A-16). Vector Battle is the vendored arcade face
// (shell/font.ts); Orbitron/monospace is the CSS fallback when it fails to load.
// The face is CAPS-ONLY — every string below renders uppercase.
const HUD_FONT = "700 22px 'Vector Battle', 'Orbitron', monospace"
const SMALL_FONT = "700 16px 'Vector Battle', 'Orbitron', monospace"
const BANNER_FONT = "900 48px 'Vector Battle', 'Orbitron', monospace"

// A2-2: inter-glyph tracking for the caps-only Vector Battle face — the thin
// vector strokes read as cramped at the canvas default (0). Expressed as ~0.1em
// and derived from each run's OWN px size (parsed from its font string) so every
// size — 16px small, 22px HUD, 48px banner — gets proportional spacing. Mirrors
// star-wars' glowText (shell/render.ts), the sibling that shares this face. A
// feel value; eyeballed in the dev server per the epic's render guardrail.
const HUD_TRACKING_EM = 0.1

// Attract overlay cadence: the ROM's pre-game routine cycles the PUSH START
// prompt with the high-score list; exact page timings are A-17's quarry, so
// this is a provisional 4s-per-page feel value. verify vs quarry (A-17).
const ATTRACT_CYCLE_TICKS = 240

// Life-icon geometry, screen px: a mini nose-up ship per reserve ship, in a row
// under the score readout. Provisional feel values — the glyph becomes the
// ROM-exact ship shape in A-17 and size/glow are calibrated in A-19.
// verify vs quarry (A-17).
const LIFE_ICON_H = 18
const LIFE_ICON_W = 12
const LIFE_ICON_GAP = 8

// Rock outline radius per tier, world lo-units: the collision half-extent
// (rocks.ts ROCK_HITBOX, 132/72/42) drawn ~30% proud, so rocks die a touch
// inside their outline — generous-to-player, the arcade feel. Provisional;
// A-17 ports the ROM-exact shape tables and calibrates size.
const ROCK_OUTLINE_SCALE = 1.3

// The four rock silhouettes (ROCK_SHAPE_VARIANT_COUNT = 4), unit-radius,
// hand-drawn lumpy polygons in the arcade style. Fixed per shapeVariant —
// rocks never rotate (ROM-confirmed, state.ts) and never change shape.
// Provisional until A-17 ports the ROM-exact tables.
const ROCK_VARIANTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [0.0, 1.0], [0.5, 0.75], [1.0, 0.4], [0.75, 0.0], [1.0, -0.45], [0.5, -1.0],
    [-0.05, -0.7], [-0.55, -0.95], [-1.0, -0.4], [-0.8, 0.15], [-1.0, 0.5], [-0.45, 0.95],
  ],
  [
    [-0.25, 1.0], [0.35, 0.8], [1.0, 0.5], [0.7, 0.1], [1.0, -0.3], [0.4, -0.95],
    [-0.1, -0.6], [-0.5, -1.0], [-0.95, -0.5], [-0.7, 0.0], [-1.0, 0.45],
  ],
  [
    [0.1, 1.0], [0.65, 0.7], [1.0, 0.25], [0.9, -0.35], [0.45, -0.9], [0.0, -0.65],
    [-0.45, -1.0], [-1.0, -0.55], [-0.75, -0.05], [-1.0, 0.4], [-0.5, 0.8],
  ],
  [
    [-0.05, 0.95], [0.45, 1.0], [0.95, 0.55], [0.65, 0.2], [1.0, -0.25], [0.6, -0.85],
    [0.1, -1.0], [-0.4, -0.8], [-0.9, -0.95], [-1.0, -0.3], [-0.85, 0.3], [-0.4, 0.65],
  ],
]

// A shot is a DVG point on the real cabinet; a tiny diamond reads as a glowing
// dot at our line weight. Radius in world lo-units (~2 screen px at 1024-wide).
const BULLET_RADIUS = 16

// Large-saucer silhouette dimensions, world lo-units — the classic lens hull
// with a domed canopy, a shade under twice the ship's width. Visual-only until
// A-13 lands saucer collisions; A-17 ports exact tables. y is world-up.
const SAUCER_HALF_W = 140
const SAUCER_HULL_TOP = 44
const SAUCER_HULL_BOTTOM = -40
const SAUCER_HULL_SHOULDER = 56
const SAUCER_CANOPY_HALF_W = 30
const SAUCER_CANOPY_TOP = 78

// Ship hull dimensions (NOSE/TAIL/HALF_WIDTH/NOTCH) live in core/shipShape.ts
// now — A2-5's core/shipDebris.ts needs the SAME geometry to fracture the
// ship that this file renders, so it is hoisted to one shared function
// rather than two independently-tuned copies (see shipShape.ts header).
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
 *  shallow centre notch on the tail. Vertices come from core/shipShape.ts — the
 *  SAME geometry core/shipDebris.ts fractures on death, by construction. */
function drawShip(ctx: CanvasRenderingContext2D, ship: Ship, view: View): void {
  const [nose, rightWing, notch, leftWing] = shipVertices(ship)
  strokePoly(
    ctx,
    [
      [nose.x, nose.y],
      [rightWing.x, rightWing.y],
      [notch.x, notch.y],
      [leftWing.x, leftWing.y],
    ],
    view,
    SHIP_COLOR,
    true,
  )
}

/** The thrust flame: a wedge trailing aft (opposite the nose), drawn only while
 *  thrust is held. Static shape — flicker is an A-19 feel concern. */
function drawFlame(ctx: CanvasRenderingContext2D, ship: Ship, view: View): void {
  const { fx, fy, px, py } = shipHeading(ship.dir)
  const { x, y } = ship.pos
  strokePoly(
    ctx,
    [
      [x - fx * SHIP_TAIL + px * FLAME_HALF, y - fy * SHIP_TAIL + py * FLAME_HALF], // aft-right
      [x - fx * (SHIP_TAIL + FLAME_LEN), y - fy * (SHIP_TAIL + FLAME_LEN)], // flame tip
      [x - fx * SHIP_TAIL - px * FLAME_HALF, y - fy * SHIP_TAIL - py * FLAME_HALF], // aft-left
    ],
    view,
    FLAME_COLOR,
    false,
  )
}

/** The ship's breakup debris (A2-5): each surviving segment as an independent
 *  glowing line, alpha-faded by its remaining life fraction so pieces fade out
 *  rather than popping away. */
function drawShipDebris(
  ctx: CanvasRenderingContext2D,
  segments: readonly ShipDebrisSegment[],
  view: View,
): void {
  for (const seg of segments) {
    const alpha = Math.max(0, Math.min(1, seg.life / DEBRIS_LIFETIME_S))
    const [sx1, sy1] = toScreen(seg.p1.x, seg.p1.y, view)
    const [sx2, sy2] = toScreen(seg.p2.x, seg.p2.y, view)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = SHIP_COLOR
    ctx.shadowColor = SHIP_COLOR
    ctx.shadowBlur = GLOW_BLUR
    ctx.lineWidth = LINE_WIDTH
    ctx.beginPath()
    ctx.moveTo(sx1, sy1)
    ctx.lineTo(sx2, sy2)
    ctx.stroke()
    ctx.restore()
  }
}

/** A2-8: the rock-break shrapnel (core/shrapnel.ts) — each dot a dim, glowing
 *  point that fades with its life. Deliberately DIMMER than the ship debris:
 *  the ROM lights shrapnel at intensity b=7 vs the ship fragments' b=12, so a
 *  low peak alpha (SHRAPNEL_DIM) reads as the "dim, subtle scatter" the story
 *  asks for. Exact dim/size are feel values, calibrated by eye in the dev
 *  server per the render house convention. */
const SHRAPNEL_DIM = 0.55 // peak alpha at full life — below the ship debris' 1.0
const SHRAPNEL_DOT_RADIUS = 1.5 // screen px; a small glowing point
function drawShrapnel(
  ctx: CanvasRenderingContext2D,
  particles: readonly Shrapnel[],
  view: View,
): void {
  for (const p of particles) {
    const alpha = SHRAPNEL_DIM * Math.max(0, Math.min(1, p.life / SHRAPNEL_LIFETIME_S))
    const [sx, sy] = toScreen(p.pos.x, p.pos.y, view)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = SHIP_COLOR
    ctx.shadowColor = SHIP_COLOR
    ctx.shadowBlur = GLOW_BLUR
    ctx.beginPath()
    ctx.arc(sx, sy, SHRAPNEL_DOT_RADIUS, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

/** One asteroid: its fixed shapeVariant silhouette scaled to its size tier,
 *  centred on its position. No rotation — rocks drift, never turn (state.ts). */
function drawRock(ctx: CanvasRenderingContext2D, rock: Rock, view: View): void {
  const radius = ROCK_HITBOX[rock.size] * ROCK_OUTLINE_SCALE
  const outline = ROCK_VARIANTS[rock.shapeVariant % ROCK_VARIANTS.length]
  const { x, y } = rock.pos
  strokePoly(
    ctx,
    outline.map(([ux, uy]) => [x + ux * radius, y + uy * radius] as const),
    view,
    SHIP_COLOR,
    true,
  )
}

/** A shot in flight: a tiny closed diamond that glows into a dot. Player and
 *  saucer shots draw alike — the cabinet is monochrome. */
function drawBullet(ctx: CanvasRenderingContext2D, bullet: Bullet, view: View): void {
  const { x, y } = bullet.pos
  strokePoly(
    ctx,
    [
      [x, y + BULLET_RADIUS],
      [x + BULLET_RADIUS, y],
      [x, y - BULLET_RADIUS],
      [x - BULLET_RADIUS, y],
    ],
    view,
    SHIP_COLOR,
    true,
  )
}

/** The large saucer (A-11): lens-shaped hull, domed canopy, and the waistline
 *  seam across the widest point. Axis-aligned — the saucer never banks. */
function drawSaucer(ctx: CanvasRenderingContext2D, saucer: Saucer, view: View): void {
  const { x, y } = saucer.pos
  // Hull: the closed six-point lens.
  strokePoly(
    ctx,
    [
      [x - SAUCER_HALF_W, y],
      [x - SAUCER_HULL_SHOULDER, y + SAUCER_HULL_TOP],
      [x + SAUCER_HULL_SHOULDER, y + SAUCER_HULL_TOP],
      [x + SAUCER_HALF_W, y],
      [x + SAUCER_HULL_SHOULDER, y + SAUCER_HULL_BOTTOM],
      [x - SAUCER_HULL_SHOULDER, y + SAUCER_HULL_BOTTOM],
    ],
    view,
    SHIP_COLOR,
    true,
  )
  // Canopy: an open dome sitting on the hull top.
  strokePoly(
    ctx,
    [
      [x - SAUCER_HULL_SHOULDER, y + SAUCER_HULL_TOP],
      [x - SAUCER_CANOPY_HALF_W, y + SAUCER_CANOPY_TOP],
      [x + SAUCER_CANOPY_HALF_W, y + SAUCER_CANOPY_TOP],
      [x + SAUCER_HULL_SHOULDER, y + SAUCER_HULL_TOP],
    ],
    view,
    SHIP_COLOR,
    false,
  )
  // Waistline: the seam across the widest point.
  strokePoly(
    ctx,
    [
      [x - SAUCER_HALF_W, y],
      [x + SAUCER_HALF_W, y],
    ],
    view,
    SHIP_COLOR,
    false,
  )
}

/** One glowing HUD text run at a screen-space position. */
function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  align: CanvasTextAlign,
): void {
  ctx.font = font
  // ~0.1em tracking off this run's px size (see HUD_TRACKING_EM). Every on-screen
  // text run flows through here, so setting it per call fully controls tracking;
  // it never bleeds to the vector strokes (letterSpacing affects text only).
  const px = /(\d+(?:\.\d+)?)px/.exec(font)
  ctx.letterSpacing = `${((px ? parseFloat(px[1]) : 16) * HUD_TRACKING_EM).toFixed(2)}px`
  ctx.textAlign = align
  ctx.fillStyle = SHIP_COLOR
  ctx.shadowColor = SHIP_COLOR
  ctx.shadowBlur = GLOW_BLUR
  ctx.fillText(text, x, y)
}

/** One mini nose-up ship glyph, screen px, for the reserve-lives row. */
function drawLifeIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.strokeStyle = SHIP_COLOR
  ctx.shadowColor = SHIP_COLOR
  ctx.shadowBlur = GLOW_BLUR
  ctx.lineWidth = LINE_WIDTH
  ctx.beginPath()
  ctx.moveTo(cx, cy - LIFE_ICON_H / 2) // nose
  ctx.lineTo(cx + LIFE_ICON_W / 2, cy + LIFE_ICON_H / 2) // right wing
  ctx.lineTo(cx, cy + LIFE_ICON_H / 4) // tail notch
  ctx.lineTo(cx - LIFE_ICON_W / 2, cy + LIFE_ICON_H / 2) // left wing
  ctx.closePath()
  ctx.stroke()
}

/** The always-on HUD (A-16, the first story to draw score/lives at all): the
 *  current score, the running high score — the max of the persisted board's top
 *  entry and the live run, so beating the board updates the readout in place —
 *  and a mini-ship per reserve life. */
function drawHud(ctx: CanvasRenderingContext2D, state: GameState, w: number): void {
  const scoreX = w * 0.25
  drawText(ctx, formatScore(state.score), scoreX, 44, HUD_FONT, 'right')
  const highest = Math.max(state.highScoreTable[0]?.score ?? 0, state.score)
  drawText(ctx, formatScore(highest), w / 2, 32, SMALL_FONT, 'center')
  for (let i = 0; i < state.lives; i++) {
    drawLifeIcon(ctx, scoreX - LIFE_ICON_W / 2 - i * (LIFE_ICON_W + LIFE_ICON_GAP), 64)
  }
}

/** The attract overlay, cycling the start prompt with the high-score board the
 *  way the ROM's pre-game routine pages between them. */
function drawAttractOverlay(ctx: CanvasRenderingContext2D, state: GameState, w: number, h: number): void {
  const page = Math.floor(state.tick / ATTRACT_CYCLE_TICKS) % 2
  if (page === 0 || state.highScoreTable.length === 0) {
    drawText(ctx, 'ASTEROIDS', w / 2, h * 0.4, BANNER_FONT, 'center')
    drawText(ctx, 'PUSH START', w / 2, h * 0.55, HUD_FONT, 'center')
    return
  }
  drawText(ctx, 'HIGH SCORES', w / 2, h * 0.3, HUD_FONT, 'center')
  state.highScoreTable.forEach((entry, i) => {
    const row = `${String(i + 1).padStart(2, ' ')}  ${entry.name}  ${formatScore(entry.score)}`
    drawText(ctx, row, w / 2, h * 0.3 + (i + 1) * 26, SMALL_FONT, 'center')
  })
}

/** The game-over overlay: the GAME OVER card, plus the initials-entry prompt
 *  (typed letters echoed with underscore placeholders) on the qualifying path. */
function drawGameOverOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  w: number,
  h: number,
): void {
  drawText(ctx, 'GAME OVER', w / 2, h * 0.4, BANNER_FONT, 'center')
  const over = state.gameOver
  if (over === null || !over.qualifies) return
  drawText(ctx, 'YOUR SCORE IS ONE OF THE TEN BEST', w / 2, h * 0.52, SMALL_FONT, 'center')
  drawText(ctx, 'PLEASE ENTER YOUR INITIALS', w / 2, h * 0.57, SMALL_FONT, 'center')
  const echo = `${over.initials}${'_'.repeat(3 - over.initials.length)}`
  drawText(ctx, echo, w / 2, h * 0.65, BANNER_FONT, 'center')
}

/** Overlay the non-playable margin (letterbox/pillarbox bars) with a faint light
 *  wash so the black play area reads as a clearly bounded arena. Drawn after the
 *  world and before the HUD, so it frames the arena without dimming HUD text. A
 *  flat fill — no glow. */
function drawMarginMask(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save()
  ctx.shadowBlur = 0
  ctx.fillStyle = MARGIN_MASK_COLOR
  for (const bar of marginRects(w, h)) ctx.fillRect(bar.x, bar.y, bar.w, bar.h)
  ctx.restore()
}

/** Paint one frame: a fresh black field, then rocks, the saucer (when live),
 *  shots, and the ship on top — with the thrust flame when the current input is
 *  thrusting — then the HUD and the mode overlay. In attract the ship is absent
 *  (the field is a rocks-only backdrop, A-16); in play a destroyed ship (A-8's
 *  sticky latch) leaves the drawn set until A-15 respawns it. Pure over `state`
 *  — reads, never writes. */
export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  w: number,
  h: number,
  input: Input,
): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)

  const view: View = { w, h, scale: fitScale(w, h) }
  for (const rock of state.rocks) drawRock(ctx, rock, view)
  if (state.saucer) drawSaucer(ctx, state.saucer, view)
  for (const bullet of state.bullets) drawBullet(ctx, bullet, view)
  drawShipDebris(ctx, state.shipDebris, view)
  drawShrapnel(ctx, state.shrapnel, view)
  // A-14: `ship.visible` is false while a hyperspace jump is in flight — the ship
  // (and its flame) vanish for the reappearance window, then pop back at the new
  // spot. Skipping the draw here is the whole visual of a hyperspace jump.
  if (state.mode !== 'attract' && !state.shipDestroyed && state.ship.visible) {
    drawShip(ctx, state.ship, view)
    if (input.thrust) drawFlame(ctx, state.ship, view)
  }

  drawMarginMask(ctx, w, h)
  drawHud(ctx, state, w)
  if (state.mode === 'attract') drawAttractOverlay(ctx, state, w, h)
  if (state.mode === 'gameover') drawGameOverOverlay(ctx, state, w, h)
}
