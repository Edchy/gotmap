<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: Known World Atlas
description: A quiet, editorial dark-ground atlas of the world of Ice and Fire.
---

# Design System: Known World Atlas

## 1. Overview

**Creative North Star: "The Night Desk"**

A serious atlas, opened late, under a single lamp. The reference is print, not software: the disciplined type scale, generous margins, and hairline rules of editorial cartography — rendered on a dark ground because the reader is on a couch at eleven at night with an episode paused. The authority comes from precision and restraint, never from ornament.

This system is deliberately *not* tech-product minimalism. The nearest trap for a "restrained modern dark map" is the Linear-meets-HUD lane: thin cyan strokes, soft glows, terminal typography, an interface that announces its own sophistication. Rejected. Equally rejected is the obvious move for the subject — parchment, blackletter, sepia, ornamental compass roses. The world supplies atmosphere; the interface stays quiet and lets it.

The map is the product, so the interface is mostly absent. At rest the screen is the world and almost nothing else. Density arrives on demand — by zoom, selection, or search — and retreats when the question is answered. Chrome is guilty until proven necessary.

**Key Characteristics:**
- Dark ground, chosen for the night-viewing context, never as a mood effect
- Editorial type discipline: one family, many weights, a strict scale
- Hairline rules and value separation instead of borders, cards, and shadows
- Color lives in the data; the interface stays near-monochrome
- Motion serves orientation, not delight

## 2. Colors

A near-monochrome interface wrapped around a four-role data palette: cold dark neutrals carry every surface, while saturated color is reserved exclusively for information on the map.

### Primary
- **Brass** `[to be resolved during implementation — warm, low-chroma metallic]`: The single interface accent. Carries selection, focus rings, the active state, and the found result. Chosen over ice blue (too close to the sci-fi HUD lane) and ember (too much heat for the brief). It must read as instrument brass, not fantasy gold: keep chroma low enough that it never glows against the sea.

### Secondary
The **data roles** — the user chose a full palette (3–4 named roles), and this is where it lives. Each role is one hue, used for one class of information, and never appears in interface chrome.
- **Region** *(resolved)*: territory fills and their boundaries. One hue per
  house at chroma 0.065, painted at 0.42 opacity over Land, on a **three-tier
  lightness ladder** of 44% / 37% / 30%. Both channels are tuned for
  **adjacent** separation rather than in isolation: what matters is that two
  regions sharing a border stay distinguishable, in colour *and* in greyscale.
  Hue does the first job — tuning chroma without spreading the hues leaves the
  worst pairs unfixed. Lightness does the second, and needs only three steps
  because only neighbours must differ, which makes it a graph colouring rather
  than nine separate values (there is no room for nine — see `ROADMAP.md`).
  The Gift and the lands beyond the Wall stay near-neutral: not house
  territory, so no hue, but they still take a tier. Enforced on every build by
  `scripts/check-region-contrast.mjs`.
- **Settlement** `[to be resolved]`: cities, towns, castles, holdfasts.
- **Route** `[to be resolved]`: roads, and the Wall as a distinct linear feature.
- **Journey** `[to be resolved]`: character paths over time; the only role permitted to animate.

Each role needs a light and dark step for label-versus-fill use, and each must be distinguishable from the others by **value** as well as hue, so the map survives desaturation.

> **Closed (region fills).** The region tints failed the value half of this
> rule for most of the project's life: they shared L≈46% by design, so
> composited at 0.42 over Land their greyscale luminance spanned 0.0104 and
> *every* adjacent pair fell below the ~0.005 where two dark greys stop
> reading as different — four of them identical to four decimal places.
> Desaturated, the political map went flat.
>
> Fixed by the three-tier ladder above: worst adjacent pair is now 0.0068 and
> all 14 clear the floor. Because only neighbours must differ, three tiers
> suffice where nine values would not fit, and because the ladder moves
> *downward* the label contrast over every fill improved rather than
> degrading. `npm run check` enforces both halves.

### Neutral
- **Sea** `[to be resolved — the darkest ground]`: the water and the page beneath everything.
- **Land** `[to be resolved — a near-black one step up from Sea]`: landmass fill, separated from water by value rather than saturation.
- **Rule** `[to be resolved]`: hairlines, dividers, coastlines, graticule.
- **Ink** `[to be resolved — the brightest neutral]`: primary text and labels.
- **Ink-muted** `[to be resolved]`: secondary text. Must still clear 4.5:1 on Sea; "atmospheric" gray-on-gray is forbidden.

All neutrals are tinted a few thousandths of chroma toward the sea's own cold hue. Never toward warm.

### Named Rules

**The Color-Is-Data Rule.** Saturated color appears on the map or not at all. Buttons, panels, search fields, and toggles are neutral plus Brass. If an interface element wants a data color, the answer is no.

**The Brass Scarcity Rule.** Brass covers ≤10% of any screen. It marks exactly one thing at a time: what you selected, what you focused, what you found. Its rarity is the entire point.

**The Value-First Rule.** Every distinction must survive being converted to grayscale. Hue is a second channel, never the only one — this is both a legibility rule for dark cartography and the foundation for colorblind-safe encoding later.

## 3. Typography

**Display Font:** `[single family to be chosen at implementation — humanist or neo-grotesque sans]`
**Body Font:** same family
**Label/Mono Font:** same family, or a matched mono if coordinates and distances need tabular figures

