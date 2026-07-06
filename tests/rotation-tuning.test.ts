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
