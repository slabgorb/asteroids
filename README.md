# Asteroids

A faithful, browser-based clone of Atari's 1979 vector arcade game *Asteroids*.

**▶ Play it live: [asteroids.slabgorb.com](https://asteroids.slabgorb.com)**

You pilot a ship adrift in a toroidal field of drifting rocks — rotate, thrust,
and fire to break large rocks into smaller ones before they (or a roaming
saucer) get you. Glowing vector lines on black, rendered with HTML5 Canvas 2D —
no physics engine, no backend.

> **Status:** In active development. Flight, firing, asteroid splitting, wave
> spawning, and the large saucer are in place (A-1–A-11). Small saucer, aimed
> fire, hyperspace, lives/respawn, attract mode, ROM-exact shape/velocity
> tables, and sound are landing next (A-12–A-19).

---

## Quick start

```bash
npm install
npm run dev
```

Then open **http://localhost:5275**.

---

## Controls

| Action | Control |
|--------|---------|
| Rotate left / right | **← / →** or **A / D** |
| Thrust | **↑** or **W** |
| Fire | **Space** or **K** |
| Hyperspace | **↓**, **S**, or **Shift** |

---

## Gameplay

- **Toroidal playfield.** Ship, rocks, bullets, and the saucer all wrap at the
  screen edges — there is no wall, just a seam.
- **Inertial flight.** The ship rotates and thrusts with drag, faithful to the
  ROM's flight model — no instant stops, no strafing.
- **Splitting rocks.** Large rocks break into two mediums, mediums into two
  smalls, each inheriting velocity plus spread. Rocks never rotate — only the
  ship has a facing (ROM-confirmed).
- **Wave director.** Each wave spawns four rocks plus two more per wave
  cleared, capped at eleven, placed clear of the ship.
- **The large saucer.** Spawns on a countdown, crosses the field weaving
  vertically, and fires at random headings.
- **Scoring.** 20 / 50 / 100 points for large / medium / small rocks, with the
  score rolling over at 99990 and a bonus ship every 10000 points.

---

## Architecture

Asteroids is split into a **pure simulation core** and a thin **IO shell**.
This boundary is the most important rule in the codebase.

```
src/
├── core/              # PURE, deterministic, unit-tested — no DOM/canvas
│   ├── state.ts       # GameState type, world bounds
│   ├── sim.ts         # stepGame(state, input, dt) → state
│   ├── ship.ts        # flight model (rotate/thrust/inertia/drag)
│   ├── bullet.ts      # firing, lifetime, 4-shot cap
│   ├── rocks.ts       # asteroid entities, drift, splitting
│   ├── saucer.ts      # large/small saucer spawn + movement + fire
│   ├── waves.ts       # wave director (spawn counts/timing/placement)
│   ├── score.ts       # scoring + bonus-ship rules
│   ├── bounds.ts      # toroidal wrap math
│   ├── input.ts       # Input type
│   └── rng.ts         # seeded PRNG (deterministic)
├── shell/             # IO: render.ts, input.ts, loop.ts
└── main.ts            # bootstrap: canvas + wire shell ↔ core
```

**The core is pure and deterministic.** It never imports from `shell/`, never
touches the DOM/`window`/`canvas`, and never calls `Date.now()`,
`performance.now()`, `Math.random()`, or `requestAnimationFrame`. All time
enters the core as `dt`; all randomness comes from a seeded RNG carried in the
game state. `stepGame(state, input, dt)` produces identical output for
identical input — which is exactly what makes the game unit-testable and
frame-rate independent.

---

## Reference material

Authentic shape tables, velocities, and timing constants are being ported from
the commented disassembly of the original cabinet (story A-17). Until then,
provisional values are named and isolated in `core/rocks.ts`, `core/saucer.ts`,
and `core/waves.ts` so the eventual data swap is a constant change, not a
refactor. The disassembly quarry itself is kept locally under `reference/`
(gitignored) — never committed.

---

## Tech stack

- **Language:** TypeScript (ES modules, strict mode)
- **Build tool:** [Vite](https://vitejs.dev/)
- **Tests:** [Vitest](https://vitest.dev/) — TDD on the pure core
- **Rendering:** HTML5 Canvas 2D (`shadowBlur` for the vector-CRT glow)

---

## Development

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the Vite dev server on port 5275 |
| `npm run build` | Type-check (`tsc --noEmit`) and build to `dist/` |
| `npm run preview` | Serve the production build locally on port 5275 |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |

---

## License

Private project, for personal/educational use. *Asteroids* and *Atari* are
trademarks of their respective owners; this is an educational clone built to
learn how the original worked.

## Releasing

This repo ships from the [arcade orchestrator](https://github.com/slabgorb/arcade):
`just release asteroids` gates on tests + build, merges `develop` → `main`, tags
`vX.Y.Z`, and pushes. Every push to `main` auto-deploys to Cloudflare R2 via
GitHub Actions (`.github/workflows/deploy.yml`) — **`main` is production; never
push it by hand.** A red CI run deploys nothing.
