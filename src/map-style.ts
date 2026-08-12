import type { StyleSpecification, ExpressionSpecification } from 'maplibre-gl';
import { oklchToHex } from './color';
import { darkPalette, palettes, type Palette, type Theme, type TokenName } from './palette';

/**
 * The day-and-night atlas basemap.
 *
 * Land is separated from sea by value (1.15:1) rather than a heavy stroke, so
 * the coastline hairline carries the figure/ground read. Region colour lives
 * only in fills — never in chrome (The Color-Is-Data Rule).
 */

/**
 * Tokens are authored in OKLCH; MapLibre's style-spec validator predates
 * CSS Color 4 and needs hex. Values come from the palette module rather than
 * computed styles so they are available at module-evaluation time.
 */
let activePalette: Palette = darkPalette;
const token = (name: TokenName) => oklchToHex(activePalette[name]);

/**
 * Region fills keyed by the house that claims them.
 * Built lazily so `buildStyle(theme)` can select the active palette before
 * any colour expressions are resolved.
 */
const regionTint = (): ExpressionSpecification => [
  'case',
  /*
   * The Night's Watch holds both Gifts, and they share a border — so keying
   * purely on `claimedBy` would paint them the same value and leave exactly
   * one adjacent pair indistinguishable, which is the failure the lightness
   * ladder exists to fix. Name wins over house for these two only.
   */
  ['==', ['get', 'name'], 'New Gift'], token('region-gift-new'),
  ['==', ['get', 'name'], "Bran's Gift"], token('region-gift-bran'),
  [
    'match',
    ['get', 'claimedBy'],
    'Stark', token('region-north'),
    'Arryn', token('region-vale'),
    'Tully', token('region-riverlands'),
    'Greyjoy', token('region-iron'),
    'Lannister', token('region-west'),
    'Targaryen', token('region-crown'),
    'Tyrell', token('region-reach'),
    'Baratheon', token('region-storm'),
    'Martell', token('region-dorne'),
    'Wildlings', token('region-wild'),
    token('land'),
  ],
];


/**
 * Label hierarchy, driven from `type`. Cities read as small caps at the top of
 * the scale; castles and ruins recede. Weight and size do the work — colour is
 * reserved for data (The Color-Is-Data Rule).
 */
/**
 * A great seat reads one step above its own type.
 *
 * 105 of the 151 confirmed places are `Castle`, so type alone cannot say that
 * Winterfell runs the North and Torrhen's Square does not. `seat` (set in
 * prepare-data.mjs from the political layer) lifts the nine ruling seats out
 * of that undifferentiated mass.
 *
 * The lift is deliberately *one step*, not a new tier of its own: a seat gets
 * the size and ink of a Town where it would otherwise be a Castle, and Oldtown
 * — a City that is not a ruling seat — still outranks it in size. The
 * political point is made by weight and by collision priority, not by making
 * nine castles shout.
 */
const seatOr = (
  seatValue: number,
  fallback: ExpressionSpecification | number,
): ExpressionSpecification => ['case', ['get', 'seat'], seatValue, fallback];

const LABEL_SIZE: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3, seatOr(11, ['match', ['get', 'type'], 'City', 12, 'Town', 10, 9]),
  7, seatOr(15, ['match', ['get', 'type'], 'City', 16, 'Town', 14, 12.5]),
];

/**
 * Weight is driven by class alone, not by selection.
 *
 * Setting the selected name in SemiBold was tried and is not possible:
 * `text-font` is a *layout* property, and MapLibre rejects `feature-state` in
 * layout properties outright ("not supported with layout properties") — they
 * are computed once at tile-build time, while feature state changes per
 * frame. Same underlying reason as the filter restriction. Only `paint`
 * properties can react to selection, so the highlight is carried by colour
 * and halo instead. See README.
 */
const LABEL_FONT: ExpressionSpecification = [
  'case',
  // A seat is set in Medium, the weight a Town gets — one step up from the
  // Regular the other castles share, and still below a City's SemiBold.
  // `seat` is a plain data property, so this is legal in a layout expression
  // where feature-state would not be (see the note on weight below).
  ['get', 'seat'], ['literal', ['Inter Medium']],
  [
    'match',
    ['get', 'type'],
    'City', ['literal', ['Inter SemiBold']],
    'Town', ['literal', ['Inter Medium']],
    ['literal', ['Inter Regular']],
  ],
];

const labelColor = (): ExpressionSpecification => [
  'case',
  ['boolean', ['feature-state', 'selected'], false], token('brass'),
  // A ruling seat is set in full ink like a city, not the muted grey the other
  // 96 castles share. This is the value channel doing the work the Value-First
  // Rule asks for: the distinction survives being converted to greyscale.
  ['get', 'seat'], token('ink'),
  ['match', ['get', 'type'], 'City', token('ink'), 'Town', token('ink'), token('ink-muted')],
];

