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
import { initialState, type GameState } from './core/state'
import { stepGame, enterInitial } from './core/sim'
import type { Input } from './core/input'
import { createInputController } from './shell/input'
import { createTuning, loadTuning } from './shell/tuning'
import { mountTuningPanel } from './shell/tuning-panel'
import { render } from './shell/render'
import { makeHighScoreStorage, makeHighScoreRowGuard } from '@arcade/shared/highscore'
import { loadVectorFont } from './shell/font'
import { createAudioEngine } from './shell/audio'
import { playEventSounds } from './shell/audio-dispatch'

// asteroids records the `wave` reached; the shared factory binds load/save to the
// 'asteroids-high-scores' localStorage key and validates each row's finite score +
// wave (the lobby reads the same key + shape — SH-4).
const highScoreStorage = makeHighScoreStorage('asteroids', makeHighScoreRowGuard('wave'))

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
// Best-effort: the HUD falls back to the CSS stack until/unless the face loads.
void loadVectorFont()
// Initials entry (A-16): typed letters are edge events, not held state, so they
// bypass the per-frame Input sample and feed the core's pure event function.
// enterInitial is inert outside a qualifying game-over, so no mode guard here.
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (/^[a-zA-Z]$/.test(e.key)) state = enterInitial(state, e.key)
})
// The renderer needs the frame's input to draw the thrust flame — the pure core
// carries no "thrusting" flag (GameState.ship is pos/vel/dir only). Sample once
// per fixed step and reuse in render; seeded with an all-false sample so the
// first frame (which runs before any step) already has a value.
let frameInput: Input = input.sample()

const loop = createLoop(
  (dt) => {
    frameInput = input.sample()
    const table = state.highScoreTable
    state = stepGame(state, frameInput, dt, tuning.turnRate)
    // One sound per gameplay event the core emitted this frame (A-18). The
    // dispatch table lives in the pure, unit-tested shell/audio-dispatch
    // module so the wiring is tested behaviourally, not by a source text-match.
    playEventSounds(audio, state.events)
    // Persist the board the moment the core changes it (a confirmed entry) —
    // insertHighScore returns a NEW array, so reference identity is the signal.
    if (state.highScoreTable !== table) highScoreStorage.save(state.highScoreTable)
  },
  () => {
    ctx.save()
    ctx.scale(dpr, dpr)
    render(ctx, state, W, H, frameInput)
    ctx.restore()
  },
)
loop.start()

// A-20 dev-only rotation tuner: never mounted for normal players.
if (new URLSearchParams(location.search).has('tune')) mountTuningPanel(tuning)
