// tests/render-wiring.test.ts
//
// Story A-5 (RED) — wiring contracts for the render foundation. render.ts draws
// to a live canvas and main.ts owns the DOM/loop, so (like core-boundary.test.ts)
// the testable seam for "is it wired the right way?" is the source text on disk,
// read via readFileSync. These guard the architecture and the AC-5 "the game is
// visibly running and the keyboard drives the ship" contract that a mock-canvas
// unit test cannot reach — the full visual/input integration is eyeball-verified
// in the dev server, per the house convention (tempest/star-wars CLAUDE.md:
// "The shell (render/input/audio/loop) is verified by running the game").

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RENDER = fileURLToPath(new URL('../src/shell/render.ts', import.meta.url))
const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url))

const read = (p: string): string => readFileSync(p, 'utf8')

describe('render.ts — the shell renderer exists and stays a renderer (AC-1, boundary)', () => {
  it('src/shell/render.ts exists', () => {
    // RED until Dev creates the render module.
    expect(existsSync(RENDER), 'src/shell/render.ts must exist').toBe(true)
  })

  it('never advances the simulation — the renderer must not call stepGame', () => {
    expect(existsSync(RENDER)).toBe(true)
    const src = read(RENDER)
    // The render layer only READS core state and draws it. Stepping the sim in
    // the render path would double-advance the world and break determinism.
    expect(/\bstepGame\b/.test(src), 'render.ts must not call stepGame').toBe(false)
  })

  it('introduces no type-safety escapes (TS lang-review #1)', () => {
    expect(existsSync(RENDER)).toBe(true)
    const src = read(RENDER)
    expect(/\bas any\b/.test(src), 'render.ts must not use `as any`').toBe(false)
    expect(/@ts-ignore/.test(src), 'render.ts must not use @ts-ignore').toBe(false)
  })
})

