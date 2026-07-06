# Asteroids Rotation Tuning + Tap-to-Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make keyboard fine-aim reliable in Asteroids by adding a shell-side tap-to-nudge (tap a rotate key = one ROM step; hold = continuous spin), plus a gated dev tuning panel with live sliders for the turn rate and the tap/hold delay.

**Architecture:** The pure core stays ROM-faithful. Rotation magnitude becomes an *optional* parameter (`stepShip(..., rotationRate = SHIP_ROTATION_RATE)`, threaded through `stepGame(..., turnRate?)`) that defaults to the ROM value, so the un-tuned game is byte-identical. All tap-vs-hold logic lives in the shell input controller as a pure, node-testable helper. A dev-only DOM slider panel (gated behind `?tune`) writes into a live `RotationTuning` object that both the loop and the controller already read.

**Tech Stack:** TypeScript (strict, ES modules), Vite 8, Vitest 4 (test env `node` — no jsdom). Canvas-2D game, no backend.

## Global Constraints

- **Byte-faithful default:** with no tuning injected, rotation is +3 dir-units/frame every frame (`SHIP_ROTATION_RATE = 3`, ROM `ChkPlyrInput $7086`). Every existing test in `tests/ship.test.ts` and `tests/input-controller.test.ts` must stay green.
- **Core purity:** `src/core/*` never imports from `src/shell/*`. `turnRate` enters the core only as an explicit function parameter (deterministic given its value). Time still enters only as `dt`.
- **Test env is `node`:** no `document`/jsdom. Controller tests drive fake event buses and call `sample()` once per simulated frame; storage tests stub `localStorage`. DOM code (`tuning-panel.ts`, `main.ts`) is untested bootstrap glue — its logic must live in the tested helpers/config.
- **Dev panel never ships to players:** the panel is only mounted when the URL has `?tune`. A backtick key toggles its visibility once mounted.
- **Direction units:** `dir` is a 256-unit circle (0 = +x, 64 = +y/up, CCW positive). A full revolution at rate `r` per 60 Hz frame takes `256 / r / 60` seconds.
- **Frequent commits:** one commit per task, on the existing branch `fix/A-20-turn-rate-rom-retune`.

---

### Task 1: Injectable turn rate in the pure core

Make rotation magnitude a parameter with the ROM value as its default, so the tuning slider can drive it later without changing default behaviour.

**Files:**
- Modify: `src/core/ship.ts:84-93` (`stepShip` signature + rotation lines)
- Modify: `src/core/sim.ts:243` (`stepGame` signature) and `src/core/sim.ts:286` (`stepShip` call)
- Test: `tests/rotation-tuning.test.ts` (create)

**Interfaces:**
- Produces: `stepShip(ship: Ship, input: Input, dt: number, rotationRate?: number): Ship` — `rotationRate` defaults to `SHIP_ROTATION_RATE` (3).
- Produces: `stepGame(inState: GameState, input: Input, dt: number, turnRate?: number): GameState` — `turnRate` (undefined ⇒ ROM default) is threaded into `stepShip`.

- [ ] **Step 1: Write the failing test**

Create `tests/rotation-tuning.test.ts`:

```ts
// tests/rotation-tuning.test.ts
//
// A-20: rotation is byte-faithful (+3/frame, ChkPlyrInput $7086) by default,
// but the dev tuning panel can inject a different continuous turn rate. This
// pins that the injected rate is honored and that the default stays the ROM 3.

import { describe, it, expect } from 'vitest'
import { stepGame } from '../src/core/sim'
import { stepShip, SHIP_ROTATION_RATE } from '../src/core/ship'
import { initialState, type GameState, type Ship } from '../src/core/state'
import { NO_INPUT, type Input } from '../src/core/input'

const DT = 1 / 60
const LEFT: Input = { ...NO_INPUT, left: true }
const RIGHT: Input = { ...NO_INPUT, right: true }

function playing(ship: Partial<Ship> = {}): GameState {
  const s = initialState(1)
  return { ...s, mode: 'playing', ship: { ...s.ship, ...ship } }
}

describe('A-20 injectable turn rate', () => {
  it('rotates at the ROM default (3/frame) when no rate is injected', () => {
    expect(stepGame(playing({ dir: 0 }), LEFT, DT).ship.dir).toBe(SHIP_ROTATION_RATE)
  })

  it('rotates at the injected rate while left is held', () => {
    expect(stepGame(playing({ dir: 0 }), LEFT, DT, 6).ship.dir).toBe(6)
  })

  it('subtracts the injected rate while right is held (wraps mod 256)', () => {
    expect(stepGame(playing({ dir: 0 }), RIGHT, DT, 6).ship.dir).toBe(256 - 6)
  })

  it('stepShip honors an explicit rotationRate and defaults to the ROM value', () => {
    const ship = playing({ dir: 0 }).ship
    expect(stepShip(ship, LEFT, DT, 6).dir).toBe(6)
    expect(stepShip(ship, LEFT, DT).dir).toBe(SHIP_ROTATION_RATE)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rotation-tuning.test.ts`
