// src/core/events.ts
//
// A-18: the pure-core game-event channel. `stepGame` emits a fresh list of
// these on `GameState.events` each frame, describing the gameplay moments the
// shell's audio dispatch reacts to. Events are DATA, never callbacks: they
// carry only what an SFX engine needs, so the core stays pure and
// deterministic — a fixed RNG seed + input stream yields an identical event
// stream. Mirrors the sibling tempest game's `core/events.ts` pattern (a
// proven design for this arcade project family); this is a fresh, asteroids-
// native union, not shared code (CLAUDE.md: share the pattern, not the code).

import type { RockSize, SaucerSize } from './state'

/** The player fired a shot (rising edge of the fire button, under the
 * MAX_PLAYER_SHOTS cap, ship alive). Saucer shots get no cue of their own —
 * the saucer's audio identity is its siren. */
export interface FireEvent {
  type: 'fire'
}

/** Something blew up. `source` is the ship, or the destroyed rock's OWN tier
 * (the same tier `applyScore` awards on — a large rock hit by a bullet reports
 * 'large' even though it splits into mediums). */
export interface ExplosionEvent {
  type: 'explosion'
  source: 'ship' | RockSize
}

/** The thrust button's rising edge (ship alive) — start the sustained engine
 * hum. Paired with ThrustStopEvent so the shell loops a sound spanning the
 * held interval instead of retriggering a one-shot every frame. */
export interface ThrustStartEvent {
  type: 'thrust-start'
}

/** The thrust button's falling edge (or the ship died while thrusting) —
 * stop the engine hum loop. */
export interface ThrustStopEvent {
  type: 'thrust-stop'
}

/** A saucer just spawned — start the sustained siren loop. `size` is the new
 * saucer's tier (A-13 added the small/large distinction) so the shell picks the
 * big vs small siren sample. */
export interface SaucerSirenStartEvent {
  type: 'saucer-siren-start'
  size: SaucerSize
}

/** The live saucer is gone — stop the siren loop. Fires for EVERY way a saucer
 * leaves: a bullet kill, a ram, a rock collision (all A-13), or the far-edge
 * despawn (A-11). Size-agnostic — one channel carries whichever siren played. */
export interface SaucerSirenStopEvent {
  type: 'saucer-siren-stop'
}

/** One beat of the ambient background heartbeat (play mode only). Tempo is a
 * function of live rock count — fewer rocks, faster beats — pinned as a
 * RELATIONSHIP, not a magnitude; verify vs quarry (A-17). */
export interface HeartbeatEvent {
  type: 'heartbeat'
}

export type GameEvent =
  | FireEvent
  | ExplosionEvent
  | ThrustStartEvent
  | ThrustStopEvent
  | SaucerSirenStartEvent
  | SaucerSirenStopEvent
  | HeartbeatEvent
