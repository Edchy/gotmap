/**
 * Fetches the upstream GoT GeoJSON layers and prepares the slice's data.
 *
 * Source: github.com/mapbox/GOT-Inspired-Map (GoTRelease/)
 * Lineage: Tear (Cartographer's Guild) -> theMountainGoat (2012) -> cadaei (QGIS)
 * Licence: CC BY-NC-SA 3.0. Non-commercial, attribution required, share-alike.
 *
 * Run: node scripts/prepare-data.mjs
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE =
  'https://raw.githubusercontent.com/mapbox/GOT-Inspired-Map/master/GoTRelease';
const OUT = join(process.cwd(), 'public', 'data');

// Upstream filename for the political layer is misspelled.
const LAYERS = {
  continents: 'got_continents',
  political: 'got_politcal',
  locations: 'got_locations',
  islands: 'got_islands',
  // Seas, bays and terrain. 56 features; only the 28 `water` ones are used.
  // The forest/mountain/shore features are deliberately left alone: there are
  // only 7 forests and 4 ranges for the whole world, so drawing them asserts
  // by omission that everywhere else is bare. Built once and reverted — see
  // ROADMAP.md section 1 for the full finding before trying again.
  regions: 'got_regions',
  rivers: 'got_rivers',
  lakes: 'got_lakes',
  roads: 'got_roads',
  wall: 'got_wall',
};

/**
 * Westeros and its waters; Essos and Sothoryos are out of scope.
 *
 * The eastern edge sits at 29.4 to take in the Stepstones (x=26.5-29.3), the
 * contested chain between the continents — they matter to the story and read
 * as Westerosi waters. Tyrosh (x=28.5) falls inside that span, so the Free
 * Cities are excluded by name instead of by geometry (see ESSOS_PLACES).
 */
const WESTEROS_BBOX = { minX: -2, minY: -14, maxX: 29.4, maxY: 52 };

/**
 * Free Cities and other Essosi settlements that fall inside the bbox once it
 * is widened for the Stepstones. Excluded by name: the slice is Westeros.
 */
const ESSOS_PLACES = new Set([
  'Tyrosh',
  'Lys',
  'Myr',
  'Pentos',
  'Braavos',
  'Norvos',
  'Qohor',
  'Volantis',
]);

/**
 * Misspellings in the upstream `got_locations` layer.
 *
 * Kept as an explicit, minimal table rather than fixed by hand in the output:
 * `prepare-data.mjs` refetches from source, so a hand edit would be silently
 * undone on the next run. Each entry is a spelling error in the source data,
 * not an editorial rename — the atlas does not rename places it disagrees
 * with, it only corrects typos.
 *
 * Both were found by checking every place name against a wiki's page index:
 * a name that matches nothing is usually a name spelled wrong.
 */
const NAME_FIXES = new Map([
  ['Oakensheild', 'Oakenshield'],
  ["Lort Harroway's Town", "Lord Harroway's Town"],
]);

const fixName = (name) =>
  typeof name === 'string' ? (NAME_FIXES.get(name) ?? name) : name;

const fetchLayer = async (file) => {
  const res = await fetch(`${BASE}/${file}.geojson`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json();
};

/** Flatten any nested coordinate array into [x, y] pairs. */
function* coords(node) {
  if (typeof node[0] === 'number') {
    yield node;
    return;
  }
  for (const child of node) yield* coords(child);
}

const intersectsWesteros = (geometry) => {
  for (const [x, y] of coords(geometry.coordinates)) {
    if (
      x >= WESTEROS_BBOX.minX &&
      x <= WESTEROS_BBOX.maxX &&
      y >= WESTEROS_BBOX.minY &&
      y <= WESTEROS_BBOX.maxY
    ) {
      return true;
    }
  }
  return false;
};

/** Shoelace area of a linear ring, unsigned. */
const ringArea = (ring) => {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(sum / 2);
};

/** Area-weighted centroid of a linear ring. */
const ringCentroid = (ring) => {
  let x = 0;
  let y = 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += cross;
    x += (ring[j][0] + ring[i][0]) * cross;
    y += (ring[j][1] + ring[i][1]) * cross;
  }
  // Degenerate ring (zero area): fall back to the first vertex.
  if (a === 0) return [ring[0][0], ring[0][1]];
  return [x / (3 * a), y / (3 * a)];
};

