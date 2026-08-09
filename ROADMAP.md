# Roadmap

Working list for the static map. Check items off as they land; keep the notes
that explain *why* something was harder than it looked.

Scope for now is **the static map made as good as it can be** — no timeline, no
spoiler control. Those two arrive together, and only when there is
time-varying data for them to gate (see `PRODUCT.md`, principle 2).

Status: `[ ]` todo · `[~]` in progress · `[x]` done

---

## 1. More of the world

Most of this is already sitting in the upstream dataset, unused. These are
"wire up a layer we have", not "author from scratch".

- [x] **Essos and Sothoryos** — the far shore, as bare land: dimmer fill
      (`land-far`, between sea and land), soft coastline, no labels, no
      region tint, not interactive. The Narrow Sea now has two sides and the
      Stepstones read as a chain *between* continents.

      Deliberately **not** added to `WESTEROS_BBOX` or the camera bounds.
      Essos is 2.5x the width of Westeros, so fitting both would shrink the
      subject to 0.72x and flip the frame from tall (0.42) to square (1.09).
      There is no `maxBounds`, so panning east already finds them; the
      opening view is unchanged (verified: still z2.71). If Essos ever gets
      content of its own, that is the decision to revisit — and it should be
      a deliberate change of subject, not a side effect.
- [x] **Seas and bays** — 15 labels, wide-tracked caps in `ink-sea` (5.1:1),
      sorted below islands and settlements so land always wins a collision.
      Two things were not as advertised. The layer's 28 `water` features
      include headlands and island groups (Cape Kraken, Massey's Hook, The
      Fingers, the Iron Islands) plus four Essosi seas, so the useful set is
      15, not 28 — filtered by name and by whether the *anchor* lands in
      frame. And a centroid is the wrong anchor for a concave bay: Saltspear's
      fell on the far shore and drew its name across land. Anchors now use a
      pole of inaccessibility, verified 15/15 in open water.
- [x] **Rivers** — 46 in frame, 21 named. **The `size` property is a dead
      end**: it is null on 73 of 74 features (only the Blackwater Rush has
      one), so the advertised width hierarchy does not exist in the data.
      Width is derived from total line length instead, which puts the
      Trident's forks, the Mander and the Blackwater Rush at the top — the
      right answer — and still gives the 25 unnamed tributaries a sensible
      width.