/**
 * Symbol layers place labels with real collision detection: MapLibre lays them
 * all out, compares bounding boxes, and drops lower-priority labels rather
 * than letting them overlap. `symbol-sort-key` makes that priority explicit —
 * lower sorts first and wins, so cities survive where ruins are dropped.
 */
/**
 * Lower sorts first, and first placed wins a collision.
 *
 * Feature state cannot promote the *selected* label in this base layer:
 * `symbol-sort-key` is a layout property, and feature state cannot reach those
 * (see LABEL_FONT). Collision priority here is therefore fixed at tile-build
 * time. A dedicated `selected-place-label` layer at the end of the style
 * handles the one explicit selection without weakening collision detection
 * for the other 204 names.
 */
const LABEL_SORT: ExpressionSpecification = ['-', 5, ['get', 'rank']];

/**
 * Depth on demand: settlement classes fade in as you zoom.
 *
 * This has to live in `paint`, not `filter`. Filters are evaluated once per
 * tile at load time, so `['zoom']` is not permitted inside one — using it
 * there silently invalidates the whole style. Opacity is evaluated per frame,
 * which is exactly what a zoom-dependent reveal needs, and it fades rather
 * than popping.
 */
/**
 * Speculative placements stay hidden; the map shouldn't present guesses.
 * Search can still find a genuinely named but unsited place, but it frames
 * only the broad region and opens an explicit "Exact location unknown" panel.
 * The guessed source coordinate never becomes a dot or label.
 *
 * This still wraps each *stop* of the reveal ladder below because MapLibre
 * requires `['zoom']` to remain the direct input to the top-level `step`.
 */
const visible = (
  typeTest: ExpressionSpecification | number,
): ExpressionSpecification => [
  'case',
  ['get', 'confirmed'], typeTest,
  0,
];

const REVEAL_AT_ZOOM: ExpressionSpecification = [
  'step',
  ['zoom'],
  /**
   * The opening view is deliberately empty of settlements.
   *
   * At the fitted z2.71 the continent is only ~280px wide; five city labels
   * on it read as clutter on a shape you have not taken in yet. The map
   * introduces itself in three beats — first the land and its territories,
   * then the cities, then everything else — so nothing competes with the
   * step before it. Region names own z3.4-3.9 alone (see
   * REGION_LABEL_OPACITY); cities arrive just after.
   */
  0,
  3.9, visible(['match', ['get', 'type'], 'City', 1, 0]),
  /*
   * The ruling seats arrive with the towns, a full step before the other 96
   * castles. Whoever pauses an episode to ask where somewhere is is far more
   * likely to mean Winterfell than a holdfast, so the seats should be on
   * screen before the field fills in around them — and the political shape of
   * the continent reads at a zoom where 105 identical castles would not.
   */
  4.4, visible(['case', ['get', 'seat'], 1, ['match', ['get', 'type'], 'City', 1, 'Town', 1, 0]]),
  4.9, visible(['match', ['get', 'type'], 'City', 1, 'Town', 1, 'Castle', 1, 0]),
  5.4, visible(['match', ['get', 'type'], 'Other', 0, 1]),
  5.8, visible(1),
];

/**
 * The selected name is drawn by `selected-place-label`, so suppress its copy
 * in the collision-managed base layer. Keeping this as a separate top-level
 * `step` preserves MapLibre's requirement that `['zoom']` be the direct input
 * while guaranteeing one rendered copy of the selected name, not two labels
 * choosing different variable anchors.
 */
const unselected = (
  typeTest: ExpressionSpecification | number,
): ExpressionSpecification => [
  'case',
  ['boolean', ['feature-state', 'selected'], false], 0,
  visible(typeTest),
];

const BASE_LABEL_OPACITY: ExpressionSpecification = [
  'step',
  ['zoom'],
  0,
  3.9, unselected(['match', ['get', 'type'], 'City', 1, 0]),
  4.4, unselected(['case', ['get', 'seat'], 1, ['match', ['get', 'type'], 'City', 1, 'Town', 1, 0]]),
  4.9, unselected(['match', ['get', 'type'], 'City', 1, 'Town', 1, 'Castle', 1, 0]),
  5.4, unselected(['match', ['get', 'type'], 'Other', 0, 1]),
  5.8, unselected(1),
];

const ISLAND_LABEL_SIZE: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4, 9,
  7, 11.5,
];

/**
 * Radial offset that pushes an island's label off its coastline.
 *
 * `text-radial-offset` is measured in ems of the label's own text size, but
 * what we know is the island's half-width in *degrees*. Converting between
 * them depends on zoom — at z4 Driftmark's half-width is 0.5 em, at z8 it is
 * 6.8 em — so the conversion has to happen per frame:
 *
 *     ems = halfWidth(deg) x pixelsPerDegree(zoom) / fontSize(zoom) + padding
 *
 * Web Mercator puts 256 x 2^zoom pixels around 360 degrees of longitude, so
 * pixelsPerDegree is `256 * 2^zoom / 360`. The trailing constant is breathing
 * room between coast and text.
 */
