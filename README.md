# The Known World

An interactive atlas of Westeros. Dark-ground, editorial, built for someone who
paused an episode and wants to know where a place is.

See `PRODUCT.md` for who it's for, `DESIGN.md` for the visual system, and
`ROADMAP.md` for what's next and why some things were harder than they looked.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Validates the style and fill contrast, typechecks, builds to `dist/` |
| `npm run preview` | Serves the built `dist/` |
| `npm run check` | Validates the MapLibre style and the region-fill contrast |
| `npm run data` | Re-fetches and re-prepares `public/data/` from upstream |
| `npm run glyphs` | Regenerates the SDF glyphs from `assets/fonts/` |
| `npm run wiki-links` | Re-checks which names have a wiki page (see below) |

`npm run data`, `npm run glyphs` and `npm run wiki-links` are **not** part of
the build. Their output is committed, so a clone runs with `npm install &&
npm run dev`. Re-run them only when the upstream data, the fonts, or the wiki
change.

### Wiki links go stale silently

The panel links a name to its wiki page only when that page is **known** to
exist — `scripts/check-wiki-links.mjs` verifies all 241 names against the
wiki's API and writes the resolved title onto each feature. Names with no page
render as plain text, because a link that looks authoritative and 404s is the
same failure as presenting a speculative point as confirmed.

**`npm run data` erases the annotations — always re-run this after it.** The
prepare step rewrites the same files from upstream, which has no notion of a
wiki page, so the `wiki` properties vanish silently and every name in the panel
reverts to plain text. Nothing errors; the links simply stop being there. The
order is `npm run data` **then** `npm run wiki-links`.

The guarantee is otherwise a property of the *check*, not of the data. Pages
get renamed, merged and deleted, and **nothing in the app will tell you when a
link dies** — the site never contacts the wiki at runtime, which is the point.
Re-run it periodically, and after any change to place names:

```bash
WIKI_CONTACT="you@example.com" npm run wiki-links          # writes
WIKI_CONTACT="you@example.com" npm run wiki-links -- --dry # reports only
```

Two things worth knowing when you do:

- **A recognisable name in the "no page found" list is usually a misspelling
  in the data, not a missing article.** This is how `Oakensheild` and `Lort
  Harroway's Town` were caught. Fix those in `NAME_FIXES` in
  `prepare-data.mjs` — the pipeline refetches from upstream, so editing the
  prepared file by hand is undone on the next `npm run data`.
- **Roughly ten names will never resolve, correctly.** "Village", "Holdfast",
  "Tower" and friends are genuinely nameless upstream. No page exists because
  there is nothing to write about.

The wiki is Fandom, chosen because its API answers plainly. AWOIAF is the
better fit on register and book coverage but is unusable from a script:
Cloudflare challenges every path including the homepage, so any client gets a
403. `--wiki=<host>` overrides if that ever changes.

## Tools

Deliberately few. There is no framework, no state library, no CSS pipeline, and
nothing is fetched from a CDN at runtime.

