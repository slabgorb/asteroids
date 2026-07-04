// src/shell/font.ts
//
// Loads the "Vector Battle" arcade vector font used by the HUD — the same face
// tempest and star-wars use, so the cabinet shares one visual language.
// Render/shell-only: the pure core never touches fonts. (Pattern mirrored from
// star-wars, not shared code — per the orchestrator's reuse-first rule, a
// shared lib waits until the duplication is real.)
//
//   Font:    Vector Battle (VectorBattle-e9XO.ttf)
//   Author:  ck! / Freaky Fonts, 1999
//   License: Freeware, Non-Commercial (see public/fonts/Readme.txt, shipped
//            unmodified alongside the face per the designer's terms). A
//            commercial license must be purchased if this project ever goes
//            commercial.
//
// The face is a CAPS-ONLY monoline vector ROM font: callers render text
// uppercase (render.ts does this in the HUD).

export const UI_FONT_FAMILY = 'Vector Battle'

// Static asset served from public/fonts/. Resolve against Vite's BASE_URL so the
// '/asteroids/' deploy base is honoured in both dev and build instead of being
// hardcoded.
const FONT_URL = `${import.meta.env.BASE_URL}fonts/VectorBattle-e9XO.ttf`

// Best-effort load: on any failure (missing API, blocked/absent file) the canvas
// keeps rendering with the 'Orbitron', monospace fallback already baked into
// every font string in render.ts, so the game is never blocked by the font.
export async function loadVectorFont(): Promise<boolean> {
  // FontFace / document.fonts are absent in non-DOM contexts and very old
  // browsers; degrade to the fallback rather than throwing at boot.
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
    return false
  }
  try {
    const face = new FontFace(UI_FONT_FAMILY, `url(${FONT_URL})`)
    await face.load()
    document.fonts.add(face)
    return true
  } catch (err) {
    console.warn('[asteroids] Vector Battle font failed to load; using fallback font.', err)
    return false
  }
}