/**
 * `['zoom']` may only be the direct input to a top-level `step`/`interpolate`
 * — burying it inside arithmetic is rejected by the style spec and silently
 * invalidates the whole style. So the interpolation is the outer expression
 * and each stop carries the pixels-per-em constant for that zoom, computed as
 * `256 * 2^zoom / 360 / fontSize` (see the table in the commit that added it).
 */
const islandOffsetAt = (perDegree: number): ExpressionSpecification => [
  '+',
  0.6,
  [
    // Capped: a large archipelago zoomed in would otherwise fling its label
    // right off the screen. Beyond ~5 em the island fills the view anyway.
    'min',
    5,
    [
      '*',
      // The larger half-extent, so the label clears the island whichever side
      // the collision solver places it on.
      ['max', ['get', 'halfWidth'], ['get', 'halfHeight']],
      perDegree,
    ],
  ],
];

/**
 * Sea labels run the opposite way to settlement labels.
 *
 * Settlements are points that earn their name as you zoom in. A sea is the
 * largest thing on the map and is most useful when the whole coast is in
 * frame — the continent-wide view is exactly where "which water is this?"
 * gets asked. So these start at the default framing (~z2.7) rather than
 * waiting for z4, and grow only gently: measured, an earlier `minzoom: 4`
 * put *nothing* on screen at the opening view and only a usable set in a
 * narrow band around z5.
 */
const SEA_LABEL_SIZE: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2.5, 8,
  5, 10,
  7, 11.5,
];

/**
 * River width, from length rather than the upstream `size` (null on 73 of 74
 * features — see prepare-data.mjs).
 *
 * Two interpolations nested: the outer one on zoom, the inner on the river's
 * own length, so a major river is always wider than a tributary *and* every
 * river thickens as you zoom in. The floor stays hairline-thin — rivers are
 * the densest linework on the map and they sit under everything else.
 */
const riverWidthAt = (thin: number, thick: number): ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['get', 'length'],
  1.5, thin,
  13, thick,
];

const RIVER_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3, riverWidthAt(0.4, 1),
  5, riverWidthAt(0.7, 2),
  8, riverWidthAt(1.4, 4),
];

/**
 * Region label colour: a pale tint of the territory's own hue, keyed off the
 * same `claimedBy` the fill uses. Ties the name to its region without a key.
 */
const regionLabelColor = (): ExpressionSpecification => [
  'match',
  ['get', 'claimedBy'],
  'Stark', token('label-north'),
  'Arryn', token('label-vale'),
  'Tully', token('label-riverlands'),
  'Greyjoy', token('label-iron'),
  'Lannister', token('label-west'),
  'Targaryen', token('label-crown'),
  'Tyrell', token('label-reach'),
  'Baratheon', token('label-storm'),
  'Martell', token('label-dorne'),
  "Night's Watch", token('label-watch'),
  'Wildlings', token('label-wild'),
  token('ink-muted'),
];

/**
 * Region names — the `Title` role DESIGN.md reserves for "region names on the
 * map at low zoom".
 *
 * "Low zoom" turns out to mean z3.4+, not the opening view. Measured at the
 * fitted z2.71: nine of the ten anchors fall inside a box about 140x200px, so
 * nine multi-line wide-tracked names are competing for the same few hundred
 * pixels and the collision solver keeps exactly one. Raising their sort
 * priority above the settlements did not help, because they were never losing
 * to the settlements — they were losing to each other. Only the continent
 * getting bigger fixes that.
 *
 * So the names appear one step in from the opening view, which is also where
 * the eye goes once it has taken in the shape of the continent.
 */
const REGION_LABEL_SIZE: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3.4, 11,
  4.5, 13,
  6, 15,
];

/**
 * Region names fade out as settlements take over. At z6+ the territory is
 * established and the name is just another thing competing for the same
 * pixels, so it steps back rather than being dropped outright.
 */
const REGION_LABEL_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3.4, 0,
  3.9, 1,
  5.5, 1,
  7, 0.45,
];

const ISLAND_LABEL_OFFSET: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4, islandOffsetAt(1.26),
  5, islandOffsetAt(2.31),
  6, islandOffsetAt(4.27),
  7, islandOffsetAt(7.91),
  8, islandOffsetAt(15.83),
];