/** Is a point inside a linear ring? Even-odd ray cast. */
const inRing = (ring, x, y) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

/** Shortest distance from a point to a ring's edges, in degrees. */
const distToRing = (ring, x, y) => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const dx = xj - xi;
    const dy = yj - yi;
    const len = dx * dx + dy * dy;
    let t = len === 0 ? 0 : ((x - xi) * dx + (y - yi) * dy) / len;
    t = Math.max(0, Math.min(1, t));
    const px = xi + t * dx;
    const py = yi + t * dy;
    best = Math.min(best, Math.hypot(x - px, y - py));
  }
  return best;
};

/**
 * A label point that is actually *inside* the water, not merely at its
 * average position.
 *
 * A centroid is fine for a blob and wrong for a bay: Saltspear and Ironman's
 * Bay are concave enough that their centroid falls on the far shore, and the
 * label was drawn across land. This finds the pole of inaccessibility — the
 * interior point furthest from any edge — by sampling a grid over the ring's
 * bounding box and keeping the deepest hit. Coarse, but these are label
 * anchors, not geometry, and it is stable and dependency-free.
 */
const poleOfInaccessibility = (ring) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }

  const STEPS = 48;
  let best = null;
  let bestDist = -1;
  for (let i = 0; i <= STEPS; i++) {
    for (let j = 0; j <= STEPS; j++) {
      const x = x0 + ((x1 - x0) * i) / STEPS;
      const y = y0 + ((y1 - y0) * j) / STEPS;
      if (!inRing(ring, x, y)) continue;
      const d = distToRing(ring, x, y);
      if (d > bestDist) {
        bestDist = d;
        best = [x, y];
      }
    }
  }
  // No sample landed inside (a sliver thinner than the grid): fall back.
  return best ?? ringCentroid(ring);
};

/** Total length of a line geometry, in degrees. */
function lineLength(geometry) {
  const lines =
    geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  let sum = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      sum += Math.hypot(
        line[i][0] - line[i - 1][0],
        line[i][1] - line[i - 1][1],
      );
    }
  }
  return sum;
}

/** Width and height of a geometry's bounding box, in degrees. */
function extent(geometry) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of coords(geometry.coordinates)) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x1 - x0, y1 - y0];
}

/**
 * A single point to hang a polygon's label on. For a MultiPolygon this is the
 * centroid of the *largest* part, so an archipelago is labelled on its main
 * island rather than at the empty centre of its bounding box.
 */
function labelAnchor(geometry) {
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

  let best = null;
  let bestArea = -1;
  for (const polygon of polygons) {
    const outer = polygon[0];
    const area = ringArea(outer);
    if (area > bestArea) {
      bestArea = area;
      best = outer;
    }
  }
  return ringCentroid(best);
}

/**
 * Upstream `size` is fully redundant with `type` (1=Other, 2=Ruin, 3=Castle,
 * 4=Town, 5=City), so the label hierarchy is driven from `type` alone and
 * `size` is dropped. `confirmed: 0` marks speculative placements, which the
 * UI hides by default — a map that claims precision shouldn't show guesses.
 */
const LOCATION_RANK = { City: 4, Town: 3, Castle: 2, Ruin: 1, Other: 0 };

/**
 * The seats of the houses that rule the regions this map draws.
 *
 * 105 of the 151 confirmed places are `Castle`, so without this Winterfell
 * renders identically to a holdfast nobody has heard of and the map fails to
 * say anything about who runs the world. The upstream data has no field for
 * it: `size` is redundant with `type`, and `type` cannot distinguish a
 * kingdom's capital from a minor keep.
 *
 * **Derived from the political layer, not from taste.** Every entry is the
 * canonical seat of a house that appears as `claimedBy` on a region in
 * `got_politcal` — nine great houses, nine seats, checked against that layer
 * at build time so the two cannot drift apart. That rule is what keeps this
 * from becoming a list of personal favourites: Harrenhal is the largest
 * castle in Westeros and is *not* here, because no region is held by its
 * ruined house.
 *
 * The Night's Watch and the Wildlings also hold territory but have no seat in
 * the same sense — Castle Black commands the Wall rather than ruling the
 * Gift — so neither is promoted. They keep the Wall, which the map already
 * draws from the opening view.
 */
