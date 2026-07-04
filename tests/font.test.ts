// tests/font.test.ts
//
// RED-phase suite for Story A-16, Part F: the vector UI font seam
// (src/shell/font.ts), ported near-verbatim from star-wars per
// context-story-A-16.md. The module registers a vendored `public/fonts/*.ttf`
// FontFace under UI_FONT_FAMILY, resolving `false` (and leaving the CSS
// fallback untouched) on ANY failure — missing FontFace API, non-DOM context,
// blocked/missing file.
//
// vitest runs in `node` (no document, no FontFace), which IS one of the failure
// modes the try/catch must swallow — so the graceful-degradation contract is
// directly testable here, while the happy path (glyphs actually rendering) is
// an eyeball check at http://localhost:5275/asteroids/ per the epic guardrail.
//
// src/shell/font.ts does NOT exist pre-GREEN, so this file fails to LOAD until
// Dev creates it — that import failure is the RED signal.

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadVectorFont, UI_FONT_FAMILY } from '../src/shell/font'

describe('font — UI_FONT_FAMILY', () => {
  // Same vendored typeface as star-wars ("Vector Battle", freeware licence
  // permitting per-repo redistribution) — the context rules a distinct
  // Asteroids-specific face out of scope.
  it('names the shared arcade vector face', () => {
    expect(UI_FONT_FAMILY).toBe('Vector Battle')
  })
})

describe('font — loadVectorFont degrades gracefully outside a browser', () => {
  it('resolves false in the node test env instead of throwing', async () => {
    await expect(loadVectorFont()).resolves.toBe(false)
  })
})

describe('font — vendored asset ships with the repo', () => {
  const FONTS_DIR = fileURLToPath(new URL('../public/fonts/', import.meta.url))

  it('carries at least one .ttf under public/fonts/', () => {
    expect(existsSync(FONTS_DIR), 'public/fonts/ must exist').toBe(true)
    const ttfs = readdirSync(FONTS_DIR).filter((f) => f.toLowerCase().endsWith('.ttf'))
    expect(ttfs.length).toBeGreaterThan(0)
  })

  // The typeface's licence grants redistribution WITH its readme — each subrepo
  // vendors its own copy (star-wars precedent: Readme.txt shipped unmodified).
  it('ships the licence readme beside the font', () => {
    const files = readdirSync(FONTS_DIR).map((f) => f.toLowerCase())
    expect(files.some((f) => f.startsWith('readme'))).toBe(true)
  })
})
