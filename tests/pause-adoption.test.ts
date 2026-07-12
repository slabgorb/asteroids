// tests/pause-adoption.test.ts
//
// Story SH2-14 (epic SH2) — RED phase (Furiosa / TEA). asteroids GAINS a pause:
// today only battlezone pauses, and SH2-12 published the shared mechanism as two
// @arcade/shared subpaths — PURE `/pause` (INITIAL_PAUSED / isPauseKey /
// togglePaused / the generic `stepUnlessPaused<S>(step, prev, paused)` thunk gate)
// and BROWSER `/esc-overlay` (drawEscOverlay: dim + centred keybind card via the
// shared font). This story wires asteroids onto them: an Escape keydown EDGE
// toggles pause, the frozen-frame gate holds the sim, and drawEscOverlay draws
// over the held world — with asteroids supplying its OWN keybind card + colour
// (per-cabinet NUMBERS), per the epic's share-the-VERB-not-the-NUMBERS rule.
//
// The live pause BEHAVIOUR (keydown edge → freeze → overlay in the rAF loop) is
// AC-5, a MANUAL run — the keydown+rAF wiring has no unit seam (the standing
// "shell IO is verified by running the game" convention; see bz2-5). So the
// automated RED drivers pin the WIRING + the dep-pin CONTRACT:
//   1. adoption   — some src module imports @arcade/shared/pause (fails: none does).
//   2. overlay    — some src module imports @arcade/shared/esc-overlay (fails: none).
//   3. resolution — asteroids' pin resolves both subpaths with the expected exports
//                   (asteroids is already pinned ≥ v0.9.0, so this is the standing
//                   contract; it fails if a regression pin drops the subpaths).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))

/** Every .ts file under src/. */
function walkTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = `${dir}/${entry}`
    if (statSync(p).isDirectory()) out.push(...walkTs(p))
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

function importersOf(pattern: RegExp): string[] {
  return walkTs(srcDir)
    .filter((f) => pattern.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(srcDir.length + 1))
}

const PAUSE_IMPORT = /['"]@arcade\/shared\/pause['"]/
const ESC_OVERLAY_IMPORT = /['"]@arcade\/shared\/esc-overlay['"]/

// Runtime-only resolution: keep the specifiers out of Vite's static analysis so an
// unresolvable subpath surfaces as ONE failing test, not a module-graph crash.
const PAUSE_SUBPATH = '@arcade/shared/pause'
const ESC_OVERLAY_SUBPATH = '@arcade/shared/esc-overlay'

interface SharedPauseModule {
  INITIAL_PAUSED: boolean
  isPauseKey: (key: string) => boolean
  togglePaused: (paused: boolean) => boolean
  stepUnlessPaused: <S>(step: () => S, prev: S, paused: boolean) => S
}
interface SharedEscOverlayModule {
  drawEscOverlay: (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    opts: { lines: readonly string[]; color: string; opacity: number },
  ) => void
}

describe('SH2-14 — asteroids adopts @arcade/shared/pause + /esc-overlay (AC-1, AC-2)', () => {
  it('a src module imports the shared pause gate', () => {
    expect(
      importersOf(PAUSE_IMPORT),
      'no src file imports @arcade/shared/pause — asteroids has not wired the pause gate',
    ).not.toHaveLength(0)
  })

  it('a src module imports the shared esc-overlay', () => {
    expect(
      importersOf(ESC_OVERLAY_IMPORT),
      'no src file imports @arcade/shared/esc-overlay — asteroids draws no pause overlay',
    ).not.toHaveLength(0)
  })

  it('the pinned @arcade/shared resolves /pause with the full gate API', async () => {
    const pause = (await import(/* @vite-ignore */ PAUSE_SUBPATH)) as unknown as SharedPauseModule
    expect(pause.INITIAL_PAUSED, 'the cabinet boots into play, not frozen').toBe(false)
    expect(typeof pause.isPauseKey, 'isPauseKey must be exported').toBe('function')
    expect(typeof pause.togglePaused, 'togglePaused must be exported').toBe('function')
    expect(typeof pause.stepUnlessPaused, 'stepUnlessPaused thunk gate must be exported').toBe('function')
    // The shared thunk gate: paused ⇒ same reference, step never called.
    const prev = { tag: 'held' }
    let stepCalls = 0
    const held = pause.stepUnlessPaused(() => { stepCalls++; return { tag: 'advanced' } }, prev, true)
    expect(held, 'a paused frame must return the prior state reference untouched').toBe(prev)
    expect(stepCalls, 'a paused frame must not call the step thunk').toBe(0)
  })

  it('the pinned @arcade/shared resolves /esc-overlay with drawEscOverlay', async () => {
    const overlay = (await import(/* @vite-ignore */ ESC_OVERLAY_SUBPATH)) as unknown as SharedEscOverlayModule
    expect(typeof overlay.drawEscOverlay, 'drawEscOverlay must be exported by @arcade/shared/esc-overlay').toBe('function')
  })
})
