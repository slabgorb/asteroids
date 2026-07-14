# Changelog

All notable changes to **Asteroids** — a faithful browser clone of Atari's 1979 vector classic.

Play it at **[asteroids.slabgorb.com](https://asteroids.slabgorb.com)**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries describe what changed
for the player. Purely internal work is summarised under *Internal*.

## [1.0.10] - 2026-07-13

Version bump only.

## [1.0.9] - 2026-07-13

Version bump only.

## [1.0.8] - 2026-07-12

No player-visible changes. Documentation only.

## [1.0.7] - 2026-07-12

### Added
- **Your best score now shows on Asteroids' tile in the arcade lobby.** The game publishes
  its top score where the lobby can read it, across subdomains (ADR-0004).

## [1.0.6] - 2026-07-12

No player-visible changes. Documentation only — this changelog was added.

## [1.0.5] - 2026-07-12

### Changed
- Pause now works the same way across the whole arcade: **Esc** pauses and brings up
  the overlay.

## [1.0.4] - 2026-07-11

No player-visible changes. Version bump only, published as part of a fleet-wide release.

## [1.0.3] - 2026-07-11

### Internal
- Sound effects now play through the arcade's shared audio engine. Same sounds, one engine.

## [1.0.2] - 2026-07-11

### Internal
- Canvas scaling, letterboxing and the playfield margin now come from the arcade's
  shared rendering code.

## [1.0.1] - 2026-07-10

### Fixed
- **Your shots now fly straight along the ship's heading.** They had been drifting off-axis;
  the muzzle now uses the original ROM's own maths.

## [1.0.0] - 2026-07-10

First stable release — the complete game, matching the 1979 cabinet.

### Internal
- Vectors are stroked through the arcade's shared glow renderer.

## [0.0.3] - 2026-07-10

### Added
- **Backspace** now works when typing your initials on the high-score table.

## [0.0.2] - 2026-07-10

### Added
- **Left-click (or Space) starts a game**, so you can begin without reaching for the keyboard.

## [0.0.1] - 2026-07-10

**Initial release** — the complete game. Everything below shipped in this first version.

### Added

**Flying**
- The original inertial flight model, tuned from the ROM: rotate, thrust, and coast
  with real momentum.
- Screen wrap in every direction.
- **Hyperspace** — vanish and reappear somewhere else, with a real chance of
  materialising inside a rock and destroying yourself.

**Rocks**
- Three size tiers that split when shot, the fragments inheriting your shot's momentum
  and kicking apart on the ROM's own per-axis velocities.
- Rocks shatter into scattering shrapnel debris.
- Wave director: four rocks plus two per wave, capped at eleven, spawning from the edges.

**Saucers**
- The large saucer, firing at random in cross patterns.
- The small saucer, which aims at you — and gets steadily more accurate after 35,000 points.
- Each saucer has its own siren pitch, and breaks apart into drifting, fading debris
  when killed.

**Shooting and dying**
- Up to four shots on screen at once, with swept collision so fast shots can't tunnel
  through small rocks.
- Your ship breaks apart into drifting, fading wreckage when destroyed.
- Lives, a clear-centre safe respawn, and brief invulnerability.

**Scoring and framing**
- Authentic 20/50/100-point scoring, rollover at 99,990, and an extra life every
  10,000 points.
- Attract mode, game-over framing, HUD, and a high-score table that persists.

**Sound**
- Authentic sampled sound effects, including the per-size saucer siren.

**Controls**
- Keyboard, plus mouse: left button fires, right button is hyperspace.