export function buildStyle(theme: Theme = 'dark'): StyleSpecification {
  activePalette = palettes[theme];
  return {
    version: 8,
    // SDF glyphs generated from Inter by scripts/build-glyphs.mjs. Served as
    // static files, so there is no glyph server and no external dependency.
    glyphs: '/glyphs/{fontstack}/{range}.pbf',
    sources: {
      westeros: { type: 'geojson', data: '/data/westeros.geojson' },
      // Essos and Sothoryos: bare land that gives the Narrow Sea a far shore.
      neighbours: { type: 'geojson', data: '/data/neighbours.geojson' },
      // The western half of Essos is the part this Westeros-first frame can
      // reveal. A hand-placed anchor keeps the continent name in that visible
      // mass instead of at the full polygon's far-eastern centroid.
      neighbourLabels: {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'Essos' },
              geometry: { type: 'Point', coordinates: [43.25, 0.25] },
            },
          ],
        },
      },
      regions: { type: 'geojson', data: '/data/regions.geojson' },
      places: { type: 'geojson', data: '/data/places.geojson' },
      islands: { type: 'geojson', data: '/data/islands.geojson' },
      // Separate point source: one label per island group, not per polygon.
      islandLabels: { type: 'geojson', data: '/data/island-labels.geojson' },
      // Seas and bays: labels only. The water is already the background, so
      // there is nothing to fill — only names to place in the empty space.
      seaLabels: { type: 'geojson', data: '/data/sea-labels.geojson' },
      // One point per territory: a symbol layer over the polygons would print
      // a name per part, and most regions are multipart.
      regionLabels: { type: 'geojson', data: '/data/region-labels.geojson' },
      rivers: { type: 'geojson', data: '/data/rivers.geojson' },
      lakes: { type: 'geojson', data: '/data/lakes.geojson' },
      roads: { type: 'geojson', data: '/data/roads.geojson' },
      wall: { type: 'geojson', data: '/data/wall.geojson' },
    },
    layers: [
      { id: 'sea', type: 'background', paint: { 'background-color': token('sea') } },

      /**
       * Essos and Sothoryos. Land and a coastline, with only the continent
       * name needed to orient the reader.
       *
       * Drawn first and dimmer than Westeros (`land-far` sits between sea and
       * land) so the far shore reads as somewhere else — present enough that
       * the Narrow Sea has two sides, quiet enough that it never competes
       * with the subject. No fill interaction, settlements, or region tint:
       * The Color-Is-Data Rule cuts both ways, and there is no data here yet.
       */
      {
        id: 'neighbour-shelf',
        type: 'line',
        source: 'neighbours',
        paint: {
          'line-color': token('sea-deep'),
          'line-width': 12,
          'line-blur': 11,
          'line-opacity': 0.75,
        },
      },
      {
        id: 'neighbour-land',
        type: 'fill',
        source: 'neighbours',
        paint: { 'fill-color': token('land-far') },
      },
      {
        id: 'neighbour-coast',
        type: 'line',
        source: 'neighbours',
        paint: {
          'line-color': token('rule-soft'),
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 6, 0.8],
          'line-opacity': 0.8,
        },
      },
      {
        id: 'neighbour-label',
        type: 'symbol',
        source: 'neighbourLabels',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['literal', ['Inter Medium']],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            2, 16,
            5, 22,
            7, 26,
          ],
          'text-letter-spacing': 0.32,
          'text-transform': 'uppercase',
          'text-padding': 4,
        },
        paint: {
          'text-color': token('ink-muted'),
          'text-halo-color': token('land-far'),
          'text-halo-width': 1.8,
          'text-halo-blur': 0.8,
          'text-opacity': [
            'interpolate', ['linear'], ['zoom'],
            1.5, 0,
            2.2, 1,
            5.5, 0.8,
            7, 0,
          ],
        },
      },

      // Landmass. A wide, very soft dark halo under the coast suggests depth
      // without drawing a line (The 2014 Test).
      {
        id: 'land-shelf',
        type: 'line',
        source: 'westeros',
        paint: {
          'line-color': token('sea-deep'),
          'line-width': 14,
          'line-blur': 12,
          'line-opacity': 0.9,
        },
      },
      {
        id: 'island-shelf',
        type: 'line',
        source: 'islands',
        paint: {
          'line-color': token('sea-deep'),
          'line-width': 10,
          'line-blur': 9,
          'line-opacity': 0.9,
        },
      },
      {
        id: 'land',
        type: 'fill',
        source: 'westeros',
        paint: { 'fill-color': token('land') },
      },
      // Islands share the mainland's fill so the two read as one landmass.
      {
        id: 'island',
        type: 'fill',
        source: 'islands',
        paint: { 'fill-color': token('land') },
      },
      /*
       * Island territory, painted at the same recipe as the mainland.
       *
       * The region polygons are digitised to the mainland coastline and do not
       * cover the islands, so `region-fill` leaves them bare `land` — which
       * rendered Dragonstone and Driftmark, the Targaryen and Velaryon seats,
       * as unclaimed ground in the middle of the Crownlands' own bay.
       *
       * `claimedBy` is resolved per island at prepare time (majority of
       * vertices inside a region — see `regionForIsland`), so this reads the
       * *same* expression the mainland uses. Islands with no claim — the
       * Stepstones, Grey Gallows — carry a null `claimedBy`, fall through
       * `regionTint`'s default to `land`, and stay visibly unclaimed, which is
       * the correct answer for contested water rather than a gap.
       *
       * Drawn before `region-fill` so a mainland tint still wins where the two
       * overlap, and at the same 0.42 so no seam shows where an island meets
       * the shore it belongs to.
       */
      {
        id: 'island-tint',
        type: 'fill',
        source: 'islands',
        filter: ['has', 'claimedBy'],
        paint: {
          'fill-color': regionTint(),
          'fill-opacity': 0.42,
        },
      },

      // Region tints, kept low so labels stay legible over them.
      {
        id: 'region-fill',
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': regionTint(),
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 0.85,
            ['boolean', ['feature-state', 'hover'], false], 0.7,
            0.42,
          ],
        },
      },
      {
        id: 'region-edge',
        type: 'line',
        source: 'regions',
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], token('brass'),
            ['boolean', ['feature-state', 'hover'], false], token('rule'),
            token('rule-soft'),
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 1.6,
            0.75,
          ],
          'line-opacity': 0.9,
        },
      },

      /**
       * Inland water, drawn *after* the region tints so a river is water and
       * not a tinted river — a fill at 0.42 over a hairline would wash it
       * toward whichever house claims the ground it crosses, which is exactly
       * the confusion The Color-Is-Data Rule exists to prevent.
       *
       * Painted at the sea's value, not a lighter inland tone: water should be
       * one colour everywhere, so Long Lake reads like the Bay of Ice beside
       * it. Compared on screen, a lighter tone also cost real legibility — the
       * Trident's forks faded into the region fills at z5.
       */
      {
        id: 'lake',
        type: 'fill',
        source: 'lakes',
        paint: { 'fill-color': token('water') },
      },
      // The same hairline the coast uses, so a lake shore and a sea shore are
      // the same kind of edge — just at different scales.
      {
        id: 'lake-edge',
        type: 'line',
        source: 'lakes',
        paint: {
          'line-color': token('rule-soft'),
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.3, 8, 0.7],
          'line-opacity': 0.7,
        },
      },
      {
        id: 'river',
        type: 'line',
        source: 'rivers',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': token('water'),
          'line-width': RIVER_WIDTH,
          // Small rivers at low zoom are sub-pixel; fading them out is
          // honester than drawing an aliased dotted line.
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.75, 5, 1],
        },
      },

      /**
       * The Isle of Faces, drawn again on top of God's Eye.
       *
       * The lake polygon has no hole punched for the island, so the `lake`
       * fill above paints straight over it — the island had an outline and no
       * fill, floating in the region tint. Re-drawing the island fill after
       * the lake is the whole fix, and it is cheaper and more robust than
       * doing polygon arithmetic on the lake ring at build time.
       *
       * This is the only island-in-lake on the map (verified against every
       * lake/island pair upstream), so the filter keeps the extra work to the
       * one feature that needs it rather than redrawing all 33 islands.
       *
       * Two fills, not one. Every other piece of land is `land` *plus* the
       * region tint painted over it at 0.42 — but this island is drawn after
       * `region-fill`, so a single `land` fill left it untinted and visibly
       * greyer than the Riverlands around it. The second fill replays the
       * tint at the same opacity, so the isle is coloured by the same recipe
       * as the shore it belongs to.
       *
       * That tint used to be hard-coded to the Riverlands, because the islands
       * source carried no `claimedBy`. It does now (resolved per island at
       * prepare time), so this reads the same `regionTint()` as everything
       * else and the Isle of Faces follows the Riverlands automatically if the
       * political layer ever changes.
       */
      {
        id: 'lake-island',
        type: 'fill',
        source: 'islands',
        filter: ['==', ['get', 'name'], 'Isle of Faces'],
        paint: { 'fill-color': token('land') },
      },
      {
        id: 'lake-island-tint',
        type: 'fill',
        source: 'islands',
        filter: ['==', ['get', 'name'], 'Isle of Faces'],
        paint: {
          'fill-color': regionTint(),
          'fill-opacity': 0.42,
        },
      },
      {
        id: 'lake-island-coast',
        type: 'line',
        source: 'islands',
        filter: ['==', ['get', 'name'], 'Isle of Faces'],
        paint: {
          'line-color': token('rule'),
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 6, 1],
        },
      },

      // Coastline hairline. Carries the figure/ground read.
      {
        id: 'coast',
        type: 'line',
        source: 'westeros',
        paint: {
          'line-color': token('rule'),
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 6, 1.2],
        },
      },
      {
        id: 'island-coast',
        type: 'line',
        source: 'islands',
        paint: {
          'line-color': token('rule'),
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 6, 1],
        },
      },

      /**
       * Roads, above the coastline because they are on the land.
       *
       * Dashed, and that is the whole argument for how they read. A road and
       * a river are both thin lines crossing the same region fills, and at
       * one pixel neither width nor colour alone separates them — but a
       * broken line is unmistakably a made thing, and it is the convention
       * every printed atlas already uses. Colour reinforces it (warm against
       * the water's cold) rather than carrying it alone.
       *
       * They arrive late, at z4.6. Roads are the densest linework on the map
       * and the reveal ladder exists so nothing competes with the step before
       * it; at the opening view twelve dashed lines across the continent is
       * noise on a shape you have not read yet.
       */
      {
        id: 'road',
        type: 'line',
        source: 'roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': token('road'),
          // Upstream's own hierarchy: 2 is a named highway, 1 a lesser track.
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            4, ['match', ['get', 'size'], 2, 0.7, 0.5],
            8, ['match', ['get', 'size'], 2, 1.8, 1.1],
          ],
          // Dash lengths are in line-widths, so they scale with the stroke and
          // the pattern stays proportional instead of dissolving as you zoom.
          'line-dasharray': [3, 2.5],
          'line-opacity': [
            'interpolate', ['linear'], ['zoom'],
            4.6, 0,
            5.4, ['match', ['get', 'size'], 2, 0.85, 0],
            6.2, 0.85,
          ],
        },
      },

      /**
       * The Wall.
       *
       * Deliberately not drawn as a road — it is the northern border of the
       * realm, and a dashed track would be the one place this map actively
       * misleads about the world. Three strokes: a soft cold glow, the solid
       * ice line, and a hairline crown. Together they read as a built thing
       * with mass, at a weight nothing else on the map carries.
       *
       * It is the only feature exempt from the reveal ladder. The Wall is
       * visible from the opening view because it is the single most
       * recognisable thing in Westeros and it *is* the north edge of the
       * settled world — introducing it late would be like fading in the
       * coastline.
       */
      {
        id: 'wall-glow',
        type: 'line',
        source: 'wall',
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': token('wall'),
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 4, 8, 14],
          'line-blur': ['interpolate', ['linear'], ['zoom'], 3, 3, 8, 10],
          'line-opacity': 0.22,
        },
      },
      {
        id: 'wall',
        type: 'line',
        source: 'wall',
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': token('wall'),
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.4, 8, 4.5],
          'line-opacity': 0.9,
        },
      },

      /**
       * Sea and bay names.
       *
       * Ordering is load-bearing and was got wrong once: placed before the
       * land fill, the labels are laid out correctly and then painted over by
       * `land-shelf`'s blur and the region fills — present in
       * `querySourceFeatures`, absent from the screen, no error. They have to
       * sit above every fill. They stay *below* the island and settlement
       * labels so land names win the pixels where the two collide.
       *
       * Wide-tracked uppercase is the cartographic convention for water, and
       * it does the same job italics would without needing a second font: it
       * separates water from land at a glance, before the name is read.
       */
      {
        id: 'sea-label',
        type: 'symbol',
        source: 'seaLabels',
        // Visible from the opening view; see SEA_LABEL_SIZE.
        minzoom: 2,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['literal', ['Inter Regular']],
          'text-size': SEA_LABEL_SIZE,
          /**
           * Tracking tightens as the map zooms out. At the opening view a
           * bay is only ~18px wide while its name is ~90px, so the wide
           * setting that reads well up close is what loses the placement.
           */
          'text-letter-spacing': [
            'interpolate', ['linear'], ['zoom'],
            3, 0.08,
            6, 0.2,
          ],
          'text-transform': 'uppercase',
          /**
           * Narrow enough to wrap "Blackwater Bay" onto two lines. A stacked
           * name fits a bay that a single line overshoots, which is the usual
           * cartographic answer for water too small for its own label.
           */
          'text-max-width': 5,
          'text-padding': 2,
          // Seas yield to everything: islands sort at 10, settlements below.
          'symbol-sort-key': 20,
        },
        paint: {
          /**
           * Between ink-faint and ink-muted, and it has to be: at ink-faint
           * (3.5:1) these vanish into the darkest water on screen, and at
           * ink-muted (7.3:1) they read as loudly as the settlements. Mixing
           * toward the muted step keeps them subordinate but legible.
           */
          'text-color': token('ink-sea'),
          'text-halo-color': token('sea'),
          // Wider than the land labels: a sea name crosses region fills and
          // island shelves, and the casing is what keeps it off them.
          'text-halo-width': 1.4,
          'text-halo-blur': 0.4,
        },
      },

      /**
       * Island names. Wide-tracked and quiet — these label a territory rather
       * than a point, so they sit closer to the region labels in feeling than
       * to the settlement labels, and never compete with them.
       */
      {
        id: 'island-label',
        type: 'symbol',
        source: 'islandLabels',
        minzoom: 4,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['literal', ['Inter Regular']],
          'text-size': ISLAND_LABEL_SIZE,
          'text-letter-spacing': 0.14,
          'text-transform': 'uppercase',
          'text-max-width': 8,
          'text-padding': 6,
          /**
           * Set the name in the water beside the island rather than on it.
           *
           * Most of these islands are narrower than their own name — Driftmark
           * is ~39px across at z6, "DRIFTMARK" is ~56px — so a label placed on
           * the land is unreadable and loses every collision to the settlements
           * sitting on top of it. Offsetting it clear of the coast is the
           * standard cartographic answer for small islands.
           *
           * The offset has to track zoom: the island's half-width is a fixed
           * number of degrees, but `text-radial-offset` is in ems, and the
           * ratio between them changes by more than 10x across the zoom range.
           * ISLAND_LABEL_OFFSET computes it per frame.
           */
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': ISLAND_LABEL_OFFSET,
          'text-justify': 'auto',
          // Islands yield to settlements: they are context, not the answer.
          // (Promoting a selected island is not possible — layout properties
          // cannot read feature state. See LABEL_SORT.)
          'symbol-sort-key': 10,
        },
        paint: {
          // ink-muted (7.3:1 on sea) rather than ink-faint (3.5:1): these are
          // real labels, so they clear AA even though they sit back visually.
          // Selection lifts to brass, matching the settlement labels — an
          // island is searchable, so it needs the same "this is the one you
          // asked for" cue rather than flying you to an unmarked shape.
          'text-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], token('brass'),
            token('ink-muted'),
          ],
          'text-halo-color': token('sea'),
          'text-halo-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 2.2,
            1.1,
          ],
        },
      },

      /**
       * Region names. The largest type on the map, wide-tracked caps in a
       * pale tint of the territory's own hue — the name and the fill say the
       * same thing, so the map needs no colour key to be read.
       *
       * `symbol-sort-key` -1 puts these ahead of *everything*, settlements
       * included. That inversion is deliberate and was measured: at the
       * opening view the continent is ~280px wide, a wide-tracked region name
       * is wider than the territory it names, and sorting them below the
       * cities left 1 of 10 on screen. At the zoom where you are asking
       * "which kingdom is this?", the kingdom's name outranks a castle — and
       * by z6 the labels have faded back (REGION_LABEL_OPACITY) so the
       * settlements own the map again.
       */
      {
        id: 'region-label',
        type: 'symbol',
        source: 'regionLabels',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['literal', ['Inter Medium']],
          'text-size': REGION_LABEL_SIZE,
          // Tracking tightens as the map zooms out, where the name has to fit
          // a territory only a couple of hundred pixels across.
          'text-letter-spacing': [
            'interpolate', ['linear'], ['zoom'],
            3, 0.06,
            6, 0.22,
          ],
          'text-transform': 'uppercase',
          // Wraps "The Westerlands" and "Lands Beyond the Wall" onto two or
          // three lines so a name sits inside its own territory.
          'text-max-width': 7,
          'text-line-height': 1.4,
          'text-padding': 2,
          /**
           * Let the name move rather than be dropped.
           *
           * Fixed at the centroid, 8 of 10 regions lost their label to a
           * settlement sitting on the same pixels (proved by flipping
           * `text-allow-overlap` on: all 8 reappeared). A region is a big
           * area, so the name does not have to sit at its exact centre —
           * sliding a little in any direction usually finds empty land.
           */
          'text-variable-anchor': [
            'center', 'top', 'bottom', 'left', 'right',
            'top-left', 'top-right', 'bottom-left', 'bottom-right',
          ],
          'text-radial-offset': 1.2,
          'text-justify': 'auto',
          'symbol-sort-key': -1,
        },
        paint: {
          // Each name in a pale tint of its own territory's hue.
          'text-color': regionLabelColor(),
          // Regions are the one label that sits over its own colour fill, so
          // the halo is the land beneath rather than the sea. A wide, soft
          // casing is what lets a saturated tint stay legible where the name
          // crosses from its own fill onto a neighbour's.
          'text-halo-color': token('land'),
          'text-halo-width': 1.8,
          'text-halo-blur': 0.8,
          'text-opacity': REGION_LABEL_OPACITY,
        },
      },

      // Settlement marks. SDF icons, so `icon-color` recolours them per state.
      {
        id: 'place-dot',
        type: 'symbol',
        source: 'places',
        layout: {
          'icon-image': [
            'match', ['get', 'type'],
            'City', 'place-city',
            'Town', 'place-town',
            'Castle', 'place-castle',
            'Ruin', 'place-ruin',
            'place-other',
          ],
          // Circles and triangles read at far smaller sizes than pictograms
          // do, so these sit back down where a map mark belongs.
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            3, seatOr(0.48, ['match', ['get', 'type'], 'City', 0.5, 'Town', 0.45, 'Other', 0.38, 0.42]),
            7, seatOr(0.7, ['match', ['get', 'type'], 'City', 0.72, 'Town', 0.64, 'Other', 0.52, 0.6]),
          ],
          // The icon is the anchor for the label, so it must never be dropped
          // by collision — the label moves around it instead.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-sort-key': LABEL_SORT,
        },
        paint: {
          'icon-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], token('brass'),
            ['get', 'seat'], token('ink'),
            ['match', ['get', 'type'],
              'City', token('ink'),
              'Town', token('ink'),
              token('ink-muted')],
          ],
          'icon-opacity': REVEAL_AT_ZOOM,
          // A faint casing so marks stay legible over region fills.
          'icon-halo-color': token('sea'),
          'icon-halo-width': 1,
        },
      },

      /**
       * Road names, set along the line rather than beside it.
       *
       * `symbol-placement: 'line'` is the whole point: a road name that sits
       * in a horizontal block next to a winding road belongs to nothing in
       * particular, where one that bends along the route is unambiguous. Only
       * the six named roads carry labels; the unnamed tracks are texture.
       *
       * Sorted last (high sort key) so a road name never wins a collision
       * against a settlement — the settlements are the subject, the roads are
       * how you get between them.
       */
      {
        id: 'road-label',
        type: 'symbol',
        source: 'roads',
        filter: ['has', 'name'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['literal', ['Inter Medium']],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 9, 8, 11.5],
          'symbol-placement': 'line',
          'text-letter-spacing': 0.08,
          // Repeat on long roads: the Kingsroad spans the continent, and one
          // label in the middle leaves both ends unidentified.
          'symbol-spacing': 260,
          'text-max-angle': 32,
          'text-padding': 6,
          'symbol-sort-key': 20,
        },
        paint: {
          'text-color': token('road'),
          'text-halo-color': token('sea'),
          'text-halo-width': 1.4,
          'text-halo-blur': 0.3,
          'text-opacity': [
            'interpolate', ['linear'], ['zoom'],
            5.2, 0,
            6, 1,
          ],
        },
      },

      /**
       * The Wall's name, along the line and in its own ice colour.
       *
       * Wide-tracked caps, the same convention the sea labels use, because
       * this is a feature of the world rather than a settlement — and at the
       * scale it appears, letter-spacing is what makes four characters read
       * as a 300-mile structure rather than a small label.
       */
      {
        id: 'wall-label',
        type: 'symbol',
        source: 'wall',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['literal', ['Inter Medium']],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3.4, 9, 7, 13],
          'symbol-placement': 'line',
          'text-letter-spacing': 0.22,
          'text-transform': 'uppercase',
          'text-offset': [0, -1.2],
          'symbol-sort-key': 0,
          'text-padding': 4,
        },
        paint: {
          'text-color': token('wall'),
          'text-halo-color': token('sea'),
          'text-halo-width': 1.6,
          'text-halo-blur': 0.4,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 3.2, 0, 3.9, 1],
        },
      },

      // Place labels. Collision detection is the point of this layer.
      {
        id: 'place-label',
        type: 'symbol',
        source: 'places',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': LABEL_FONT,
          'text-size': LABEL_SIZE,
          // Cities carry the wide-tracked caps of cartographic convention;
          // everything else stays sentence case (The Label Casing Rule).
          'text-transform': [
            'match', ['get', 'type'], 'City', 'uppercase', 'none',
          ],
          'text-letter-spacing': [
            'match', ['get', 'type'], 'City', 0.09, 0,
          ],
          // Prefer to the right of the dot, but MapLibre may pick any of these
          // to resolve a collision — this is what replaces the hand-kept
          // ANCHOR_LEFT list the DOM markers needed.
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          // Clears the icon, which is larger than the dot it replaced.
          'text-radial-offset': 1,
          'text-justify': 'auto',
          'symbol-sort-key': LABEL_SORT,
          'text-padding': 4,
        },
        paint: {
          'text-color': labelColor(),
          // The Halo Rule: every label carries a casing in the ground colour.
          'text-halo-color': token('sea'),
          // A wider, tighter casing on the selected name. The halo stays the
          // *ground* colour rather than turning brass — a coloured halo reads
          // as a glow and puts a data hue into what is really chrome. Widening
          // it instead pushes the neighbours back and lets the name sit in its
          // own clearing, which is what makes it findable in a dense field.
          'text-halo-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 2.4,
            1.2,
          ],
          'text-halo-blur': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 0.2,
            0.4,
          ],
          'text-opacity': BASE_LABEL_OPACITY,
        },
      },

      /**
       * The one place the reader explicitly asked for must never lose a label
       * collision.
       *
       * Feature state is legal in paint but not in layout or filters, so the
       * normal label layer cannot make a selected name win placement. This
       * second layer is filtered dynamically by `main.ts` to one feature and
       * opts that feature out of collision. `text-ignore-placement` also means
       * it does not push the surrounding map labels around when it appears.
       */
      {
        id: 'selected-place-label',
        type: 'symbol',
        source: 'places',
        filter: ['==', ['id'], -1],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': LABEL_FONT,
          'text-size': LABEL_SIZE,
          'text-transform': [
            'match', ['get', 'type'], 'City', 'uppercase', 'none',
          ],
          'text-letter-spacing': [
            'match', ['get', 'type'], 'City', 0.09, 0,
          ],
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 1,
          'text-justify': 'auto',
          'text-padding': 4,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': token('brass'),
          'text-halo-color': token('sea'),
          'text-halo-width': 2.4,
          'text-halo-blur': 0.2,
        },
      },
    ],
  } as StyleSpecification;
}
