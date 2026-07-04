// src/core/input.ts
//
// The complete per-frame input the pure core consumes. The shell maps the
// physical cabinet controls (keyboard rotate/thrust/fire/hyperspace) into
// this shape; the core never reads a device directly. Plain booleans,
// abstracted from any device — no yoke axes (that's star-wars' cockpit, not
// this cabinet's rotate/thrust ship).

export interface Input {
  left: boolean
  right: boolean
  thrust: boolean
  fire: boolean
  hyperspace: boolean
  /** The cabinet's start button (A-16): begins a game from attract and confirms
   * initials on the qualifying game-over path. Edge-triggered in the sim via
   * GameState.startPrev (the same shift-register debounce as firePrev), so a
   * press held across a mode transition is consumed once, not twice. */
  start: boolean
}

export const NO_INPUT: Input = {
  left: false,
  right: false,
  thrust: false,
  fire: false,
  hyperspace: false,
  start: false,
}