Expected: FAIL — the injected-rate cases return 3 (param ignored), e.g. `expected 3 to be 6`.

- [ ] **Step 3: Add the `rotationRate` parameter to `stepShip`**

In `src/core/ship.ts`, change the signature at line 84 and the two rotation lines (92-93):

```ts
export function stepShip(
  ship: Ship,
  input: Input,
  dt: number,
  rotationRate: number = SHIP_ROTATION_RATE,
): Ship {
  const frames = dt * 60

  // Rotation first, thrust reads the updated direction — ROM order
  // (ChkPlyrInput updates ShipDir at $7097 before ChkThrust runs). Left
  // wins over right: the ROM checks left first and skips the right check
  // entirely (branch at $7089). rotationRate defaults to SHIP_ROTATION_RATE
  // (the ROM +3); the dev tuning panel (A-20) can inject a different rate.
  let dir = ship.dir
  if (input.left) dir += rotationRate * frames
  else if (input.right) dir -= rotationRate * frames
```

Leave the rest of `stepShip` unchanged.

- [ ] **Step 4: Thread `turnRate` through `stepGame`**

In `src/core/sim.ts`, change the signature at line 243:

```ts
export function stepGame(
  inState: GameState,
  input: Input,
  dt: number,
  turnRate?: number,
): GameState {
```

And the `stepShip` call at line 286 (a defaulted param accepts `undefined`, falling back to the ROM value):

```ts
  const ship = shipAlive ? stepShip(state.ship, input, dt, turnRate) : state.ship
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/rotation-tuning.test.ts tests/ship.test.ts`
Expected: PASS — new file green, and `ship.test.ts` (the A-3 ROM suite, incl. `SHIP_ROTATION_RATE === 3`) still green.

- [ ] **Step 6: Commit**

```bash
git add src/core/ship.ts src/core/sim.ts tests/rotation-tuning.test.ts
git commit -m "feat(A-20): injectable turn rate in pure core (ROM default preserved)"
```

---

### Task 2: `RotationTuning` config + persistence (shell)

The live values behind the sliders, plus defensive localStorage persistence mirroring `storage.ts`.

**Files:**
- Create: `src/shell/tuning.ts`
- Test: `tests/tuning.test.ts` (create)

**Interfaces:**
- Produces: `interface RotationTuning { turnRate: number; tapHoldDelayFrames: number }`
- Produces: `DEFAULT_TUNING: Readonly<RotationTuning>` — `{ turnRate: SHIP_ROTATION_RATE, tapHoldDelayFrames: 12 }`
- Produces: `createTuning(overrides?: Partial<RotationTuning>): RotationTuning` — a fresh mutable object
- Produces: `loadTuning(): Partial<RotationTuning>` — persisted overrides, `{}` on any unhappy path
- Produces: `saveTuning(tuning: RotationTuning): void` — best-effort persist

- [ ] **Step 1: Write the failing test**

Create `tests/tuning.test.ts`:

