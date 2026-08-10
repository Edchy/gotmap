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
- [x] **Roads** — 12 in Westeros (9 of the 21 are Essosi, excluded by the
      `continent` field rather than by geometry — several run close enough to
      the frame's eastern edge that a bbox test would admit them). 6 named.

      **`size` is real on roads**, which is worth recording because it is a
      dead end on rivers: populated on every feature, and the four size-2
      roads are exactly the named highways — Kingsroad, Goldroad, Roseroad,
      Oceanroad — which are also the four longest. Taken straight from the
      data rather than derived.

      Drawn dashed, and that is what does the work. A road and a river are
      both thin lines crossing the same region fills; at one pixel neither
      width nor colour separates them, but a broken line is unmistakably a
      made thing. Colour reinforces (warm against the water's cold) rather
      than carrying it alone. Names are set *along* the line — a road name in
      a horizontal block beside a winding road belongs to nothing in
      particular — and sorted last so they never beat a settlement.
- [x] **The Wall** — one feature, 12 points, 4.38 degrees.

      **The geometry registers exactly against the settlements**: the east end
      is Eastwatch-by-the-Sea to two decimals, the west end is the Shadow
      Tower, and Castle Black falls on the line between. No adjustment needed.

      Three strokes — a cold glow, the ice line, a hairline — so it reads as a
      built thing with mass rather than a track. It is the **only feature
      exempt from the reveal ladder**, drawn from the opening view: it is the
      northern border of the settled world and the most recognisable thing in
      Westeros, so introducing it late would be like fading in the coastline.
      Its label sorts behind the region names, which own z3.4–3.9 alone.

      Not yet searchable — "the wall" still returns "Lands Beyond the Wall".
      Making it a search target needs a fourth `Target` kind, a panel and a
      deep-link parameter; worth doing, but it is its own piece of work.
- [~] **Terrain regions — tried, reverted. Do not retry from this dataset.**
      The same layer holds 7 forests, 4 mountain ranges and 5 shores. Forests
      were built end to end (prepared layer, `forest` token, fill below the
      region tints, area-gated reveal) and then removed. Two reasons, and the
      second is the one that matters:

      *The rendering is fixable.* Tuned against bare land the fill read fine
      and then all but vanished under a region tint at 0.42 — six forest/land
      pairs collapsed from 11 RGB to 5-7, so the Wolfswood under the North
      read as a rendering seam. Value fixes it (chroma does not); 31% put the
      worst tinted pair at 16. Reusable if terrain ever returns.

      *The coverage is not fixable.* Seven forest polygons exist for the whole
      world, six in frame. There is no Karhold wood, nothing on Bear Island,
      and the Wolfswood stops at a straight line well short of its real
      extent. Compare any painted reference map, where forest is continuous
      texture across the continent: these seven are not "the forests of
      Westeros", they are the seven someone named and traced. Drawing them
      asserts by omission that the northeast is bare, which the data never
      claims and the source maps contradict. That cuts against the thing the
      map's authority rests on.

      The geometry is also too coarse to rescue with texture. These are
      low-vertex convex blobs — the Wolfswood renders as a visible hexagon —
      so tree glyphs would stop dead at a straight edge corresponding to
      nothing. Stippling would emphasise the flaw, not hide it.

      **Mountains and shores have the same defect** (4 ranges for all of
      Westeros; only the Lonely Hills and Sheepshead Hills are anywhere near
      the North), so they are struck from the list too rather than left
      pending. Terrain needs a different dataset, not a different render.

**Note on ordering:** seas cost the map nothing — they sit in water that was
empty. Rivers and roads were the real density test: lines crossing the region
fills, competing with the linework already there (coastlines, region edges).

Roads are in, and the answer was **stagger them rather than thin them**. Twelve
dashed lines across the continent is noise at the opening view, so they arrive
at z4.6 — after the settlements have established themselves — with the lesser
tracks held back to z5.4 and their names to z5.2. Nothing needed to be dropped;
it needed to arrive later. The dash is what keeps them from reading as rivers.

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

- [x] **Search** — 242 targets: 205 places, 12 regions, 25 islands. Ranked in
      four tiers (exact, prefix, substring, subsequence) so "the north" cannot
      lose to a castle whose letters happen to interleave.

      **Search covers all 205 places; the map still draws only the confirmed
      151.** "Summerhall returns nothing" reads as a broken search, not as
      editorial restraint, so the distinction moved into the UI — results are
      flagged `Unconfirmed` and the panel footnotes the point as inferred. A
      selected speculative place is *revealed* on the map, which needed the
      narrowest possible escape hatch in the style: not a `filter` (MapLibre
      rejects `feature-state` there outright) and not a wrapper around
      `REVEAL_AT_ZOOM` (that buries `['zoom']` inside a `*`, the other
      documented restriction). The gate lives inside each stop of the reveal
      ladder instead, which also keeps a revealed place from appearing earlier
      than its type otherwise would.

      **Word-boundary scoring is what makes acronyms work.** A plain
      subsequence span ranked King's Landing *sixth* for "kl", behind Karhold,
      whose k and l sit close together. Scoring characters matched at the
      start of a word, and promoting a query whose every character lands on
      one, puts it first.
- [x] **Deep links** — `?place=winterfell` / `?region=the-north` /
      `?island=bear-island`, written with `replaceState` on every selection.

      **The URL carries the target, never the camera.** A shared link means
      the same thing to everyone who opens it; encoding the camera would churn
      the URL on every pan, write a history entry per gesture, and freeze one
      person's window size into someone else's screen. Places land at a fixed
      z5.6 (above the `Other` reveal at 5.4, so a link to a minor holdfast
      cannot arrive before its own dot); regions fit their bounds instead,
      because a region is an area.

      **The searched name is highlighted on the map**, not just in the panel:
      brass text plus a halo widened 1.2 → 2.4, which lets the name sit in its
      own clearing in a dense field. Island labels got the same treatment —
      they are searchable, and flying to an unmarked shape says nothing.
      Measured, brass is 71–128 RGB from the neighbouring label colours and
      holds 8.4–9.7:1 on both sea and land.

      **The highlight cannot use weight or collision priority.** Setting the
      selected label in SemiBold, sorting it to the front of the collision
      queue, and exempting it from collision were all tried and all rejected:
      `text-font`, `symbol-sort-key` and `text-allow-overlap` are *layout*
      properties, and feature state cannot reach those (see README). So a
      selected label still competes on equal terms with its neighbours and can
      in principle be dropped — survivable only because the panel names the
      place in text regardless.

      **One `select()` owns all three selection kinds.** Each panel used to
      clear the others by hand, which is how a stale highlight survives: miss
      a line and a previously-selected island stays brass behind the
      settlement you just picked. Verified exactly-one-selected across
      place → island → region → place.

      **Apostrophes must be deleted, not treated as separators.** Westeros is
      full of them, and the obvious slugify yields `king-s-landing` — unique
      and correct and something nobody would ever type. Two places are also
      both called "Holdfast", so slugs are de-duplicated with a feature-id
      suffix. Verified: all 242 targets round-trip name → slug → target, and
      each surfaces itself as its own top search hit.
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

**Calibration is done:** Winterfell → King's Landing is 23.07° on this map and
about 2,500 km in a straight line — the Istanbul → St Petersburg comparison the
books invite — giving **~108.35 km per degree**. Sanity check: Oldtown →
King's Landing computes to ~1,675 km, which is the right order.

**The UI states distances in kilometres.** The constant is taken from the
2,500 km figure directly, not by converting the 1,550 mi one that usually
accompanies it: the two describe the same distance, but the mile figure is
itself a rounded conversion, and round-tripping through it would bake that
rounding into every distance for nothing. Should miles ever be wanted back
(or offered as a toggle), convert at the point of display and leave this
constant alone.

**The calibration distance must be a straight line, not a road.** This was
first derived as `1,650 Kingsroad miles / 23.07°` = 71 mi/° (≈114 km/°), which
charges the road's bends to the straight line the map measures and inflated
every distance in the atlas by ~5%. The canon figures do not disagree — 1,650
mi by road and 2,500 km direct measure different things, and a road is always
longer than the line it follows — but only the straight-line one belongs in
this constant. Winterfell → King's Landing now reads ~2,500 km, as it should.

Note the trap for the travel-times work below: because the old constant was
road-derived, its numbers *looked* right for the one journey it was calibrated
on and were wrong everywhere else. Road distance is a separate quantity and
needs deriving from road geometry, not from a fudged distance-per-degree.

**Caveats to be honest about in the UI:** straight-line distance is not road
distance, and the map's own projection is approximate (the continents were
placed on African latitudes to keep Mercator distortion sane, not to be
accurate). Travel speeds are inferred from the books, not stated. Present
these as estimates, not facts.

The first of those now ships: every panel that quotes a distance carries
`DISTANCE_CAVEAT` — "Distances are straight lines, not travel routes, and
approximate." A reader seeing a distance beside a place name will otherwise
read it as a journey, and the gap is neither small nor uniform: anything separated
by mountains, water, or a detour around a bay understates the real travel
considerably.

## 3b. Wiki links from the panel

- [x] **Link panel entries to a wiki page.** `scripts/check-wiki-links.mjs`
      resolves every place, region and island name against a MediaWiki API and
      writes the resolved page title onto the feature as `wiki`, plus a
      `wikiBase` per collection. Names that match no page get no property, and
      the panel renders those as plain text.

      Linked in every panel: the title, the region a place sits in, the
      "Borders" list, "Nearby", "Principal seats", "Settlements" and "Nearest
      seat". 196 of 241 names carry a link; all 196 were re-checked against the
      API after writing and every one resolves.

      **The allowlist is the whole point.** A link that looks authoritative
      and 404s is the same failure as presenting a speculative point as
      confirmed, so the panel must render a link only where a page is known to
      exist. Checking at build time (rather than from the browser on click)
      also means the atlas never contacts the wiki at runtime: no round-trip
      per panel, no loading state, no CORS dependency, and readers of the site
      make no request to a third party at all.

      **Not wired into `npm run build`, deliberately.** The check is run by a
      person, and the result is committed; the site never contacts the wiki at
      runtime. Run it with a contact address:

          WIKI_CONTACT="you@example.com" npm run wiki-links

      `--dry` reports without writing; `--wiki=<host>` picks the wiki.

      **AWOIAF was the first choice and is not usable from a script.**
      awoiaf.westeros.org is the books wiki, better on register and on book
      coverage, and its robots.txt disallows several AI crawlers by name — but
      that turned out not to be the blocker. Cloudflare serves a
      browser-integrity challenge on *every* path, including the homepage, so
      any script gets a 403 no matter who runs it or how it identifies itself.
      Verified from two different environments. Passing that means defeating a
      bot check rather than asking politely, so the default is Fandom, whose
      API answers plainly. `--wiki=awoiaf.westeros.org` remains if the
      challenge is ever dropped.

      **Hit rate: 196/241, 81%.** The misses are not random. Roughly ten are
      genuinely nameless upstream ("Village", "Holdfast", "Tower", "BWB
      hideout") and correctly have no page. Most of the rest are book-only
      places — Whitetree, Rimegate, Icemark, Stonedoor — which is exactly the
      gap a books wiki would close, and the cost of Fandom being show-focused.

      **Fandom is named as a visual anti-reference in `PRODUCT.md` and
      `DESIGN.md`.** That objection is to its *design* — dense sidebars, ad
      slots, nested boxes — not to its facts, and linking out imports none of
      it. Worth re-reading those entries before anyone concludes the two
      decisions contradict each other.

      **Stripping a leading "The" is worth the one line.** Checked as a
      fallback only, after the exact name fails, it rescues the Eyrie, the
      Twins, the Dreadfort, the Iron Islands and the Bloody Gate — which is to
      say, the places people actually look up. It is deliberately not fuzzy: a
      near-match landing on the wrong page is worse than no link, and "Darry"
      the castle vs "Darry" the house is exactly what a looser rule would get
      wrong silently.

      Two upstream misspellings were found this way and are now corrected in
      `NAME_FIXES` in `prepare-data.mjs`: `Oakensheild` → Oakenshield and
      `Lort Harroway's Town` → Lord Harroway's Town. Both then resolved. A
      recognisable name in the miss list is usually a typo, not a missing page
      — which makes this check a spell-checker for the dataset as a side
      effect.

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
- [x] **Panel content** — the panel was sparse because it quoted the data
      rather than using it. The upstream properties are thin (name, type, rank,
      confirmed) but the *relationships* between features are not, and
      relationships are what the reader actually came for: `PRODUCT.md` frames
      the job as "where is this place, and how does it relate to the places I
      already know?"

      Places now carry region, holding house, distance and bearing to King's
      Landing, and a "Nearby" list. Regions carry a settlement breakdown by
      kind and the regions they border. Islands carry a settlement count or,
      when uninhabited, the nearest seat. All of it derived — nothing about
      the world is invented.

      **"Placement" was removed.** It answered a question about the *dataset*
      (confirmed / speculative / ours) in the slot a reader scans for facts
      about the *place*. The distinction still matters and is still shown, but
      as a footnote below the facts and only when there is something to
      caveat — a confirmed upstream point now says nothing, which is the
      correct amount.

      Three things the work turned up:

      - **`House ${claimedBy}` was wrong on two of twelve regions.** The
        Night's Watch holds the New Gift and Bran's Gift and the Wildlings
        hold the lands beyond the Wall, so the panel was rendering "House
        Night's Watch" and "House Wildlings".
      - **The type breakdown must include `Other`.** 25 of the 151 confirmed
        places carry it, so listing only City/Town/Castle/Ruin made the
        breakdown disagree with the total directly above it (Dorne: "19
        settlements / 1 town, 17 castles"). A breakdown that doesn't add up
        costs more than one vague word does.
      - **Borders come from shared vertices, not polygon adjacency.** The
        regions are digitised as a coverage, so neighbours share exact
        coordinate pairs and an equality test is both correct and cheap. Three
        shared vertices are required, so two regions touching the coast at a
        single point don't claim a border. Verified against all 12: the Vale
        borders only the Riverlands, and the Iron Islands border nothing.

      Distances use the **~108.35 km/degree** calibration below, with
      longitude scaled by cos(latitude) — ignoring that overstates east-west
      distance in the North by a third, which is where the calibration was
      taken. Rounded to 10 below 150 km and to 25 above, and prefixed "~":
      quoting "558 km" off a hand-drawn map claims precision the projection
      cannot support. Spot-checked against canon: Winterfell → King's Landing
      ~2,500 km, Oldtown ~1,675 km, and the bearings agree with the map.

      That rounding makes 44 of the 151 confirmed panels repeat a value in
      their Nearby list (Winterfell shows Barrowton and White Harbor both at
      625 km). That is rounding working as intended rather than a fault — the
      bearings still tell the two apart — but it is the thing to look at first
      if the coarseness ever needs revisiting.

      Rounding and calibration are separate concerns and were kept that way.
      Rounding governs how much precision is *displayed*; the constant governs
      whether the number is *centred* correctly. Coarsening the rounding to
      absorb the old 5% bias would have hidden it rather than fixed it.

- [ ] **A visual anchor in the panel.** The panel is still text-only, and
      richer text has raised rather than lowered the value of a mark to anchor
      it. Worth solving — but *not* with photographs.

      **Images of places have no usable source.** Show stills or promotional
      art and HBO owns them: the atlas stops being publishable under its
      current CC BY-NC-SA / MIT terms, which is too high a price. Fan art is
      individually copyrighted by hundreds of artists with no clear licences
      and no way to fetch by place name. Wikimedia Commons is the only
      properly licensed route and has almost nothing, because the places are
      fictional — what it *does* have is filming locations (Dubrovnik for
      King's Landing, Castle Ward for Winterfell), which is a different claim
      than "here is Winterfell" and quietly turns the atlas into a
      location-scouting guide. Generated art is licensable but invented, which
      is exactly what the provenance rules exist to prevent.

      **House sigils are the version worth building.** Heraldry is described
      in the text, so a line drawing is *authored* rather than borrowed;
      `icons.ts` already rasterises SDF marks, so the pipeline exists; and one
      mark per house is ~12 pieces of work, not 205. Stays inside the
      near-monochrome system, and gives every region panel and every great
      seat a visual anchor. Do this instead.
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
