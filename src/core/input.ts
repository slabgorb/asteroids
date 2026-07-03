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
}

export const NO_INPUT: Input = {
  left: false,
  right: false,
  thrust: false,
  fire: false,
  hyperspace: false,
}
