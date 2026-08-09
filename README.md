# The Known World

An interactive atlas of Westeros. Dark-ground, editorial, built for someone who
paused an episode and wants to know where a place is.

This is the **first vertical slice**: Westeros only, region polygons and
settlements, styled for real. See `PRODUCT.md` for who it's for, `DESIGN.md`
for the visual system, and `ROADMAP.md` for what's next.

## Running it

```bash
npm install
npm run data     # fetch and prepare the GeoJSON (already committed)
npm run dev
```

`npm run build` typechecks and produces `dist/`. `npm run preview` serves it.

## What's here

| Path | What it is |
| --- | --- |
| `scripts/prepare-data.mjs` | Fetches upstream GeoJSON, filters to Westeros, normalises properties |
| `scripts/build-glyphs.mjs` | Generates the Inter SDF glyph files (run once; output committed) |
| `data/additions.json` | Hand-placed points absent from upstream — currently just Casterly Rock |
| `src/icons.ts` | Settlement icons as SDF images; preview them at `/icons.html` |
| `src/palette.ts` | The colour palette in OKLCH — single source of truth |
| `src/map-style.ts` | MapLibre style: sea, land, region fills, coastline |
| `src/main.ts` | Map setup, markers, selection, panel |
| `src/tokens.css` | Type, space and motion tokens (colours come from `palette.ts`) |

## Notes for the next session

**Run `npm run check` when the style misbehaves.** An invalid MapLibre style
fails *silently* — no layers register, nothing paints, no console error. The
validator catches it in a second and runs as part of `npm run build`. It has
already caught two real bugs.

**`['zoom']` is heavily restricted.** It may only appear as the direct input to
a top-level `step` or `interpolate`. Not inside a layer `filter` (those are
evaluated per tile, not per frame), and not buried inside arithmetic. Both
mistakes invalidate the entire style with no warning. Where a zoom-dependent
value needs per-feature maths, make `interpolate` the outer expression and put
the constants in the stops — see `ISLAND_LABEL_OFFSET`.

Three more things that are non-obvious and cost time to work out:

**`maxBounds` silently breaks `fitBounds`.** MapLibre refuses any camera that
would reveal area outside `maxBounds`, which pins the zoom and makes
`fitBounds` a no-op with no warning. Don't reintroduce it without checking the
fit still works.

**Colours live in TypeScript, not CSS.** The map style needs token values at
module-evaluation time, and Vite injects imported CSS asynchronously — reading
custom properties during construction returns empty strings and MapLibre
rejects the style without a useful error. `palette.ts` owns the values and
projects them onto `:root`.

**MapLibre's style validator predates CSS Color 4.** It rejects `oklch(...)`
outright, so `src/color.ts` converts to hex at style-build time.

Also worth knowing: place labels are DOM markers rather than symbol layers, so
there's no glyph server and no font network dependency. That's fine at ~150
labels; it will not scale to thousands, and switching to symbol layers means
bundling PBF fonts.

## Data

Map data derives from the fan-made Westeros GIS files: **Tear** (Cartographer's
Guild) → **theMountainGoat** (2012) → **cadaei** (QGIS shapefiles), obtained via
[mapbox/GOT-Inspired-Map](https://github.com/mapbox/GOT-Inspired-Map).

Licensed **CC BY-NC-SA 3.0** — non-commercial only, attribution required, and
derivative data must carry the same licence. The world is © George R. R.
Martin. This is a fan project.

### Our own additions

`Casterly Rock` is absent from the upstream dataset entirely — there's no
better source to switch to, so it's hand-placed in `data/additions.json` and
merged during preparation.

Anything added this way carries `added: true` and shows **"Placement:
Approximate"** in the UI with a note explaining where the position came from,
rather than being presented as though it were cadaei's work. Keep that
distinction if you add more: the map's authority rests on not quietly
inventing things.

The prepare script prints what it added and what's still missing on every run.

### Islands

Islands are a separate upstream layer (`got_islands.geojson`) and carry names
the locations layer lacks — Driftmark, Claw Isle, the Stepstones, Bear Island,
Tarth. Without it, Dragonstone rendered as a label floating in open sea.

The east edge of `WESTEROS_BBOX` sits at 29.4 to include the Stepstones, which
straddle the Narrow Sea. Tyrosh falls inside that span, so the Free Cities are
excluded by name (`ESSOS_PLACES`) rather than by geometry.

**Known gap:** islands are not tinted by the region that claims them, so
Dragonstone and Driftmark read as unclaimed even though both are Crownlands.
Fixing it means running the same point-in-polygon assignment used for places
and adding a `claimedBy` to each island.

## Not built yet

Deliberately out of scope for this slice: Essos, rivers/roads/lakes, search,
deep links, the timeline and spoiler control. The spoiler control matters most
— it's the safety mechanism for the mid-episode viewer, per `PRODUCT.md`.