describe('render.ts — draws every live entity class, not just the ship (playfield gap)', () => {
  // The sim has carried rocks (A-6), bullets (A-4), and the saucer (A-11) for
  // stories, but render() only ever stroked the ship — the cabinet LOOKED like
  // A-5 while simulating A-11. These contracts pin the renderer to reading each
  // entity collection; the shapes themselves are eyeball-verified per the house
  // convention above, and A-17/A-19 refine outlines/glow.
  it('reads state.rocks — asteroids must be drawn', () => {
    expect(existsSync(RENDER)).toBe(true)
    expect(/\bstate\.rocks\b/.test(read(RENDER)), 'render.ts must draw state.rocks').toBe(true)
  })

  it('reads state.bullets — shots must be drawn', () => {
    expect(existsSync(RENDER)).toBe(true)
    expect(/\bstate\.bullets\b/.test(read(RENDER)), 'render.ts must draw state.bullets').toBe(true)
  })

  it('reads state.saucer — the saucer must be drawn when live', () => {
    expect(existsSync(RENDER)).toBe(true)
    expect(/\bstate\.saucer\b/.test(read(RENDER)), 'render.ts must draw state.saucer').toBe(true)
  })

  it('respects shipDestroyed — a destroyed ship is out of the drawn set (A-8 latch)', () => {
    expect(existsSync(RENDER)).toBe(true)
    expect(
      /\bshipDestroyed\b/.test(read(RENDER)),
      'render.ts must gate the ship on state.shipDestroyed',
    ).toBe(true)
  })

  // A2-5 (Reviewer finding, rework): the renderer grew a new entity class
  // (shipDebris) with no wiring check extending this describe block's pattern
  // to it — a mutant deleting the drawShipDebris call would have passed every
  // existing test here.
  it('reads state.shipDebris — the ship breakup debris must be drawn', () => {
    expect(existsSync(RENDER)).toBe(true)
    expect(
      /\bstate\.shipDebris\b/.test(read(RENDER)),
      'render.ts must draw state.shipDebris',
    ).toBe(true)
  })

  // A2-8: the renderer grows another entity class (shrapnel — the dim, short-lived
  // scatter on every rock break). Mirror the shipDebris wiring guard so a mutant
  // dropping the drawShrapnel call is caught. The dots' exact "dim" brightness is a
  // render-fidelity / playtest knob, eyeball-verified per this file's header — this
  // only pins that the scatter is actually drawn.
  it('reads state.shrapnel — the rock-break debris scatter must be drawn', () => {
    expect(existsSync(RENDER)).toBe(true)
    expect(
      /\bstate\.shrapnel\b/.test(read(RENDER)),
      'render.ts must draw state.shrapnel',
    ).toBe(true)
  })

  // A-21: the saucer death breakup adds another entity class (saucerDebris — the
  // drifting, fading line segments a destroyed saucer fractures into). Mirror the
  // shipDebris/shrapnel wiring guards so a mutant dropping the draw call is caught.
  it('reads state.saucerDebris — the saucer breakup debris must be drawn', () => {
    expect(existsSync(RENDER)).toBe(true)
    expect(
      /\bstate\.saucerDebris\b/.test(read(RENDER)),
      'render.ts must draw state.saucerDebris',
    ).toBe(true)
  })

  // A-21: the saucer geometry must be a SINGLE SOURCE shared by the renderer and
  // the pure-core breakup (core/saucerDebris.ts fractures the exact rendered
  // shape). Like A2-5's shipShape.ts, it is hoisted into core/saucerShape.ts and
  // imported here — render.ts must NOT keep a private copy of the constants, or
  // the two silhouettes silently tune apart ("one function, not two parallel
  // copies" — bounds.ts's precedent).
  it('sources saucer geometry from core/saucerShape — no private copy of the constants', () => {
    expect(existsSync(RENDER)).toBe(true)
    const src = read(RENDER)
    expect(
      /from\s*['"]\.\.\/core\/saucerShape['"]/.test(src),
      "render.ts must import the saucer geometry from '../core/saucerShape'",
    ).toBe(true)
    expect(
      /\bconst\s+SAUCER_HALF_W\s*=/.test(src),
      'render.ts must not locally redeclare SAUCER_HALF_W — it belongs to core/saucerShape now',
    ).toBe(false)
  })
})

describe('main.ts — wires the renderer and real input (AC-1, AC-5)', () => {
  it('imports and drives the shell renderer (replacing the A-1 placeholder draw)', () => {
    expect(existsSync(MAIN)).toBe(true)
    const src = read(MAIN)
    expect(
      /from\s*['"]\.\/shell\/render['"]/.test(src),
      "main.ts must import from './shell/render'",
    ).toBe(true)
    expect(/\brender\s*\(/.test(src), 'main.ts must call render(...)').toBe(true)
  })

  it('feeds the core real keyboard input instead of the hardcoded NO_INPUT stub', () => {
    expect(existsSync(MAIN)).toBe(true)
    const src = read(MAIN)
    // Real input must be captured — either a keyboard listener or a shell input
    // controller (the sibling games' createInputController pattern).
    expect(
      /keydown|keyup|createInput|InputController|['"][^'"]*shell\/input['"]/.test(src),
      'main.ts must capture keyboard input',
    ).toBe(true)
    // ...and the step call must no longer be pinned to NO_INPUT, or the ship can
    // never move. (Current A-1 main.ts: `stepGame(state, NO_INPUT, dt)`.)
    expect(
      /stepGame\s*\([^)]*NO_INPUT/.test(src),
      'main.ts must not feed NO_INPUT to stepGame',
    ).toBe(false)
  })

  it("boots into attract — the A-11 force-play shim is gone (A-16 replaces the provisional contract)", () => {
    // The inverse of the contract this replaces: A-11's provisional
    // `{ ...initialState(), mode: 'playing' }` boot shim must NOT survive A-16 —
    // the sim now owns attract→start→playing (tests/modes.test.ts pins the
    // behaviour; this pins that main.ts stopped forcing the mode).
    expect(existsSync(MAIN)).toBe(true)
    expect(
      /mode:\s*['"]playing['"]/.test(read(MAIN)),
      "main.ts must not force the boot mode to 'playing' (A-16 attract flow)",
    ).toBe(false)
  })

  it('wires the A-16 framing: persisted board in, board changes out, letters to enterInitial', () => {
    expect(existsSync(MAIN)).toBe(true)
    const src = read(MAIN)
    expect(/\bloadHighScores\s*\(/.test(src), 'main.ts must load the board at boot').toBe(true)
    expect(/\bsaveHighScores\s*\(/.test(src), 'main.ts must persist board changes').toBe(true)
    expect(/\benterInitial\s*\(/.test(src), 'main.ts must feed letters to enterInitial').toBe(true)
    expect(/\bloadVectorFont\s*\(/.test(src), 'main.ts must kick off the HUD font load').toBe(true)
  })
})
