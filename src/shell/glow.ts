// src/shell/glow.ts
//
// SH2-8 (epic SH2): the shell's single entry point for the shared neon-glow
// primitive. Mirrors ./font — one place callers import the vector treatment from,
// re-exporting @arcade/shared/glow (withGlow, glowPolyline, GlowStyle). The per-
// cabinet NUMBERS (GLOW_BLUR, LINE_WIDTH) stay in render.ts; only the VERB — set
// strokeStyle/shadowColor/shadowBlur/lineWidth, draw, then reset shadowBlur to 0 —
// is shared, so asteroids stops re-hand-writing the reset-the-blur footgun.
export * from '@arcade/shared/glow'