**Character:** One family doing all the work, across many weights. A second family is the fastest way to make this look themed, and is prohibited. The family must have a true small-caps or a well-drawn light weight for map labels, tabular figures for distances, and enough weights (300–700) to build hierarchy without changing typeface. Editorial, not technical.

### Hierarchy
- **Display** `[weight/size TBD]`: reserved for the place name in a selected-location panel. Almost nowhere else.
- **Headline** `[TBD]`: panel titles and section headers.
- **Title** *(resolved)*: region names on the map. Inter Medium, wide-tracked
  uppercase, 11–15px across the zoom range, wrapped to fit inside its own
  territory. Revealed from z3.4 — one beat before the settlements, so the
  reader takes in the kingdoms before the cities. Coloured per region (see the
  rule below), not in a neutral ink.
- **Body** `[TBD]`: descriptive text in panels. Cap measure at 65–75ch.
- **Label** `[TBD]`: settlement labels, UI controls, metadata. The workhorse.

### Named Rules

**The One Family Rule.** A single typeface across map and interface. No serif display for "cartographic gravity", no blackletter anywhere, no second family for flavor.

**The Label Casing Rule.** Map label hierarchy is built from weight, size, and letter-spacing — not from decorative casing. Wide-tracked uppercase is permitted for the largest geographic features (continents, seas, regions) because that is genuine cartographic convention. It is forbidden as a UI eyebrow above panel sections.

**The Halo Rule.** Every map label sits on varied terrain, so every map label carries a casing or halo in the ground color beneath it. A label that relies on the terrain happening to be dark enough is a bug.

**The Matching Label Rule.** A label that names a colored area is set in that area's own hue, lightened until it clears contrast against its own fill — region names carry the house hue at L 86% and chroma 0.055, holding 7.7–8.3:1 on the fill and 10.8:1+ where a name strays onto bare land or sea. This is the one place color leaves the fills, and it does not break The Color-Is-Data Rule: the hue is still carrying data, and it is carrying the *same* datum as the fill beneath it. The map needs no color key because every territory states its own color. It applies only where a label names a colored region; settlement and water labels stay in the neutral ink ramp. Lightening is the only permitted direction — the fills are dark, so a darker label would sink into its own territory.

## 4. Elevation

Flat, with tonal layering. Motion energy is *responsive*, not choreographed, and the print reference rules out drop shadows almost entirely: editorial layouts separate content with value, rule, and whitespace, not with floating cards.

Depth comes from three devices only: a one-step value shift between surfaces, a hairline rule, and generous space. Panels that sit over the map may use a single soft ambient shadow and a background scrim to establish that the map continues beneath — this is the one sanctioned exception, and it exists for legibility over arbitrary terrain, not for decoration.

### Named Rules

**The No-Card Rule.** Content is not boxed by default. If something needs separation, try space first, then a hairline, then a value shift. A bordered rounded rectangle with a shadow is the last resort, and nested cards are always wrong.

**The 2014 Test.** If a surface looks like a 2014 app, the shadow is too dark and the blur is too small. Ambient shadows over the map are wide, soft, and nearly invisible — they suggest a plane, they don't draw one.

## 5. Components

Omitted — nothing is built yet. Populated on the next scan-mode run.

## 6. Do's and Don'ts

### Do:
- **Do** treat the default screen as "map and almost nothing else." Every control must survive the question "what if this simply weren't here?"
- **Do** verify contrast against the actual dark ground: body text ≥4.5:1, large text and UI affordances ≥3:1. Measured, not eyeballed.
- **Do** separate land from water by **value**, so the coastline reads without a heavy stroke.
- **Do** give every map label a halo or casing in the ground color.
- **Do** keep the whole data palette legible in grayscale, per The Value-First Rule.
- **Do** use motion to preserve orientation — transitional camera movement between locations so the user knows where they flew from and to.
- **Do** pair every animation with a `prefers-reduced-motion` alternative (crossfade or instant) from the first commit, not as a later pass.
- **Do** use `text-wrap: balance` on panel headings and `text-wrap: pretty` on descriptive prose.

### Don't:
- **Don't** produce **fan-wiki clutter** — dense sidebars, mismatched fonts, nested boxes, ad-slot-shaped gaps. This is the failure mode as data depth grows.
- **Don't** reach for **faux-medieval kitsch** — parchment or paper textures, blackletter, sepia, ornamental borders, dragons in the chrome. Warm-neutral cream/sand/parchment backgrounds are banned outright, under any token name.
- **Don't** ship **generic map-provider UI** — floating white pill buttons, a default blue accent, teardrop markers, attribution treated as an afterthought.
- **Don't** build **dashboard SaaS** — card grids, stat tiles, persistent sidebar nav, gradient accents. A world map is not an analytics product.
- **Don't** drift into the sci-fi HUD lane: glowing cyan strokes, scanlines, terminal type, animated reticles. The reference is Monocle, not a spaceship.
- **Don't** write in-world UI copy. Nothing is a "raven," the user is not "my lord."
- **Don't** let a data color into interface chrome, or Brass onto more than ~10% of a screen.
- **Don't** use gradient text, glassmorphism as a default, or colored side-stripe borders.
- **Don't** put a tiny tracked-uppercase eyebrow above every panel section.
- **Don't** justify low-contrast gray-on-gray text as "atmospheric." Dark ground is a context decision, not a license.
