// src/main.ts
//
// Bootstrap: own the canvas and wire the shell (keyboard input + fixed-timestep
// loop + vector renderer) to the pure core. A-5 makes the cabinet playable — the
// ship the core has simulated since A-3 is finally drawn, and real keys drive it.
// A-16 closes the run lifecycle: the cabinet boots into attract for real, the
// persisted high-score board rides in GameState, letters feed the initials entry
// on a qualifying game-over, and any change to the board is written back to
// localStorage (where the lobby tile reads it).

import { createLoop } from '@arcade/shared/loop'
import { INITIAL_PAUSED, isPauseKey, togglePaused, stepUnlessPaused } from '@arcade/shared/pause'
import { drawEscOverlay } from '@arcade/shared/esc-overlay'
import { initialState, type GameState } from './core/state'
import { stepGame, enterInitial } from './core/sim'
import type { Input } from './core/input'
import { createInputController } from './shell/input'
import { createTuning, loadTuning } from './shell/tuning'
import { mountTuningPanel } from './shell/tuning-panel'
import { render } from './shell/render'
import { makeHighScoreStorage, makeHighScoreRowGuard } from '@arcade/shared/highscore'
import { createAudioEngine } from './shell/audio'
import { playEventSounds } from './shell/audio-dispatch'
import { resizeToDisplay } from '@arcade/shared/view'

// asteroids records the `wave` reached; the shared factory binds load/save to the
// 'asteroids-high-scores' localStorage key and validates each row's finite score +
// wave (the lobby reads the same key + shape — SH-4).
const highScoreStorage = makeHighScoreStorage('asteroids', makeHighScoreRowGuard('wave'))

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

// The DPR-resize + CSS-box sizing is @arcade/shared/view's resizeToDisplay (SH2-10),
// which owns the Math.min(2, devicePixelRatio||1) cap+guard every cabinet hand-rolled.
// The 4:3 world is fitted INSIDE this full-window canvas by render()'s view/margin
// (margin.ts), which now derives that fit from @arcade/shared/view's letterbox.
let W = window.innerWidth
let H = window.innerHeight
let dpr = 1 // real value set by resize() below, from the resolved ViewportSize

function resize(): void {
  const vp = resizeToDisplay(canvas, window.innerWidth, window.innerHeight, window.devicePixelRatio)
  W = vp.cssWidth
  H = vp.cssHeight
  dpr = vp.dpr
}
window.addEventListener('resize', resize)
resize()

const tuning = createTuning(loadTuning())
const input = createInputController(canvas, tuning)
const audio = createAudioEngine()
// Browsers forbid starting an AudioContext before a user gesture, so the engine
// stays inert until the first click/keypress unlocks it. resume() is idempotent,
// so leaving both listeners attached makes every later gesture a harmless no-op.
function unlockAudio(): void {
  audio.resume()
}
canvas.addEventListener('click', unlockAudio)
window.addEventListener('keydown', unlockAudio)
// Boot into attract for real (A-16 replaces A-11's provisional force-play shim):
// the sim now owns the attract→start→gameover loop, and the persisted board is
// threaded into core state where the qualify/insert logic reads it.
let state: GameState = { ...initialState(), highScoreTable: highScoreStorage.load() }
// Initials entry (A-16): typed letters are edge events, not held state, so they
// bypass the per-frame Input sample and feed the core's pure event function.
// enterInitial is inert outside a qualifying game-over, so no mode guard here.
// Backspace rides the same path (SH2-13): the shared reducer deletes on it.
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (/^[a-zA-Z]$/.test(e.key) || e.key === 'Backspace') state = enterInitial(state, e.key)
})

// SH2-14: Escape toggles pause via the shared @arcade/shared/pause gate — the
// cabinet-wide VERB. Edge, not level (guard e.repeat) so a held key can't
// machine-gun the toggle. The freeze itself is stepUnlessPaused in the loop below.
let paused = INITIAL_PAUSED
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (!e.repeat && isPauseKey(e.key.toLowerCase())) paused = togglePaused(paused)
})

// Per-cabinet NUMBERS for the pause card: asteroids' keybinds (arrow OR WASD; the
// card names the letter alternates so it needs no arrow glyphs the ROM font lacks),
// its white vector chrome, and the dim alpha. Copy/colour/opacity are playtest-tunable.
const ASTEROIDS_PAUSE = {
  lines: [
    'PAUSED',
    '',
    'ESC          RESUME',
    'A / D        ROTATE',
    'W            THRUST',
    'S            HYPERSPACE',
    'SPACE        FIRE',
    'ENTER        START',
  ],
  color: '#ffffff',
  opacity: 0.72,
} as const
// The renderer needs the frame's input to draw the thrust flame — the pure core
// carries no "thrusting" flag (GameState.ship is pos/vel/dir only). Sample once
// per fixed step and reuse in render; seeded with an all-false sample so the
// first frame (which runs before any step) already has a value.
let frameInput: Input = input.sample()

const loop = createLoop(
  (dt) => {
    // SH2-14: the frozen-frame gate. When paused, the thunk never runs — the sim
    // does not advance, no input is sampled, no sound plays, no save fires — and
    // stepUnlessPaused returns the prior state unchanged, so resume is deterministic.
    state = stepUnlessPaused(
      () => {
        frameInput = input.sample()
        const table = state.highScoreTable
        const stepped = stepGame(state, frameInput, dt, tuning.turnRate)
        // One sound per gameplay event the core emitted this frame (A-18). The
        // dispatch table lives in the pure, unit-tested shell/audio-dispatch
        // module so the wiring is tested behaviourally, not by a source text-match.
        playEventSounds(audio, stepped.events)
        // Persist the board the moment the core changes it (a confirmed entry) —
        // insertHighScore returns a NEW array, so reference identity is the signal.
        if (stepped.highScoreTable !== table) highScoreStorage.save(stepped.highScoreTable)
        return stepped
      },
      state,
      paused,
    )
  },
  () => {
    ctx.save()
    ctx.scale(dpr, dpr)
    render(ctx, state, W, H, frameInput)
    // SH2-14: the pause overlay dims the frozen field and draws the keybind card
    // over it — inside the dpr-scaled block so it shares render()'s CSS-pixel space.
    if (paused) drawEscOverlay(ctx, W, H, ASTEROIDS_PAUSE)
    ctx.restore()
  },
)
loop.start()

// A-20 dev-only rotation tuner: never mounted for normal players.
if (new URLSearchParams(location.search).has('tune')) mountTuningPanel(tuning)
