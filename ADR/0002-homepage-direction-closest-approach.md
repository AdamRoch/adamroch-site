# ADR 0002: Homepage direction, "Closest Approach"

Status: Accepted (2026-09-17), pending one fresh-eyes check by Adam (see Consequences)

## Context

Five creative directors proposed independent directions for the homepage under the constraints in ADR 0001 (dark only; Switzer / Instrument Serif / JetBrains Mono; no homepage audio; no cursor followers; zero assets; instant first paint). Three judges scored them: an Awwwards-jury lens, a principal-engineer lens, and an owner-fit lens. A synthesizer then wrote a full build spec.

The two finalists:

- **Closest Approach** (gravity). One fullscreen fragment shader applies the thin-lens point-mass equation, beta = theta - thetaE² (theta - c) / (|theta - c|² + eps²), to a procedural source sky: a thin ember band of filaments on a warm near-black ground and sparse stars. Einstein arcs, doubled stars, and the inverted inner image fall out of the maths. The lens rides a scroll-keyed path past the italic accent words; the index's hairlines live in the shader and bend around a hovered door; leaving for a lab is the door's ring swallowing the viewport with that lab's first-frame colour inside. The jury and engineer lenses ranked it second; the owner-fit lens ranked it first "and it is not close."
- **One Light** (lit board). A matte black board and one small ring of warm light in front of it; DOM text is lit by distance to the ring through CSS custom properties; the GPU adds board grain, dust and the ring's bloom. Jury and engineer lenses ranked it first; the synthesizer chose it, with its own kill criterion: build the board and ring stills first, and if they do not read as a photograph, build Closest Approach instead.

Between the panel and the synthesis, a standalone prototype of the Closest Approach shader was built and rendered (`.tmp/lens-proto.html`, screenshots in the session scratchpad). At the first tuning pass it already reads as the Interstellar-style photon ring over a bending band, with the headline crisp in DOM Switzer beside it, at desktop and 390 px widths. That evidence was not available to the judges.

## Decision

Build **Closest Approach**, with these changes to the direction as proposed and these grafts from the other directions:

1. **The hero headline stays DOM.** The proposal's "rasterise the headline into the shader after the reveal and lens it" is cut. It was every judge's top technical objection (a pixel-match gamble across browsers on the first screen, and it breaks select and find-in-page). The band, stars and hairlines bend; the words do not.
2. **The ring is drawn analytically** with a two-term Moffat profile (white core, ember shoulders), as the prototype does, rather than relying on bloom. Bloom is optional and only added if a side-by-side screenshot proves it better. (Graft: Graticule.)
3. **Proportions.** Hero ring small and off-centre in negative space (thetaE ≈ 0.11 of the short side); the full ring appears only at the footer, at thetaE ≈ 0.22 rather than 0.30, with the band kept thin. No disk, no black centre anywhere. On phones the footer ring sits above the statement, not around it.
4. **The italics are the light's keyframes.** The lens path's rest positions are the serif accent words (*gravity*, *language*, *experiment*, *Build something.*). (Graft: One Light.)
5. **Everything below the WebGL layer is taken from the synthesized spec**, which is direction-agnostic and strong: the fluid type scale and tracking, the oklch tokens with the 5.78:1 mute floor, the motion tokens and the four-masked-line-reveals rule, the navigation model (one page, one contact surface, no pill nav), the clock (Intl, America/Chicago, shortOffset), the modal sheets (native `<dialog>` + `showModal()`, since the canvas sits behind the DOM here), the `src/labs.ts` table shared with the lab chrome, `UPDATED …` from git replacing `Live`, the giveaway explanation slot, the persisted MOTION toggle, the 404 as the lens with nothing behind it, the accessibility and loading contracts, the contrast probe under every text box at every lens anchor, and the list of things cut from the current page.
6. **Perf accounting corrected**: 1600×1000 at DPR 2 is 6.4 MP, so the single pass is budgeted at ~6 ms, not 3. Still inside a 60 fps frame with headroom; tiers drop DPR, then noise octaves, then stars.

## Why override the synthesis