```ts
// tests/tuning.test.ts
//
// A-20: live rotation-tuning config for the dev slider panel. Persistence is a
// defensive localStorage seam (mirrors storage.ts): every unhappy path degrades
// to defaults so a corrupt/absent/unavailable store never breaks boot.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { DEFAULT_TUNING, createTuning, loadTuning, saveTuning } from '../src/shell/tuning'
import { SHIP_ROTATION_RATE } from '../src/core/ship'

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('DEFAULT_TUNING / createTuning', () => {
  it('defaults turnRate to the ROM rate and a positive tap/hold delay', () => {
    expect(DEFAULT_TUNING.turnRate).toBe(SHIP_ROTATION_RATE)
    expect(DEFAULT_TUNING.tapHoldDelayFrames).toBeGreaterThan(0)
    expect(Number.isInteger(DEFAULT_TUNING.tapHoldDelayFrames)).toBe(true)
  })

  it('createTuning() returns the defaults as a fresh, mutable object', () => {
    const t = createTuning()
    expect(t).toEqual({ ...DEFAULT_TUNING })
    t.turnRate = 99
    expect(DEFAULT_TUNING.turnRate).toBe(SHIP_ROTATION_RATE) // default untouched
  })

  it('createTuning applies only the given overrides', () => {
    expect(createTuning({ turnRate: 5 })).toEqual({
      turnRate: 5,
      tapHoldDelayFrames: DEFAULT_TUNING.tapHoldDelayFrames,
    })
  })
})

describe('loadTuning / saveTuning persistence', () => {
  it('round-trips saved values', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    saveTuning({ turnRate: 4.5, tapHoldDelayFrames: 20 })
    expect(loadTuning()).toEqual({ turnRate: 4.5, tapHoldDelayFrames: 20 })
  })

  it('returns {} when nothing is stored', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    expect(loadTuning()).toEqual({})
  })

  it('returns {} for corrupt JSON', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'asteroids-tuning': '{not json' }))
    expect(loadTuning()).toEqual({})
  })

  it('ignores non-finite / unknown keys', () => {
    vi.stubGlobal(
      'localStorage',
      fakeStorage({ 'asteroids-tuning': JSON.stringify({ turnRate: 'x', tapHoldDelayFrames: 9, junk: 1 }) }),
    )
    expect(loadTuning()).toEqual({ tapHoldDelayFrames: 9 })
  })

  it('degrades to {} / no-throw when localStorage access throws', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    })
    expect(loadTuning()).toEqual({})
    expect(() => saveTuning({ turnRate: 3, tapHoldDelayFrames: 12 })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tuning.test.ts`
Expected: FAIL — `Cannot find module '../src/shell/tuning'`.

- [ ] **Step 3: Write the tuning module**

Create `src/shell/tuning.ts`:

```ts
// src/shell/tuning.ts
//
// A-20: live rotation tuning for the dev-only ?tune slider panel. Kept OUT of
// the pure core — the shell owns mutable, device-facing state. `turnRate` is
// injected into stepGame each frame (default = the ROM SHIP_ROTATION_RATE, so
// the un-tuned game is byte-identical); `tapHoldDelayFrames` is read by the
// input controller to split a keyboard tap from a hold.
//
// Persistence mirrors storage.ts: defensive localStorage that degrades to
// defaults on every unhappy path (absent / corrupt / unavailable storage).

import { SHIP_ROTATION_RATE } from '../core/ship'

export interface RotationTuning {
  /** Continuous rotation, direction-units per 60 Hz frame. ROM value = 3. */
  turnRate: number
  /** Sim-frames a rotate key must be held before continuous spin engages; a
   * release on or before this many frames reads as a single-step tap. */
  tapHoldDelayFrames: number
}

export const DEFAULT_TUNING: Readonly<RotationTuning> = {
  turnRate: SHIP_ROTATION_RATE,
  tapHoldDelayFrames: 12,
}

export function createTuning(overrides?: Partial<RotationTuning>): RotationTuning {
  return { ...DEFAULT_TUNING, ...overrides }
}

const STORAGE_KEY = 'asteroids-tuning'

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function loadTuning(): Partial<RotationTuning> {
  const storage = getStorage()
  if (!storage) return {}

  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return {}
  }
  if (raw === null) return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const p = parsed as Record<string, unknown>
    const out: Partial<RotationTuning> = {}
    if (Number.isFinite(p.turnRate)) out.turnRate = p.turnRate as number
    if (Number.isFinite(p.tapHoldDelayFrames)) out.tapHoldDelayFrames = p.tapHoldDelayFrames as number
    return out
  } catch {
    return {}
  }
}

export function saveTuning(tuning: RotationTuning): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ turnRate: tuning.turnRate, tapHoldDelayFrames: tuning.tapHoldDelayFrames }),
    )
  } catch {
    // Dev tuning is best-effort; a failed persist never disrupts play.
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tuning.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/shell/tuning.ts tests/tuning.test.ts
git commit -m "feat(A-20): RotationTuning config + defensive persistence"
```

---

### Task 3: `shouldEmitRotate` tap-vs-hold helper (shell)

