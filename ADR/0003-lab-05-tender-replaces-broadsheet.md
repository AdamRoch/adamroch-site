# ADR 0003: Lab 05, Tender replaces the Broadsheet

Status: Proposed (2026-09-29). The replacement was Adam's request and is decided. The implementation choices below are the implementer's and stay proposed until Adam has reviewed the page.

## Context

Adam asked for `/lab/broadsheet/` to be replaced by "a fresh brand new page with a UI that includes satisfying 3D animations, including scrolling model movement", inspired by the Jeton site on Mobbin: a pink-to-peach gradient, satin coral discs fanned along a curve, huge white grotesk type, a floating pill nav.

Two standing decisions bear on a new lab. ADR 0001 point 5 kept WebGL2 + GLSL and said to revisit it "for the first new lab written from scratch", which this is. ADR 0001 point 10 made a cinematic image pipeline the standard: linear HDR accumulation, AgX, restrained bloom, in-shader grain, dither and vignette.

## Decisions

1. **Same address, new lab.** The page lives at `/lab/broadsheet/` so links, the sitemap and the `UPDATED` label (keyed on the slug in `vite.config.ts`) keep working. Everything a visitor reads says Tender: the lab table, the homepage row, the 404 list, Walkthrough's next link. The essay is in git history.
2. **WebGL2 again, on the revisit.** Eighteen instanced coins, a PMREM environment and one shadow map gain nothing visible from WebGPU or TSL. The headless rig verifies WebGL reliably, and the shared `lab-quality` loop and tiers already fit it.
3. **This lab's image pipeline differs from 0001's standard, on purpose.**
   - The canvas is transparent and sits between the sections' CSS surfaces and their DOM type. Section colours land exactly on their hex values, the type stays sharp, and the contrast probe can measure the composited page.
   - The coins are tone mapped per fragment with Khronos PBR Neutral at exposure 0.8. It was made for product renders and keeps base colours; AgX would grey the pinks.
   - There is no bloom, because product photography does not glow.
   - Antialiasing is the canvas's MSAA. Grain and dither are added in the coin shader, and a procedural grain layer sits on the gradient surfaces to stop banding.
4. **Contrast by construction.** The palette was chosen by computed contrast (white on `#bf3459` is 5.9:1; `#c42a17` on `#fbe9e3` is 4.8:1). Glass UI is dark glass so bright coins behind it cannot lift its backdrop. The gate passes at 1440x900 (151 of 151 boxes) and 390x844 (116 of 116).
5. **Self-hosted Switzer only.** The Broadsheet was the last page loading fonts from a third-party origin (Fontshare's Clash Display and Sentient). Tender uses the site's own files.

## Consequences

- The Museum (Adam's uncommitted work) still has a Broadsheet row and a face shader for the paper essay. Both need a Tender version or an update before the Museum ships.
- `tools/probe.mjs` now starts its clip check at the text's own element. A visually hidden label clips its text with its own `overflow`, and every lab's chrome hides the next-lab title that way on phones, which had read as a contrast failure.
- If the slug should match the name, the fix is a move to `/lab/tender/` with a redirect from `/lab/broadsheet/`, plus the lab table, the `vite.config.ts` entry and `LAB_SLUGS`.