- The synthesis's own fallback path is Closest Approach, gated on stills that had not been built. The Closest Approach stills exist and pass on the first pass, so the serial gate would only have delayed the same outcome.
- The judges' strongest objections to Closest Approach are answered by the decision above: the headline swap is cut; the arithmetic is corrected; the "second black hole" risk is addressed structurally (small hero ring, no disk, no black centre, footer ring reduced) and will be checked by eye on the real page rather than argued.
- Adam's evidence of taste is three parts gravity to one part halo, and the site's flagship lab is a black hole. A front door that frames the flagship is coherent; a front door that avoids it is cautious.
- One Light's remaining risk is the opposite of the brief: it is quiet, and it needs two WebGL contexts plus per-element style writes at DPR 2–3 to be more than a black page with a small ring.

## Consequences

- The build follows the synthesized spec's structure with section 2 (the backdrop) replaced by the lens shader; the prototype at `.tmp/lens-proto.html` with params `band=0.45 bw=0.035 rg=0.16 fil=48 haze=0.03` is the visual reference.
- One check is Adam's: open `/` and `/lab/event-horizon/` back to back on the built site and say whether the homepage reads as "the space around the labs" or as a second black hole. If the latter, the fallback is One Light, whose spec is preserved in the session record and whose system layers are already in the build.

## Addendum (2026-09-17): the fresh-eyes check, answered in part

The page was built, integrated and reviewed by three lenses (craft, engineering, accessibility). On this question the craft reviewer's answer was split, and looking at the frames myself I agree with it:

- **The hero passes.** A small lens (thetaE 0.11) high in a wide field, the headline in clean black below it. It reads as the space around the labs, not as a black hole.
- **The desktop footer does not.** A large warm-white ring, centred, with an ember band sweeping through it and display type centred inside it, is the same composition as Event Horizon's own hero. The mobile footer already avoids this by putting the ring above the statement.

Three alternatives were rendered at 1600x1000 (runtime overrides, no source change; images in the session record):

| | what | verdict |
|---|---|---|
| A | as built: ring centred, statement inside it | the frame in question |
| B | ring off centre (x 0.34), footer left aligned | solves it, but the statement crosses the ring's limb |
| B2 | ring right of centre (x 0.70), footer left aligned | solves it, statement clear of the limb, and it is the left-aligned footer this spec asked for in the first place |
| C | ring centred, band thinned at the contact knot | does not solve it; the composition is unchanged |

**Recommendation: B2.** It removes the resemblance, restores the spec's own §3.7 layout (the centred footer was an integrator deviation), and keeps the ring as the closing object.

**Adam accepted B2 on 2026-09-18 and it is what shipped.** Implemented as: `CONTACT_X = 0.7` and `TE.contact` 0.22 → 0.19 in `src/light/path.ts` (desktop only; phones keep the ring above a centred statement, a composition that never had the resemblance), and `.contact-body` / `.contact-actions` left-aligned in `src/style.css` with the phone block restoring centre.

Two things the change surfaced, both fixed before shipping:

- Measuring A against B2 showed the **centred ring was itself failing the contrast gate** at 1366 (the footer email address at 2.99:1, under the ring's glow). B2 clears it. So the resemblance fix and an accessibility fix were the same change.
- The gate then still failed at 2560 on the row-01 `OPEN` label (1.9:1). Cause: `solveDoorColumn()` scored the door column against the ring's *disc*, but the Moffat wings carry real light well past the limb, so the column landed close enough to wash an 11 px mute label. The solver now scores against the glow (`R = r * (1 + PAD) * 1.8`), and `GAIN.door` went 0.2 → 0.12. Gate result after: 1366, 1600, 1920, 2560 and 390 all pass at WCAG AA (4.5:1, 3:1 for large text), 1,069 text boxes total.

Other findings from the review pass were fixed (31 of 35). Deferred to Adam with the above: the copy repetition between the lab index heading and the manifesto paragraph. Accepted as-is with reasons recorded in the session: three.js logs one line on WebGL context loss, and the lens chunk's boot still spends ~38 ms of blocking time inside three's renderer construction (only a raw-WebGL2 port removes either).
- `lenis` is removed if nothing imports it (the spec's argument holds: the lens's spring already lags scroll; document smoothing costs native scroll behaviour and a dependency for nothing visible).