| | |
| --- | --- |
| **[MapLibre GL JS](https://maplibre.org/) 5** | Map rendering. Open-source, no API key, no tile-server account. |
| **[Vite](https://vite.dev/) 8** | Dev server and bundler. |
| **TypeScript 7** | `tsc --noEmit` typechecks as part of the build; Vite does the transpiling. |
| **[fontnik](https://github.com/mapbox/fontnik)** | Build-time only. Turns Inter TTFs into the SDF glyph PBFs MapLibre needs. |
| **[Inter](https://rsms.me/inter/)** | The single typeface, self-hosted. |

The whole UI is one `innerHTML` template and a few event handlers in
`src/main.ts`. At this size a framework would cost more than it returns.

## How it fits together

```
 upstream GeoJSON (GitHub, fetched once)
          │
          │  npm run data  →  scripts/prepare-data.mjs
          │                   filter to Westeros, normalise, derive labels
          ▼
 public/data/*.geojson  (12 files, committed)
          ▲
          │  npm run wiki-links  →  scripts/check-wiki-links.mjs
          │                         annotates names with a verified wiki page
          │
          ▼
 src/map-style.ts  ──────────────►  MapLibre style object
     builds 12 sources                (29 layers, ordered back to front)
     and 29 layers                             │
          ▲                                    ▼
          │                            src/main.ts
 src/palette.ts                        constructs the map, wires
     OKLCH tokens ──► src/color.ts     hover / click / panel
                      OKLCH → hex
```

### The files

| Path | What it is |
| --- | --- |
| `scripts/prepare-data.mjs` | Fetches the upstream layers, writes the 12 prepared files. All the geometry work lives here — bbox filtering, label anchors, region assignment. Also holds `NAME_FIXES`, the upstream-misspelling table. |
| `scripts/build-glyphs.mjs` | Inter TTF → SDF glyph PBFs. Run once; output committed. |
| `scripts/validate-style.mjs` | Validates the built style against the MapLibre spec. Wired into `npm run build`. |
| `scripts/check-wiki-links.mjs` | Verifies each name against a wiki's API and writes the `wiki` page title onto the feature. Run by hand; output committed. |
| `scripts/check-region-contrast.mjs` | Enforces The Value-First Rule on the region fills: every adjacent pair must differ in greyscale, and labels must still clear AA. Wired into `npm run build`. |
| `data/additions.json` | Hand-placed points absent upstream (Casterly Rock, High Tide, Spicetown, Hull). |
| `src/palette.ts` | Every colour, in OKLCH. Single source of truth, projected onto `:root` at startup. |
| `src/color.ts` | OKLCH → hex, because MapLibre's validator predates CSS Color 4. |
| `src/map-style.ts` | The whole map style: sources, layers, and every zoom/collision expression. |
| `src/icons.ts` | Settlement marks rasterised to SDF images. Preview at `/icons.html`. |
| `src/main.ts` | Map construction, region/place interaction, the detail panel, search and deep links. |
| `src/tokens.css` | Type, space and motion tokens. Colour comes from `palette.ts`. |
| `src/app.css` | Layout for the masthead, panel and colophon. |

### Layer order

Order is load-bearing — several bugs have been ordering mistakes. Back to
front:

```
sea → neighbour-{shelf,land,coast} → land-shelf → island-shelf
    → land → island → island-tint → region-fill → region-edge
    → lake → lake-edge → river
    → lake-island → lake-island-tint → lake-island-coast
    → coast → island-coast → road → wall-glow → wall
    → sea-label → island-label → region-label
    → place-dot → road-label → wall-label → place-label
```

Three of those need explaining. **Inland water sits above the region tints**, so
a river is water rather than a tinted river. **The Isle of Faces is drawn three
times** — fill, tint, coastline — after the lake, because God's Eye has no hole
punched for it upstream and would otherwise paint straight over the island.
**`island-tint` exists because the region polygons stop at the mainland
coastline** and so leave the islands bare: without it Dragonstone and Driftmark
render as unclaimed ground in the Crownlands' own bay. It sits *before*
`region-fill` so a mainland tint still wins on overlap.

### Reveal by zoom

The map introduces itself in three beats, so nothing competes with the step
before it:

| Zoom | On screen |
| --- | --- |
| 2.7 – 3.4 | Land, region colours, water. **No labels.** |
| 3.4 – 3.9 | Region names, alone |
| 3.9 – 4.4 | Cities join |
| 4.4 → 5.8 | Towns **and the nine ruling seats**, then castles, then everything |
| 4.6 → 6.2 | Roads: the named highways first, lesser tracks from 5.4 |

**The Wall is the one exception to all of this** — drawn from the opening view,
its name from z3.6. It is the northern border of the settled world and the most
recognisable thing in Westeros; fading it in late would be like fading in the
coastline.

Region names then fade back at z7 (`REGION_LABEL_OPACITY`) once the settlements
are the real subject.

## Finding things

**Search** indexes 242 targets — 205 places, 12 regions, 25 islands — and ranks
them in four tiers: exact, prefix, substring, then subsequence. Focus it with
`/`, navigate with the arrow keys, `Enter` to go, `Escape` to dismiss.

It covers all 205 places even though the map draws only the confirmed 151.
Searching a real place and getting nothing reads as a broken search, so the
distinction lives in the UI instead: results are flagged **Unconfirmed** and
the panel footnotes the point as inferred from the text. Selecting one reveals
it on the map —
the single exception to the confirmed-only rule, scoped to one point at a time
and only ever by explicit request.

**Deep links** carry the target and never the camera: `?place=kings-landing`,
`?region=the-north`, `?island=bear-island`. Selecting anything rewrites the URL
with `replaceState`, so browsing the map does not fill the back button. A link
means the same thing to everyone who opens it, which encoding a camera position
would not.

Slugs delete apostrophes rather than folding them into the separator pass —
`kings-landing`, not `king-s-landing`. Two upstream places are both called
"Holdfast", so a clash takes a feature-id suffix (`holdfast-155`).

## Map data

### Where it comes from

Fan-made Westeros GIS files: **Tear** (Cartographer's Guild) →
**theMountainGoat** (2012) → **cadaei** (QGIS shapefiles), obtained via
[mapbox/GOT-Inspired-Map](https://github.com/mapbox/GOT-Inspired-Map).

`scripts/prepare-data.mjs` fetches seven layers over HTTP at prepare time:

| Upstream | Becomes | Notes |
| --- | --- | --- |
| `got_continents` | `westeros`, `neighbours` | Westeros; Essos + Sothoryos kept separate |
| `got_politcal` | `regions`, `region-labels` | Misspelled upstream — that is the real filename |
| `got_locations` | `places` | 205 features, 151 confirmed |
| `got_islands` | `islands`, `island-labels` | 33 features, 25 labelled, 31 assigned to a region |
| `got_regions` | `sea-labels` | 56 features; the 28 `water` ones yield 15 usable seas |
| `got_rivers` | `rivers` | 46 in frame, 21 named |
| `got_roads` | `roads` | 12 in Westeros, 6 named; filtered by `continent` |
| `got_wall` | `wall` | One feature, 12 points |
| `got_lakes` | `lakes` | 11 in frame, 3 named |

The prepare script prints a summary of every layer on each run, plus what it
added by hand and which expected places are still missing.

### Things the upstream data does not say

Worth knowing before you trust a field:

- **`size` on rivers is null on 73 of 74 features.** The advertised width
  hierarchy does not exist; width is derived from line length instead. **On
  roads the same field is real** — populated on every feature, and the four
  size-2 roads are exactly the named highways (Kingsroad, Goldroad, Roseroad,
  Oceanroad), which are also the four longest. Don't generalise either way:
  check the field per layer.
- **`type: 'water'` in `got_regions` includes headlands and island groups** —
  Cape Kraken, Massey's Hook, The Fingers, the Iron Islands. Filtered by name,
  or the map labels a cape as if it were a sea.
- **Lake polygons have no holes for their islands.** Hence the Isle of Faces
  being redrawn above God's Eye.
- **Islands carry no allegiance, and the region polygons do not cover them** —
  they are digitised to the mainland coastline, so an island sits mostly in
  open water and only clips the edge of the territory that claims it.
  `regionForIsland` assigns one by *majority of vertices*, not by centroid: a
  centroid test hands Great Wyk, the Greyjoys' largest island, to nobody. 31 of
  33 resolve; the Stepstones and Grey Gallows genuinely belong to no region and
  stay untinted.
- **One political feature has a null name** (the wildling lands) and one
  location has none (dropped — an unnamed point cannot be labelled or found).
- **Nothing marks a great seat.** 105 of the 151 confirmed places are
  `Castle`, and `type` cannot tell a kingdom's capital from a minor keep
  (`size` is redundant with `type`, so it does not help either). `GREAT_SEATS`
  in `prepare-data.mjs` supplies it, cross-checked against the `claimedBy`
  field on the regions so the two cannot drift apart.

### Our own additions

Four places are absent upstream and hand-placed in `data/additions.json`:
Casterly Rock, High Tide, Spicetown, Hull.

Anything added this way carries `added: true` and the panel footnotes where the
position came from, rather than presenting it as cadaei's work. Keep that
distinction if you add more — the map's authority rests on not quietly
inventing things.

### Scope

The slice is Westeros. `WESTEROS_BBOX` extends east to 29.4 to take in the
Stepstones, which straddle the Narrow Sea; Tyrosh falls inside that span, so
the Free Cities are excluded by name (`ESSOS_PLACES`) rather than by geometry.

Essos and Sothoryos are drawn as an unlabelled far shore, and are deliberately
**outside the camera bounds**: Essos is 2.5× the width of Westeros, so framing
both would shrink the subject to 0.72× and flip the map from tall to square.
Pan east and they are there.

## Notes for the next session

**Run `npm run check` when the style misbehaves.** An invalid MapLibre style
fails *silently* — no layers register, nothing paints, no console error. The
validator catches it in a second and runs as part of `npm run build`.

**A blank map in an automated browser is probably not a bug.** Chrome throttles
`requestAnimationFrame` to zero frames in a hidden tab, and MapLibre completes
style load on the render loop — so `style.load` never fires and the map stays
empty with no error. Drive a foreground tab, or pump frames manually. This
previously cost a whole debugging session and a `setTimeout` workaround that
was itself the bug.

**`['zoom']` is heavily restricted.** It may only appear as the direct input to
a top-level `step` or `interpolate` — not inside a layer `filter` (those are
evaluated per tile, not per frame), and not buried inside arithmetic. Both
mistakes invalidate the whole style with no warning. Where a zoom-dependent
value needs per-feature maths, make `interpolate` the outer expression and put
the constants in the stops; see `ISLAND_LABEL_OFFSET`.

**`feature-state` works in `paint` only — never in `layout` or `filter`.** Both
are computed once when a tile is built, while feature state changes per frame,
so MapLibre rejects the whole style. This rules out reacting to selection with
`text-font`, `symbol-sort-key`, `text-allow-overlap`, `icon-image` or any other
layout property: a selected label cannot be re-weighted, promoted ahead of its
neighbours in the collision queue, or exempted from collision. Selection
highlighting has to be carried by paint properties alone — colour, halo,
opacity. All three restrictions (`['zoom']`, filters, layout) are the same
underlying split between per-tile and per-frame evaluation.

**`setFeatureState` throws if the style is not loaded.** Not a warning — an
exception, which aborts whatever called it. Clicks never hit this because you
can only click a map you can already see, but search and deep links fire on the
user's schedule and the URL's, so both need a guard. `goTo` defers itself to
`map.once('idle')` and `setFeatureState` is wrapped in an `isStyleLoaded()`
check; losing a highlight is harmless, losing the navigation is not.

**`maxBounds` silently breaks `fitBounds`.** MapLibre refuses any camera that
would reveal area outside it, which pins the zoom and makes `fitBounds` a
no-op. Don't reintroduce it without checking the fit still works.

**Colours live in TypeScript, not CSS.** The style needs token values at
module-evaluation time, and Vite injects imported CSS asynchronously — reading
custom properties during construction returns empty strings and MapLibre
rejects the style without a useful error. `palette.ts` owns the values and
projects them onto `:root`.

**MapLibre's style validator predates CSS Color 4.** It rejects `oklch(...)`,
so `src/color.ts` converts to hex at style-build time.

**Colour is tuned on adjacent pairs, not in isolation.** Region tints that look
fine alone were 3–9 apart in RGB where they shared a border, which is below the
threshold where two colours read as different. Raising chroma alone does not
fix it — the hues have to move too. See `ROADMAP.md`.

**Region lightness is a three-tier ladder, and the tiers are load-bearing.**
Hue separates neighbours in colour; lightness is what makes them survive
greyscale (The Value-First Rule). Nine separate values will not fit — a 3% L
step buys only ~0.004 luminance, `ink-muted` falls below AA against its own
fill above L≈46%, and `sea` bounds the bottom. But only *adjacent* regions must
differ, and colouring that graph needs just three tiers: **44% / 37% / 30%**.
Moving one region between tiers can break a neighbour, so run `npm run check`
after touching `region-*` in `palette.ts` — it is wired into the build and
tells you which pair you broke.

**The two Gifts are painted by name, not by house.** `regionTint()` keys on
`claimedBy` everywhere else, but the Night's Watch holds both Gifts and they
share a border, so one token would leave them indistinguishable. They have
their own tokens on different tiers.

## Licence

Code is MIT. The map data in `public/data/` is a derivative of the upstream GIS
files and stays **CC BY-NC-SA 3.0** — non-commercial, attribution required,
share-alike. Fonts are SIL OFL 1.1. The world is © George R. R. Martin.

Free to publish and share; not to sell. Keep the on-screen colophon intact — it
is how the attribution requirement is met. Full terms in `LICENSE`.