The pure decision function: given how many consecutive sim-frames a rotate key has been held, decide whether to emit rotation this frame.

**Files:**
- Modify: `src/shell/input.ts` (add exported helper)
- Test: `tests/input-controller.test.ts` (add a describe block)

**Interfaces:**
- Produces: `shouldEmitRotate(framesHeld: number, delayFrames: number): boolean` — `framesHeld` 0 = not held, 1 = the press frame.

- [ ] **Step 1: Write the failing test**

Add to `tests/input-controller.test.ts` — extend the existing import and append a new describe at the end of the file:

```ts
// (change the existing import line to also pull in shouldEmitRotate)
import { createInputController, shouldEmitRotate } from '../src/shell/input'
```

```ts
describe('shouldEmitRotate — tap vs hold decision (A-20)', () => {
  const DELAY = 12
  it('emits nothing when the key is not held', () => {
    expect(shouldEmitRotate(0, DELAY)).toBe(false)
    expect(shouldEmitRotate(-1, DELAY)).toBe(false)
  })
  it('emits a single nudge on the press frame', () => {
    expect(shouldEmitRotate(1, DELAY)).toBe(true)
  })
  it('stays silent through the hold-delay dwell', () => {
    for (let f = 2; f <= DELAY; f++) {
      expect(shouldEmitRotate(f, DELAY), `frame ${f} should dwell`).toBe(false)
    }
  })
  it('emits continuously once held past the delay', () => {
    expect(shouldEmitRotate(DELAY + 1, DELAY)).toBe(true)
    expect(shouldEmitRotate(DELAY + 50, DELAY)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/input-controller.test.ts`
Expected: FAIL — `shouldEmitRotate is not a function` / import has no such export.

- [ ] **Step 3: Add the helper to `src/shell/input.ts`**

Add near the top of `src/shell/input.ts`, after the imports and before `createInputController`:

```ts
/** Given how many consecutive sim-frames a rotate key has been held (0 = not
 * held, 1 = the frame it was first seen down), decide whether to emit rotation
 * this frame: one nudge on the press edge, silence through the hold-delay, then
 * continuous rotation once the key is held past the delay. This is what turns a
 * keyboard tap into a single ROM step while a hold still spins continuously
 * (A-20). Frames are counted by sample() ticks, so the decision is deterministic
 * in sim time, not wall-clock. */
export function shouldEmitRotate(framesHeld: number, delayFrames: number): boolean {
  if (framesHeld <= 0) return false
  if (framesHeld === 1) return true
  return framesHeld > delayFrames
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/input-controller.test.ts`
Expected: PASS — new describe green, existing controller tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/shell/input.ts tests/input-controller.test.ts
git commit -m "feat(A-20): shouldEmitRotate tap-vs-hold helper"
```

---

### Task 4: Wire tap-to-nudge into the input controller (shell)

Track per-direction held-frame counters (driven by `sample()`) with a rising-edge latch, and drive `left`/`right` through `shouldEmitRotate` at the live tuning delay.

**Files:**
- Modify: `src/shell/input.ts` (`createInputController` signature + keydown handler + `sample()`)
- Test: `tests/input-controller.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `shouldEmitRotate` (Task 3), `DEFAULT_TUNING`, `RotationTuning` (Task 2).
- Produces: `createInputController(target: HTMLElement, tuning?: RotationTuning): InputController` — `tuning` defaults to `DEFAULT_TUNING`; `sample()` reads `tuning.tapHoldDelayFrames` live.

- [ ] **Step 1: Write the failing test**

Append to `tests/input-controller.test.ts`:

```ts
describe('createInputController — rotate tap-to-nudge (A-20)', () => {
  const DELAY = 12
  function buildTuned() {
    return createInputController(target as unknown as HTMLElement, {
      turnRate: 3,
      tapHoldDelayFrames: DELAY,
    })
  }

  it('a tap (press, one sample, release) yields exactly one frame of rotation', () => {
    const ctrl = buildTuned()
    windowBus.emit('keydown', { code: 'ArrowLeft' })
    expect(ctrl.sample().left, 'press frame nudges').toBe(true)
    windowBus.emit('keyup', { code: 'ArrowLeft' })
    expect(ctrl.sample().left, 'released → rest').toBe(false)
  })

  it('a held key nudges once, dwells through the delay, then spins continuously', () => {
    const ctrl = buildTuned()
    windowBus.emit('keydown', { code: 'ArrowLeft' })
    expect(ctrl.sample().left, 'frame 1 nudge').toBe(true)
    for (let f = 2; f <= DELAY; f++) {
      expect(ctrl.sample().left, `frame ${f} dwell`).toBe(false)
    }
    expect(ctrl.sample().left, 'past delay → continuous').toBe(true)
    expect(ctrl.sample().left, 'still continuous').toBe(true)
  })

  it('registers one nudge for a sub-frame tap (press AND release between samples)', () => {
    const ctrl = buildTuned()
    windowBus.emit('keydown', { code: 'ArrowLeft' })
    windowBus.emit('keyup', { code: 'ArrowLeft' }) // released before any sample()
    expect(ctrl.sample().left, 'edge latch → one nudge').toBe(true)
    expect(ctrl.sample().left, 'then rest').toBe(false)
  })

  it('each fresh tap after a release nudges again', () => {
    const ctrl = buildTuned()
    windowBus.emit('keydown', { code: 'ArrowLeft' })
    expect(ctrl.sample().left).toBe(true)
    windowBus.emit('keyup', { code: 'ArrowLeft' })
    expect(ctrl.sample().left).toBe(false)
    windowBus.emit('keydown', { code: 'ArrowLeft' })
    expect(ctrl.sample().left, 'second tap nudges').toBe(true)
  })

  it('left and right track independently', () => {
    const ctrl = buildTuned()
    windowBus.emit('keydown', { code: 'ArrowRight' })
    const s = ctrl.sample()
    expect(s.right).toBe(true)
    expect(s.left).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/input-controller.test.ts`