const GREAT_SEATS = new Map([
  ['Winterfell', 'Stark'],
  ['Casterly Rock', 'Lannister'],
  ['Highgarden', 'Tyrell'],
  ['Riverrun', 'Tully'],
  ["Storm's End", 'Baratheon'],
  ['Sunspear', 'Martell'],
  ['The Eyrie', 'Arryn'],
  ['Pyke', 'Greyjoy'],
  // The Targaryen seat. King's Landing is the Crownlands' city and already a
  // City; Dragonstone is the ancestral seat and is the one that needs lifting.
  ['Dragonstone', 'Targaryen'],
]);

/**
 * Rank and seat flag for a place.
 *
 * A great seat is promoted to rank 5 — above City (4), because a kingdom's
 * capital outranks an ordinary city in political weight even when it is
 * smaller. Rank drives `symbol-sort-key`, so this also decides who survives a
 * label collision: Winterfell now wins against the holdfasts around it.
 *
 * `seat` is emitted as its own boolean rather than left implicit in the rank,
 * because the style needs to branch on "is this a great seat" for size and
 * colour, and `['==', ['get', 'rank'], 5]` in five places would encode the
 * same fact five times.
 */
const seatProps = (name, type) => {
  if (!GREAT_SEATS.has(name)) {
    return { rank: LOCATION_RANK[type] ?? 0, seat: false };
  }
  /*
   * A seat is promoted to *one above its own type*, not to a flat 5.
   *
   * A flat 5 put Dragonstone above King's Landing, which is the wrong claim:
   * it is the ancestral Targaryen seat, but the capital of the realm is the
   * place a viewer is overwhelmingly more likely to want, and a mostly-empty
   * island castle outranking it overstates the case. Promoting relative to
   * type keeps every seat ahead of the ordinary castles around it while
   * leaving cities above castles, which is the order the world actually has.
   */
  return { rank: (LOCATION_RANK[type] ?? 0) + 1, seat: true };
};

/**
 * Known gaps in the upstream dataset, reported after each run so they aren't
 * mistaken for pipeline bugs. Casterly Rock is genuinely absent upstream.
 */
const EXPECTED_PLACES = [
  'Winterfell',
  "King's Landing",
  'Oldtown',
  "Storm's End",
  'Casterly Rock',
  'The Eyrie',
  'Sunspear',
  'Pyke',
  'Highgarden',
  'White Harbor',
];