- [x] **Lakes** — 11 in frame, 3 named (God's Eye, Red Lake, Long Lake).
      Drawn *after* the region tints, so a river is water rather than a
      tinted river.
- [ ] **Roads** — 21 features, 6 named. The Kingsroad is the one that matters.
- [ ] **The Wall** — a single line feature, and it deserves its own treatment
      rather than being drawn as a road.
- [ ] **Terrain regions** — the same layer also holds 7 forests (Kingswood,
      Wolfswood, the Haunted Forest), 4 mountain ranges, 5 shores. Optional;
      adds texture but also noise.

**Note on ordering:** seas are done and cost the map nothing — they sit in
water that was empty. Rivers and roads are the real density test: they are
lines crossing the region fills, competing with the linework already there
(coastlines, region edges). Judge after rivers, before roads.

**Region names fill in progressively; they cannot all show at once.** Ten
multi-line wide-tracked names do not fit a continent 280px wide. At the fitted
z2.71 nine of the ten anchors fall inside a box about 140x200px, so the
collision solver keeps one. Raising their sort priority above the settlements
did not help — they were never losing to the settlements, they were losing to
each other. What works: reveal them from z3.4 (not the opening view), and give
them nine variable anchors so a name slides to open ground instead of being
dropped. Count grows with zoom — 3 at z3.7, 5 at z4.4, more as the continent
does. `text-radial-offset` was tried at 0.3 to keep names centred and that was
*worse* (3 → 1): centred names collide with each other. 1.2 is the tuned value.

**The two Gifts are dropped from the label set.** Slivers (area 6.3 and 5.7
against the North's 229) whose names would sit on top of each other and the
Wall. They still name themselves in the panel on click.

**Region tints have to be tuned on *adjacent* pairs, not in isolation.** Each
house colour looked fine alone, but painted at 0.42 over `land` the regions
that share a border came out 3-9 apart in RGB — under about 10, two colours
stop reading as different on a dark ground. The North and the Vale were 3
apart; the Riverlands and the Iron Islands, 4.

Raising chroma alone does **not** fix this, which is the non-obvious part: it
lifts the average separation (9.5 → 27.1 at chroma 0.075) while the worst pair
barely moves (3 → 5), because those hues sat only 20-25 degrees apart. The fix
needs both — chroma to 0.065 *and* spreading the old blue cluster
(north/vale/riverlands/iron were all 195-265): the Vale to violet, the Iron
Islands to teal, The North keeping the cold blue that belongs to it. Worst
adjacent pair is now 12, average 21.9.

The Gift and the lands beyond the Wall deliberately stay near-neutral — they
are not house territory, and a hue would imply an allegiance they lack.

**Water is one colour everywhere.** Inland water is painted at the sea's own
value (`water`, 1.00:1 against `sea` — visually identical, with a touch more
chroma so a one-pixel river survives). A lighter inland tone was tried first,
on the theory that a lake surrounded by land needs to be lighter the way the
sea needs to be darker at a coast. Compared on screen it was clearly worse
twice over: the lake read as a clearing rather than water, and the Trident's
forks faded into the region fills at z5. Long Lake matching the Bay of Ice
beside it is what makes both read instantly as water.

**The Isle of Faces sits inside God's Eye**, and the upstream lake polygon has
no hole punched for it — so the lake fill painted straight over the island,
leaving an outline floating in a region tint. Fixed by drawing the island fill
*again* after the lake (`lake-island`), which is cheaper and more robust than
polygon arithmetic. It is the only island-in-lake on the map, verified against
every lake/island pair, so the layer is filtered to that one feature.

That fix then needed a second one. Every other piece of land is `land` *plus*
the region tint at 0.42, but this island is drawn after `region-fill`, so a
single `land` fill left it untinted and visibly greyer than the Riverlands
around it. `lake-island-tint` replays the tint at the same opacity. The tint
is hard-coded to Riverlands/Tully because the islands source carries no
`claimedBy` — when **Island region tinting** below lands, this can read
`['get','claimedBy']` like `region-fill` does.

**Anchoring, if you label any of these:** the sea work added
`poleOfInaccessibility` to `prepare-data.mjs`. Any polygon label that must
sit *inside* a concave shape wants it — lakes especially. Island labels
deliberately still use the centroid plus a radial offset, because they are
labelled from outside.

## 2. Finding things

- [ ] **Search** — fuzzy match over ~150 place names plus 12 regions and 27
      islands. Type "riverr", get Riverrun, fly there, open its panel. This is
      the highest-value item on the list for the mid-episode viewer: "where is
      X" is answered faster by typing than by hunting.
- [ ] **Deep links** — `?place=winterfell` / `?region=the-north`, and a URL
      that updates as you select. Makes the map shareable and survivable
      across a reload.
- [ ] **Filters** — show only cities, only castles, castles + rivers, and so
      on. Cheap to implement (the layers are already type-driven) and it is
      the fastest way to cut density when the map gets busy.

**Design caution:** filters are a control surface, and `PRODUCT.md` says
chrome is guilty until proven necessary. Keep it to one unobtrusive affordance
that stays out of the way until asked for — not a permanent sidebar.

## 3. Distances

- [ ] **Measure between two points** — click A, click B, get the distance.
- [ ] **Travel times** — the same distance expressed as days on foot, on
      horseback, by ship, and on dragonback. This is the item most likely to
      delight, and the one most likely to be quietly wrong.

**Calibration is done:** Winterfell → King's Landing is 23.1° on this map and
roughly 1,650 miles by the Kingsroad in canon, giving **~71 miles per degree**.
Sanity check: Oldtown → King's Landing computes to 1,104 miles, which is the
right order.

**Caveats to be honest about in the UI:** straight-line distance is not road
distance, and the map's own projection is approximate (the continents were
placed on African latitudes to keep Mercator distortion sane, not to be
accurate). Travel speeds are inferred from the books, not stated. Present
these as estimates, not facts.

## 4. Fixes and gaps

- [ ] **Island region tinting** — Dragonstone and Driftmark render as
      unclaimed land because islands are not assigned to a region. Needs the
      same point-in-polygon pass the places use, plus a `claimedBy` per island.
      The Isle of Faces is now a second caller: `lake-island-tint` hard-codes
      the Riverlands tint purely because the islands source has no `claimedBy`.
      Once it does, that layer collapses into the same `regionTint()` the
      mainland uses.
- [ ] **Region fills fail the desaturation rule** — `DESIGN.md` requires data
      roles be separable by value as well as hue. The region tints share
      L≈46%, so composited at 0.42 their greyscale luminance spans just 0.011
      and several pairs are identical: desaturated, the political map goes
      flat. Predates the hue/chroma tuning. Fixing it means laddering L per
      region, which trades against the even visual weight the fills have now.
- [ ] **Great seats outrank ordinary castles** — 105 of 151 confirmed places
      are `Castle`, so Winterfell and Highgarden currently render identically
      to a minor holdfast. A short hand-authored list promoting the great
      seats would make the map read like the political reality of the world.
- [x] **Style initialisation** — no genuine race. Two separate things were
      being read as one bug.

      The `setTimeout(50)` guard was itself a bug: `isStyleLoaded()` is false
      during *normal* loading, so the timer always fired and re-applied the
      style mid-load ("Unable to perform style diff… Rebuilding the style from
      scratch"), restarting the load it was meant to rescue. Removed.

      The "blank map, no error" reports reproduce only in a **hidden tab**:
      Chrome throttles `requestAnimationFrame` to zero frames when a tab is
      backgrounded, and MapLibre completes style load on the render loop, so
      `style.load` never fires. Pump frames and the same style loads all 13
      layers. Nothing to fix — but automated checks must drive a foreground
      tab or a headless browser, or they will "reproduce" a bug that isn't
      there.

      Separately, `registerIcons` had a real check-then-act race: `hasImage`
      was tested before an `await` and not after, so concurrent `styledata`
      events all passed the check and the losers threw "An image named …
      already exists". Fixed with a re-check after the await; verified clean
      under deliberately hammered concurrent calls.

## Done

- [x] **Westeros basemap** — landmass, 12 political regions with house
      allegiance, coastline, region hover and selection.
- [x] **Settlements** — 151 confirmed places, typed and ranked, with
      progressive reveal by zoom.
- [x] **Inter + SDF glyphs** — self-hosted, no glyph server, no CDN.
- [x] **Symbol-layer labels** — real collision detection with variable
      anchors; replaced DOM markers and a hand-maintained collision list.
- [x] **Settlement marks** — circles for settlements, triangles for
      fortifications, filled outranks hollow. Preview at `/icons.html`.
- [x] **Islands** — 33 features, 25 labelled, drawn with the mainland's
      treatment. One label per island group, offset into the water so small
      islands are legible.
- [x] **Hand-authored additions** — Casterly Rock, High Tide, Spicetown, Hull,
      each flagged `added` and shown as "Approximate" with a provenance note.
- [x] **Style validator** — `npm run check`, wired into the build. An invalid
      MapLibre style fails silently, and this catches it in a second.
- [x] **Seas and bays** — 15 water labels, anchored by pole of
      inaccessibility so a name never strays onto land.
- [x] **Essos and Sothoryos** — unlabelled far shore, drawn a step back.
      Panned to, never framed: the opening view stays on Westeros.
- [x] **Rivers and lakes** — 46 rivers, 11 lakes, painted at the sea's own
      value so water is one colour everywhere. The Isle of Faces sits inside
      God's Eye, tinted with the Riverlands like the shore around it.
- [x] **Region tints made legible** — adjacent regions were 3-9 apart in RGB,
      below the ~10 where colours stop reading as different. Now 12 worst,
      21.9 average.
- [x] **Region names on the map** — the `Title` role DESIGN.md reserved. Each
      name in a pale tint of its own territory's hue, so the label and the
      fill say the same thing and the map needs no colour key.
- [x] **Three-beat reveal** — the opening view is empty of settlements: land
      and territories first, then region names, then cities.
