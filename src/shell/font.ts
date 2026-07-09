// src/shell/font.ts
//
// The HUD / framing text is an authentic stroke-vector font (the 1981 ROM VGMSGA
// alphabet), not a webfont — text is drawn as real glowing vectors (render.ts)
// from a per-letter glyph table. There is no async font to load and no external
// asset to depend on.
//
// SH2-4 (epic SH2) retired asteroids' non-commercial vendored TTF + its webfont
// loader in favour of the shared ROM stroke-vector font. This module now
// re-exports @arcade/shared/font as the shell's single "font" entry point, so
// callers import the font (layoutText, CELL_W/CELL_H, …) from one place. Mirrors
// tempest/star-wars, which converge on the same shared face (ADR-0002).
export * from '@arcade/shared/font'