Expected: FAIL — the "held key … dwells then spins" test fails (today's controller returns `true` every frame while held, so frame 2 is `true` not `false`); `createInputController` also doesn't accept a second arg.

- [ ] **Step 3: Rewrite `createInputController` for tap-to-nudge**

In `src/shell/input.ts`: update the import, the signature, the keydown handler, and `sample()`. Replace the import line and the `createInputController` function body as follows (mouse handlers unchanged from the current file — keep them exactly as they are):

```ts
import type { Input } from '../core/input'
import { DEFAULT_TUNING, type RotationTuning } from './tuning'
```

```ts
export function createInputController(
  target: HTMLElement,
  tuning: RotationTuning = DEFAULT_TUNING,
): InputController {
  const held = new Set<string>()
  let mouseFireHeld = false
  let mouseHyperspaceHeld = false

  // Tap-to-nudge state (A-20): consecutive sim-frames each rotate direction has
  // been held, advanced by sample() ticks (NOT wall-clock). The *Edge latches a
  // rising keydown so a tap that presses AND releases between two samples still
  // lands exactly one nudge frame.
  let leftFrames = 0
  let rightFrames = 0
  let leftEdge = false
  let rightEdge = false

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!held.has(e.code)) {
      if ((KEYS.left as readonly string[]).includes(e.code)) leftEdge = true
      if ((KEYS.right as readonly string[]).includes(e.code)) rightEdge = true
    }
    held.add(e.code)
    if (SCROLL_KEYS.has(e.code)) e.preventDefault()
  })
  window.addEventListener('keyup', (e: KeyboardEvent) => {
    held.delete(e.code)
  })

  target.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button === MOUSE_BUTTON.left) mouseFireHeld = true
    else if (e.button === MOUSE_BUTTON.right) mouseHyperspaceHeld = true
  })
  window.addEventListener('mouseup', (e: MouseEvent) => {
    if (e.button === MOUSE_BUTTON.left) mouseFireHeld = false
    else if (e.button === MOUSE_BUTTON.right) mouseHyperspaceHeld = false
  })
  target.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault()
  })
  window.addEventListener('blur', () => {
    mouseFireHeld = false
    mouseHyperspaceHeld = false
  })

  const any = (codes: readonly string[]): boolean => codes.some((c) => held.has(c))

  // Advance one rotate direction's frame counter for this sample and decide its
  // output. Held → increment (0→1 is the press edge, which nudges). Not held but
  // an edge latched since the last sample (sub-frame tap) → force a one-frame
  // nudge. Otherwise → released, reset to rest.
  const rotate = (
    codes: readonly string[],
    frames: number,
    edge: boolean,
  ): { frames: number; out: boolean } => {
    const next = any(codes) ? frames + 1 : edge ? 1 : 0
    return { frames: next, out: shouldEmitRotate(next, tuning.tapHoldDelayFrames) }
  }

  return {
    sample(): Input {
      const l = rotate(KEYS.left, leftFrames, leftEdge)
      const r = rotate(KEYS.right, rightFrames, rightEdge)
      leftFrames = l.frames
      rightFrames = r.frames
      leftEdge = false
      rightEdge = false
      return {
        left: l.out,
        right: r.out,
        thrust: any(KEYS.thrust),
        fire: any(KEYS.fire) || mouseFireHeld,
        hyperspace: any(KEYS.hyperspace) || mouseHyperspaceHeld,
        start: any(KEYS.start),
      }
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/input-controller.test.ts`
Expected: PASS — new tap-to-nudge suite green AND the existing keyboard/mouse regression suites still green (a single keydown + single sample still yields `true` on the nudge frame; keyup + sample yields `false`).

- [ ] **Step 5: Commit**

```bash
git add src/shell/input.ts tests/input-controller.test.ts
git commit -m "feat(A-20): tap-to-nudge rotation in the input controller"
```

---

### Task 5: Dev tuning panel + main wiring (bootstrap glue)

Mount a gated slider panel and inject the live tuning into the loop and controller. This is untested DOM/bootstrap glue (like `main.ts`); its logic is already covered by Tasks 2–4. The deliverable is verified by typecheck/build + a manual dev-server check.

**Files:**
- Create: `src/shell/tuning-panel.ts`
- Modify: `src/main.ts` (imports, tuning creation, controller arg, `stepGame` arg, gated mount)

**Interfaces:**
- Consumes: `RotationTuning`, `saveTuning` (Task 2); `createTuning`, `loadTuning` (Task 2); `createInputController(target, tuning)` (Task 4); `stepGame(..., turnRate?)` (Task 1).
- Produces: `mountTuningPanel(tuning: RotationTuning): void` — builds the visible panel, wires sliders → `tuning` (+ persist), adds a backtick visibility toggle.

- [ ] **Step 1: Create the tuning panel**

Create `src/shell/tuning-panel.ts`:

```ts
// src/shell/tuning-panel.ts
//
// A-20: dev-only tuning overlay. A couple of range sliders write straight into
// the live RotationTuning object the loop and input controller already read, so
// dragging a slider changes the feel immediately. The caller gates the mount
// behind ?tune, and a backtick keypress toggles visibility — normal players
// never see it. Pure DOM glue: values, defaults and persistence live in ./tuning
// (unit-tested); this file only wires sliders to that object, the same way
// main.ts is untested bootstrap.

import { type RotationTuning, saveTuning } from './tuning'

interface SliderSpec {
  key: keyof RotationTuning
  label: string
  min: number
  max: number
  step: number
  readout: (v: number) => string
}

const SLIDERS: readonly SliderSpec[] = [
  {
    key: 'turnRate',
    label: 'Turn rate',
    min: 0.5,
    max: 8,
    step: 0.5,
    // 256-unit circle at 60 Hz → seconds per revolution.
    readout: (v) => `${v.toFixed(1)} u/frame · ${(256 / v / 60).toFixed(2)} s/rev`,
  },
  {
    key: 'tapHoldDelayFrames',
    label: 'Tap/hold delay',
    min: 1,
    max: 40,
    step: 1,
    readout: (v) => `${v} frames · ${Math.round((v / 60) * 1000)} ms`,
  },
]

export function mountTuningPanel(tuning: RotationTuning): void {
  const panel = document.createElement('div')
  panel.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:9999;background:rgba(0,0,0,0.85);' +
    'color:#0f0;font:12px monospace;padding:10px;border:1px solid #0f0;min-width:240px'

  for (const spec of SLIDERS) {
    const row = document.createElement('label')
    row.style.cssText = 'display:block;margin:6px 0'
    const value = document.createElement('span')
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(spec.min)
    slider.max = String(spec.max)
    slider.step = String(spec.step)
    slider.value = String(tuning[spec.key])
    slider.style.cssText = 'width:100%;display:block'

    const refresh = (): void => {
      value.textContent = `${spec.label}: ${spec.readout(tuning[spec.key])}`
    }
    slider.addEventListener('input', () => {
      tuning[spec.key] = Number(slider.value)
      saveTuning(tuning)
      refresh()
    })
    refresh()
    row.append(value, slider)
    panel.append(row)
  }

  document.body.append(panel)

  // Backtick toggles the panel so you can dial the feel in mid-run.
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code === 'Backquote') {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
    }
  })
}
```

- [ ] **Step 2: Wire it into `main.ts`**

In `src/main.ts`, add imports next to the existing shell imports (after the `createInputController` import at line 15):

```ts
import { createInputController } from './shell/input'
import { createTuning, loadTuning } from './shell/tuning'
import { mountTuningPanel } from './shell/tuning-panel'
```

Replace the controller construction at line 41:

```ts
const tuning = createTuning(loadTuning())
const input = createInputController(canvas, tuning)
```

Thread the live turn rate into the sim — change the `stepGame` call inside the loop step (currently `state = stepGame(state, frameInput, dt)` at line 73):

```ts
    state = stepGame(state, frameInput, dt, tuning.turnRate)
```

Mount the panel only when gated by `?tune`, immediately after `loop.start()` (line 89):

```ts
loop.start()

// A-20 dev-only rotation tuner: never mounted for normal players.
if (new URLSearchParams(location.search).has('tune')) mountTuningPanel(tuning)
```

- [ ] **Step 3: Typecheck + full test suite**

Run: `npm run build`
Expected: PASS — `tsc --noEmit` clean (new params/imports typecheck) and `vite build` succeeds.

Run: `npx vitest run`
Expected: PASS — entire suite green (no regressions).

- [ ] **Step 4: Manual verification (dev server)**

Run: `npm run dev` then open `http://localhost:5275/asteroids/?tune`. Confirm:
- The green tuner panel shows top-right with two sliders and live read-outs.
- Start a game; **tap** an arrow key → the ship turns one small step (~4° at rate 3); **hold** → it nudges once, briefly settles, then spins continuously.
- Drag **Turn rate** up → the ship spins visibly faster (read-out s/rev drops); down → slower and finer.
- Drag **Tap/hold delay** → the settle-before-spin window changes.
- Reload the page (`?tune` still present) → the sliders keep your last values (persistence).
- Press backtick → the panel hides/shows.
- Open `http://localhost:5275/asteroids/` (no `?tune`) → **no panel**, and rotation is the ROM default (+3/frame).

- [ ] **Step 5: Commit**

```bash
git add src/shell/tuning-panel.ts src/main.ts
git commit -m "feat(A-20): gated dev rotation tuning panel + main wiring"
```

---

## Self-Review

**1. Spec coverage:**
- Tap-to-nudge (tap = one ROM step, hold = continuous) → Tasks 3 (helper) + 4 (controller). ✔
- Sim stays byte-faithful by default → Task 1 (optional param, ROM default) + regression assertions in Tasks 1 & 4. ✔
- Turn-rate slider (needs live value into the pure sim) → Task 1 (`turnRate` param) + Task 5 (thread `tuning.turnRate` into `stepGame`). ✔
- Tap/hold-delay slider → Task 2 (`tapHoldDelayFrames`) + Task 4 (controller reads it live) + Task 5 (slider). ✔
- Gated dev panel, never shown to players → Task 5 (`?tune` mount gate + backtick toggle). ✔
- Persistence of dialed-in values → Task 2 (`loadTuning`/`saveTuning`) + Task 5 (slider persists on input). ✔
- Sub-frame tap not lost → Task 4 (rising-edge latch) with a dedicated test. ✔

**2. Placeholder scan:** No TBD/TODO; every code and test step contains full code and exact commands. ✔

**3. Type consistency:** `RotationTuning { turnRate; tapHoldDelayFrames }`, `DEFAULT_TUNING`, `createTuning`, `loadTuning`, `saveTuning`, `shouldEmitRotate(framesHeld, delayFrames)`, `createInputController(target, tuning?)`, `stepShip(..., rotationRate?)`, `stepGame(..., turnRate?)` are used identically across tasks. `mountTuningPanel(tuning)` matches its call in Task 5. ✔

## Notes for the workflow

This story grew from a 2-pt "retune a constant" into an input-feature + dev-tooling change because ROM verification proved the sim's turn rate is *already* faithful (+3/frame, `ChkPlyrInput $7086`), so the real fix is the keyboard input layer. The story context (`sprint/context/context-story-A-20.md`) and points should be updated to reflect the re-scope, and the ROM-verification finding recorded in the session's Delivery Findings.