async function main() {
  await mkdir(OUT, { recursive: true });

  const [
    continents,
    political,
    locations,
    islands,
    terrain,
    rawRivers,
    rawLakes,
    rawRoads,
    rawWall,
  ] = await Promise.all(Object.values(LAYERS).map(fetchLayer));

  const westeros = {
    type: 'FeatureCollection',
    features: continents.features.filter(
      (f) => f.properties.name === 'Westeros',
    ),
  };

  /**
   * Essos and Sothoryos, as bare landmasses.
   *
   * Kept in their own source rather than folded into `westeros` because they
   * are a different *kind* of thing on this map: unlabelled, unclaimed, not
   * clickable, and drawn a step back from the subject. The slice is still
   * Westeros (see PRODUCT.md) — these exist so the Narrow Sea has a far
   * shore and the map stops looking like Westeros floats in a void.
   *
   * They are deliberately *not* added to WESTEROS_BBOX or the camera bounds:
   * Essos is 2.5x the width of Westeros, so fitting both would shrink the
   * subject to 0.72x and flip the frame from tall to square. Panning east
   * finds them; the opening view is unchanged.
   */
  const neighbours = {
    type: 'FeatureCollection',
    features: continents.features
      .filter((f) => f.properties.name !== 'Westeros')
      .map((f, i) => ({
        type: 'Feature',
        id: i,
        geometry: f.geometry,
        properties: { name: f.properties.name },
      })),
  };

  const regions = {
    type: 'FeatureCollection',
    features: political.features
      .filter((f) => intersectsWesteros(f.geometry))
      .map((f, i) => ({
        type: 'Feature',
        // Feature state needs a stable id; upstream ids collide across layers.
        id: i,
        geometry: f.geometry,
        properties: {
          // One upstream feature (the wildling lands) has a null name.
          name: f.properties.name ?? 'Lands Beyond the Wall',
          claimedBy: f.properties.ClaimedBy ?? 'Unclaimed',
        },
      })),
  };

  /**
   * Region labels — one point per territory.
   *
   * A symbol layer over the region polygons would print a name per *part*,
   * and these are mostly multipart (The North has 7, the Stormlands 8), so
   * this emits one point anchored on each region's largest part — the same
   * trick the island labels use.
   *
   * The centroid is enough here: checked against every region, each one falls
   * inside its own largest part, so the pole-of-inaccessibility pass the seas
   * needed is unnecessary.
   *
   * The two Gifts are dropped. They are slivers (area 6.3 and 5.7 against the
   * North's 229) held by the Night's Watch, and at the zooms where region
   * names are legible their labels sit on top of each other and of the Wall.
   * The map says "New Gift" in the panel when you click; it does not need to
   * shout it across the Wall.
   */
  const GIFTS = new Set(['New Gift', "Bran's Gift"]);

  const regionLabels = {
    type: 'FeatureCollection',
    features: regions.features
      .filter((f) => !GIFTS.has(f.properties.name))
      .map((f, i) => ({
        type: 'Feature',
        id: i,
        geometry: { type: 'Point', coordinates: labelAnchor(f.geometry) },
        properties: {
          name: f.properties.name,
          claimedBy: f.properties.claimedBy,
        },
      })),
  };

  /**
   * Names already carried by a settlement, so an island label isn't printed
   * for the same thing twice. Built from the raw layer plus our additions,
   * since both feed the places source.
   */
  const additionsRaw = JSON.parse(
    await readFile(join(process.cwd(), 'data', 'additions.json'), 'utf8'),
  );
  const placeNames = new Set([
    ...locations.features.map((f) => f.properties.name),
    ...additionsRaw.places.map((a) => a.name),
  ]);

  /**
   * Islands are a separate upstream layer and carry names the locations layer
   * lacks — Driftmark, Claw Isle, the Stepstones, Bear Island, Tarth. Without
   * them, places like Dragonstone render as labels floating in open sea.
   */
  const islandFeatures = {
    type: 'FeatureCollection',
    features: islands.features
      .filter((f) => intersectsWesteros(f.geometry))
      .map((f, i) => ({
        type: 'Feature',
        id: i,
        geometry: f.geometry,
        properties: { name: f.properties.name ?? null },
      })),
  };

  /**
   * Label anchors for islands, one point per *name*.
   *
   * A symbol layer over polygons labels every polygon, so an archipelago held
   * as a single MultiPolygon (the Stepstones are 13 parts, the Shield Islands
   * 4) prints its name once per islet. Emitting a separate point layer for the
   * labels — anchored on the largest part, which is the one a reader looks at
   * — gives exactly one label per island group.
   */
  const islandLabels = {
    type: 'FeatureCollection',
    features: islandFeatures.features
      .filter((f) => f.properties.name)
      .map((f, i) => {
        const [w, h] = extent(f.geometry);
        return {
          type: 'Feature',
          id: i,
          geometry: { type: 'Point', coordinates: labelAnchor(f.geometry) },
          properties: {
            name: f.properties.name,
            /**
             * Half the island's width and height, in degrees. The style turns
             * these into a radial offset so the label clears the coastline —
             * most of these islands are narrower than their own name (
             * Driftmark is ~39px wide at z6; "DRIFTMARK" is ~56px), so the
             * name has to sit in the water beside them.
             */
            halfWidth: +(w / 2).toFixed(4),
            halfHeight: +(h / 2).toFixed(4),
          },
        };
      })
      /**
       * Drop an island label that a settlement already names. Dragonstone the
       * island and Dragonstone the castle are the same answer to the reader's
       * question, and the settlement label is the more useful of the two —
       * printing both wastes space and loses the collision anyway.
       */
      .filter((f) => !placeNames.has(f.properties.name)),
  };

  /**
   * Sea labels, from the `water` features of the terrain layer.
   *
   * Two things make this less mechanical than "filter type === water".
   *
   * 1. The layer's `water` type is really "named feature of the coast": it
   *    includes headlands and island groups — Cape Kraken, Massey's Hook, The
   *    Fingers, Sea Dragon Point, Storrold's Point, the Iron Islands. Labelling
   *    a cape as if it were a sea is worse than not labelling it, and the Iron
   *    Islands already carry an island label, so these are excluded by name.
   * 2. Several genuine seas belong to Essos and Sothoryos (the Jade Sea, the
   *    Smoking Sea, the Gulf of Grief, the Sea of Myrth). The bbox test admits
   *    them because their polygons are enormous and clip the frame's edge, so
   *    the anchor point — not the polygon — decides membership.
   */
  const NOT_SEAS = new Set([
    'Cape Kraken',
    'Cape of Eagles',
    "Massey's Hook",
    'The Fingers',
    'Sea Dragon Point',
    "Storrold's Point",
    'Iron Islands',
  ]);

  const seaLabels = {
    type: 'FeatureCollection',
    features: terrain.features
      .filter((f) => f.properties.type === 'water')
      .filter((f) => f.properties.name && !NOT_SEAS.has(f.properties.name))
      .map((f) => {
        // Largest ring, then its deepest interior point — see
        // poleOfInaccessibility for why a centroid will not do here.
        const polygons =
          f.geometry.type === 'Polygon'
            ? [f.geometry.coordinates]
            : f.geometry.coordinates;
        let outer = null;
        let bestArea = -1;
        for (const polygon of polygons) {
          const area = ringArea(polygon[0]);
          if (area > bestArea) {
            bestArea = area;
            outer = polygon[0];
          }
        }
        return {
          name: f.properties.name,
          anchor: poleOfInaccessibility(outer),
        };
      })
      /**
       * Keep a sea only if the point its label would actually occupy falls in
       * frame. The Summer Sea and the Shivering Sea both stretch off to Essos;
       * anchoring on the largest ring keeps their names in Westerosi water.
       */
      .filter(
        ({ anchor: [x, y] }) =>
          x >= WESTEROS_BBOX.minX &&
          x <= WESTEROS_BBOX.maxX &&
          y >= WESTEROS_BBOX.minY &&
          y <= WESTEROS_BBOX.maxY,
      )
      .map((s, i) => ({
        type: 'Feature',
        id: i,
        geometry: { type: 'Point', coordinates: s.anchor },
        properties: { name: s.name },
      })),
  };

  /**
   * Roads. 12 in Westeros, 6 named.
   *
   * **`size` is real here**, which is worth stating because it is a dead end
   * on rivers (null on 73 of 74). On roads it is populated on every feature
   * and it agrees with the fiction: the four size-2 roads are exactly the
   * named highways — the Kingsroad, Goldroad, Roseroad and Oceanroad — and
   * they are also the four longest. So the hierarchy is taken straight from
   * the data rather than derived from length as rivers' width is.
   *
   * The `continent` field does the filtering that a bbox test would do badly:
   * 9 of the 21 roads are Essosi, and some run close enough to the frame's
   * eastern edge that geometry alone would admit them.
   */
  const roads = {
    type: 'FeatureCollection',
    features: rawRoads.features
      .filter((f) => f.properties.continent === 'Westeros')
      .filter((f) => intersectsWesteros(f.geometry))
      .map((f, i) => ({
        type: 'Feature',
        id: i,
        geometry: f.geometry,
        properties: {
          name: f.properties.name ?? null,
          // 2 = named highway, 1 = lesser track. Upstream's own hierarchy.
          size: f.properties.size ?? 1,
        },
      })),
  };

  /**
   * The Wall. One feature, 12 points, 4.38 degrees of it.
   *
   * Kept in its own file rather than folded into `roads` because it is not a
   * road: it is the northern border of the realm and the map should say so.
   * Drawing it as a track would be the one place this atlas actively misleads
   * about the world.
   *
   * The geometry registers against the settlements exactly — the east end is
   * Eastwatch-by-the-Sea (20.72, 34.79) to two decimals, the west end is the
   * Shadow Tower, and Castle Black falls on the line between them — so no
   * adjustment is needed or wanted.
   */
  const wall = {
    type: 'FeatureCollection',
    features: rawWall.features.map((f, i) => ({
      type: 'Feature',
      id: i,
      geometry: f.geometry,
      properties: { name: f.properties.name ?? 'The Wall' },
    })),
  };

  /**
   * Rivers, with a width hierarchy derived from length.
   *
   * The upstream `size` property is advertised as the hierarchy but is null on
   * 73 of 74 features (only the Blackwater Rush carries one), so it is useless
   * as authored. Total length in degrees is a good proxy for how major a river
   * is — the Trident's forks, the Mander and the Blackwater Rush come out on
   * top, which is the right answer — and it degrades gracefully for the 25
   * unnamed tributaries that also need a width.
   */
  const rivers = {
    type: 'FeatureCollection',
    features: rawRivers.features
      .filter((f) => intersectsWesteros(f.geometry))
      .map((f, i) => ({
        type: 'Feature',
        id: i,
        geometry: f.geometry,
        properties: {
          name: f.properties.name ?? null,
          length: +lineLength(f.geometry).toFixed(3),
        },
      })),
  };

  /**
   * Lakes. Nineteen upstream, six named; the rest are unnamed tarns that still
   * belong on the map as water.
   *
   * God's Eye is the interesting one: the Isle of Faces sits inside it, and the
   * lake polygon has no hole punched for the island. Rather than doing polygon
   * arithmetic, the style draws the lake *below* the island fill — see the
   * layer order in map-style.ts. It is the only island-in-lake on the map
   * (verified against every lake/island pair), so ordering is the whole fix.
   */
  const lakes = {
    type: 'FeatureCollection',
    features: rawLakes.features
      .filter((f) => intersectsWesteros(f.geometry))
      .map((f, i) => ({
        type: 'Feature',
        id: i,
        geometry: f.geometry,
        properties: { name: f.properties.name ?? null },
      })),
  };

  const upstreamPlaces = locations.features
    .filter((f) => intersectsWesteros(f.geometry))
    .filter((f) => !ESSOS_PLACES.has(f.properties.name))
    // One upstream location has a null name. An unnamed point can't be
    // labelled or searched for, so it is dropped rather than rendered blank.
    .filter((f) => typeof f.properties.name === 'string' && f.properties.name)
    .map((f) => {
      const name = fixName(f.properties.name);
      return {
        geometry: f.geometry,
        properties: {
          name,
          type: f.properties.type,
          ...seatProps(name, f.properties.type),
          confirmed: f.properties.confirmed === 1,
          added: false,
        },
      };
    });

  const additions = additionsRaw.places;

  const addedPlaces = additions
    .filter((a) => !upstreamPlaces.some((p) => p.properties.name === a.name))
    .map((a) => ({
      geometry: { type: 'Point', coordinates: a.coordinates },
      properties: {
        name: a.name,
        type: a.type,
        // Casterly Rock is both hand-placed and a great seat; the promotion
        // has to apply here too or the Lannister seat alone stays a holdfast.
        ...seatProps(a.name, a.type),
        confirmed: true,
        // Flags this point as ours rather than cadaei's, so the distinction
        // stays visible in the data and can be surfaced in the UI.
        added: true,
        note: a.note,
      },
    }));

  const places = {
    type: 'FeatureCollection',
    // Ids are assigned last: MapLibre feature state keys off them, so they
    // must be stable and unique across upstream and added features alike.
    features: [...upstreamPlaces, ...addedPlaces].map((f, i) => ({
      type: 'Feature',
      id: i,
      ...f,
    })),
  };

  await Promise.all([
    writeFile(join(OUT, 'westeros.geojson'), JSON.stringify(westeros)),
    writeFile(join(OUT, 'neighbours.geojson'), JSON.stringify(neighbours)),
    writeFile(join(OUT, 'regions.geojson'), JSON.stringify(regions)),
    writeFile(join(OUT, 'places.geojson'), JSON.stringify(places)),
    writeFile(join(OUT, 'islands.geojson'), JSON.stringify(islandFeatures)),
    writeFile(join(OUT, 'island-labels.geojson'), JSON.stringify(islandLabels)),
    writeFile(join(OUT, 'sea-labels.geojson'), JSON.stringify(seaLabels)),
    writeFile(join(OUT, 'region-labels.geojson'), JSON.stringify(regionLabels)),
    writeFile(join(OUT, 'rivers.geojson'), JSON.stringify(rivers)),
    writeFile(join(OUT, 'lakes.geojson'), JSON.stringify(lakes)),
    writeFile(join(OUT, 'roads.geojson'), JSON.stringify(roads)),
    writeFile(join(OUT, 'wall.geojson'), JSON.stringify(wall)),
  ]);

  const confirmed = places.features.filter((f) => f.properties.confirmed);
  console.log(`westeros  ${westeros.features.length} feature`);
  console.log(
    `neighbours ${neighbours.features.length} features ` +
      `(${neighbours.features.map((f) => f.properties.name).join(', ')})`,
  );
  console.log(
    `regions   ${regions.features.length} features ` +
      `(${regionLabels.features.length} labelled)`,
  );
  const namedIslands = islandFeatures.features.filter((f) => f.properties.name);
  console.log(
    `islands   ${islandFeatures.features.length} features ` +
      `(${islandLabels.features.length} labelled)`,
  );
  console.log(
    `places    ${places.features.length} features ` +
      `(${confirmed.length} confirmed, ${places.features.length - confirmed.length} speculative)`,
  );
  console.log(
    `seas      ${seaLabels.features.length} labels ` +
      `(${seaLabels.features.map((f) => f.properties.name).join(', ')})`,
  );
  const namedRivers = rivers.features.filter((f) => f.properties.name);
  console.log(
    `rivers    ${rivers.features.length} features (${namedRivers.length} named)`,
  );
  const namedLakes = lakes.features.filter((f) => f.properties.name);
  console.log(
    `lakes     ${lakes.features.length} features ` +
      `(${namedLakes.map((f) => f.properties.name).join(', ')})`,
  );

  const namedRoads = roads.features.filter((f) => f.properties.name);
  console.log(
    `roads     ${roads.features.length} features ` +
      `(${namedRoads.map((f) => f.properties.name).join(', ')})`,
  );
  console.log(`wall      ${wall.features.length} feature`);

  if (addedPlaces.length) {
    console.log(
      `\nadded by hand: ${addedPlaces.map((f) => f.properties.name).join(', ')}`,
    );
  }

  const names = new Set(places.features.map((f) => f.properties.name));
  const absent = EXPECTED_PLACES.filter((n) => !names.has(n));
  if (absent.length) {
    console.log(`still absent: ${absent.join(', ')}`);
  }

  /*
   * The great-seat list is only defensible if every entry is the seat of a
   * house that actually rules a region here. Checking it against the political
   * layer on every run is what stops it drifting into a list of favourites —
   * and catches the likelier failure, a seat whose name stops matching after
   * an upstream rename.
   */
  const claimants = new Set(
    regions.features.map((f) => f.properties.claimedBy).filter(Boolean),
  );
  const promoted = places.features.filter((f) => f.properties.seat);
  const unmatched = [...GREAT_SEATS].filter(([n]) => !names.has(n));
  const unruled = [...GREAT_SEATS].filter(([, h]) => !claimants.has(h));

  console.log(
    `\ngreat seats: ${promoted.length}/${GREAT_SEATS.size} promoted ` +
      `(${promoted.map((f) => f.properties.name).join(', ')})`,
  );
  if (unmatched.length) {
    console.log(
      `  WARNING no such place: ${unmatched.map(([n]) => n).join(', ')} ` +
        `— renamed upstream? the promotion silently does nothing`,
    );
  }
  if (unruled.length) {
    console.log(
      `  WARNING house rules no region: ${unruled.map(([, h]) => h).join(', ')} ` +
        `— the seat no longer follows from the political layer`,
    );
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
