# ADR 0001: Site redesign scope and foundations

Status: Accepted (2026-09-16)

## Context

Adam asked for the site to be redone so that "the fidelity of every aspect is stunning and unmatched, comparing only to the most well designed and visually impressive sites on the web."

A seven-agent audit (homepage code, lab chrome, performance, accessibility, two research sweeps on the 2025–26 award-tier bar, and a completeness critic) established ground truth. Findings that drive this decision, all confirmed in source or screenshots:

- The light theme was broken in production: the river caustic shader used `patch` as a variable name (reserved in GLSL ES 3.0) and never compiled; solid buttons went white-on-white on hover; five text styles failed AA contrast over the gradient.
- The dark "nebula" was three point-sprite blobs, which the research places squarely on the "reads as a three.js demo" list.
- The hero character-split destroyed kerning (+10px on line one) and the intro painted the finished page, hid it, then replayed it on slow connections.
- Fonts came from two third-party CDNs with no preload, no italics (synthesized at 160px), and Satoshi + Space Mono is the recognizable 2022 Fontshare/Framer template pairing.
- Lab pages: three back-home idioms, four note-panel placements, no page transitions, no preloaders, Living World froze the main thread ~6.5s on first render (synchronous shader compile), Walkthrough chrome rendered in Georgia via a `font: inherit` clobber, Event Horizon's subject was cropped out of frame on phones.
- No favicon, OG cards, 404, cache headers, or WebGL-failure fallback.

The full audit lives outside the repo (session scratchpad); this ADR records the decisions it produced.

## Decisions

Made by Adam (2026-09-16):

1. **Dark only.** The light theme and the theme toggle are removed. One committed cinematic look rather than two half-done ones.
2. **Type system: Switzer + Instrument Serif + JetBrains Mono**, self-hosted as Latin-subset WOFF2 with metric-matched fallbacks and preloads. Zero third-party font origins. Satoshi and Space Mono are retired.
3. **Lab pages: chrome, bugs, loading, and the art.** Shared lab chrome (home link, exhibit index, note panel, preloader with true progress), cross-document View Transitions, the confirmed bug fixes, and a fidelity pass on each lab's rendering (post-processing, tone mapping, quality tiers). The tuned scene content itself (geometry, shaders' art logic, easter eggs) is preserved.
4. **The giveaway modal stays**, restyled, with the same Formspree hooks and a one-line explanation slot.

Made by the implementer under that brief:

5. **WebGL2 + GLSL, not WebGPU/TSL, for the new homepage backdrop.** three 0.185 ships WebGPURenderer with a WebGL fallback and TSL post nodes, and the bar research shows 2026 winners moving that way. Deferred because: every existing lab is raw GLSL on WebGLRenderer; TSL is a second authoring model to learn and verify; the headless screenshot rig verifies WebGL reliably; and the visible result, not the API, is what "unmatched" is judged on. Revisit for the first new lab written from scratch.
6. **Homepage is instant-first-paint, no preloader.** It is text-first. CSS owns the initial hidden state (via an `html.js` class set pre-paint) so nothing paints-then-hides; the WebGL module is a dynamic import that fades in on its first rendered frame; the page is complete and correct if WebGL never arrives.
7. **Lab pages get real preloaders.** They have real work (asset bytes, chunked scene build, `renderer.compileAsync`), so a progress rule fed by that work is honest, and the curtain reveal hides the compile stall.
8. **Homepage audio: none.** Adam's standing rule ("no audio on this site, don't fake UI") stands. Labs keep their own WebAudio.
9. **No cursor-following previews and no site-wide custom cursor.** Adam removed the previews in 9dad01e; the research lists custom cursors as the template stack.
10. **Cinematic image pipeline as a standard**: linear HDR accumulation, AgX tone mapping, restrained half-resolution bloom, in-shader luminance-weighted grain, gradient-noise dither, vignette. The CSS grain overlay is deleted.
11. **Verification tooling lives in the repo** (`tools/`), not in a session scratchpad: headless-Chrome screenshot and probe scripts runnable via npm, so fidelity can be re-measured.

## Consequences

- `src/particles.ts`, the light-theme CSS, the theme toggle, and the media band are deleted rather than fixed.
- New dependencies: `lenis` (smooth scroll substrate for scroll-linked WebGL; ~5KB) is allowed; nothing else is planned. Fonts are static files under `public/fonts/`.
- The uncommitted `src/living-world-golden/` and `src/living-world-lush/` variants are superseded mockups and are not wired into the build; they should be deleted or archived by Adam.
- The design direction itself (concept, hero technique, page structure) is recorded separately in ADR 0002 once the design panel concludes.
