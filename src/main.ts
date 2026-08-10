import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl';
import type { MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry, Point, Position } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import './tokens.css';
import './app.css';
import { buildStyle } from './map-style';
import { applyTokens } from './palette';
import { registerIcons } from './icons';

type PlaceProps = {
  name: string;
  type: 'City' | 'Town' | 'Castle' | 'Ruin' | 'Other';
  rank: number;
  confirmed: boolean;
  /** True for points we placed ourselves, absent from the upstream dataset. */
  added: boolean;
  /** Why an added point sits where it does. Present only when `added`. */
  note?: string;
  /**
   * True for the seat of a house that rules one of the map's regions.
   *
   * Set in `prepare-data.mjs` from the political layer, not by hand here.
   * Lifts the nine ruling seats out of the 105 undifferentiated castles, in
   * label weight, size, ink and reveal zoom.
   */
  seat?: boolean;
  /**
   * Title of the wiki page describing this place, if one exists.
   *
   * Written by `scripts/check-wiki-links.mjs`, which verifies each name
   * against the wiki's own index. Absent means no page was found — either the
   * place is nameless upstream ("Village", "Holdfast") or the wiki simply
   * lacks it. Either way the UI renders no link rather than guessing at one.
   */
  wiki?: string;
};

type Place = {
  /** The feature's id in the places source, needed to drive selection state. */
  id: number;
  props: PlaceProps;
  lngLat: [number, number];
  region?: string;
};

/** Anything search can take you to. Places, regions and islands, uniformly. */
type Target =
  | { kind: 'place'; name: string; slug: string; place: Place }
  | {
      kind: 'region';
      name: string;
      slug: string;
      id: number;
      feature: Feature;
      wiki?: string;
    }
  | {
      kind: 'island';
      name: string;
      slug: string;
      /** Feature id in the islandLabels source, to drive the label highlight. */
      id: number;
      lngLat: [number, number];
      halfWidth: number;
      halfHeight: number;
      wiki?: string;
    };

const WESTEROS_BOUNDS: [[number, number], [number, number]] = [
  [0.4, -12],
  [26.8, 50],
];

// Must run before the map is constructed: the style reads these values.
applyTokens();

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="map" role="application" aria-label="Map of Westeros"></div>

  <header class="masthead">
    <h1>The Known World</h1>
    <p>Westeros</p>
  </header>

  <div class="search" id="search">
    <label class="search__label" for="search-input">Search the map</label>
    <input
      class="search__input"
      id="search-input"
      type="search"
      autocomplete="off"
      spellcheck="false"
      placeholder="Search Westeros&hellip;"
      role="combobox"
      aria-expanded="false"
      aria-controls="search-results"
      aria-autocomplete="list"
    />
    <ul class="search__results" id="search-results" role="listbox" hidden></ul>
  </div>

  <div class="hint" id="hint" role="status" aria-live="polite"></div>

  <aside class="panel" id="panel" aria-labelledby="panel-title" hidden>
    <button class="panel__close" id="panel-close" aria-label="Close">
      <svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14">
        <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" stroke-width="1.4" fill="none"/>
      </svg>
    </button>
    <div id="panel-body"></div>
  </aside>

  <footer class="colophon">
    <p>
      Map data by <span>cadaei</span>, <span>theMountainGoat</span> and
      <span>Tear</span> ·
      <a href="https://creativecommons.org/licenses/by-nc-sa/3.0/" target="_blank" rel="noopener">CC BY-NC-SA 3.0</a>
      · World © George R. R. Martin
    </p>
  </footer>
`;

const map = new MapLibreMap({
  container: 'map',
  style: buildStyle(),
  // Provisional camera; `fitWesteros()` frames the continent on load, once
  // the container has its real size.
  center: [14, 20],
  zoom: 3,
  minZoom: 2,
  maxZoom: 8,
  // No `maxBounds`: MapLibre refuses any camera that would reveal area outside
  // it, which silently pins the zoom and makes `fitBounds` a no-op. Panning is
  // instead kept sane by `minZoom` plus the re-fit on resize.
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
  // The map is a flat drawing, not a globe.
  renderWorldCopies: false,
});

if (import.meta.env.DEV) {
  (window as unknown as { map: MapLibreMap }).map = map;
}

map.on('error', (e) => console.error('[atlas] map error', e.error?.message ?? e));

map.touchZoomRotate.disableRotation();
map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

const panel = document.querySelector<HTMLElement>('#panel')!;
const panelBody = document.querySelector<HTMLElement>('#panel-body')!;
const hint = document.querySelector<HTMLElement>('#hint')!;

const places: Place[] = [];
const targets: Target[] = [];
/**
 * Region name → the house that claims it.
 *
 * A settlement's allegiance is not in the places data, but it follows from the
 * region it sits in, which `loadPlaces` already resolves. This is the whole of
 * that inference: no per-place house is invented, and a place in an unclaimed
 * or unnamed region simply shows no holder.
 */
const regionHolder = new Map<string, string>();

/** Region name → its wiki page title, for regions named inside other panels. */
const regionWiki = new Map<string, string>();

/**
 * Two of the twelve claimants are not houses: the Night's Watch holds the New
 * Gift and Bran's Gift, and the Wildlings hold the lands beyond the Wall. The
 * panel used to prefix every value with "House ", which rendered "House
 * Night's Watch" and "House Wildlings" — wrong in the one register this
 * project cares most about being right in.
 */
const NOT_A_HOUSE = new Set(["Night's Watch", 'Wildlings']);
const holderName = (claimedBy: string) =>
  NOT_A_HOUSE.has(claimedBy) ? claimedBy : `House ${claimedBy}`;
let hoveredRegion: number | null = null;
let selectedRegion: number | null = null;
let selectedPlaceId: number | null = null;
let selectedIsland: number | null = null;

/**
 * `setFeatureState` throws outright if the style has not finished loading,
 * and unlike a click — which can only happen on a map you can already see —
 * search and deep links fire on whatever schedule the user or the URL
 * dictates. An unguarded call there aborts the whole navigation before the
 * camera moves, leaving the query looking like it did nothing.
 *
 * Feature state is presentation only, so dropping one is harmless: the panel
 * still opens and the camera still flies. Selection re-asserts on the next
 * interaction.
 */
const setFeatureState = (
  source: 'regions' | 'places' | 'islandLabels',
  id: number | null,
  state: Record<string, boolean>,
) => {
  if (id === null || !map.isStyleLoaded()) return;
  map.setFeatureState({ source, id }, state);
};

const setRegionState = (
  id: number | null,
  key: 'hover' | 'selected',
  value: boolean,
) => setFeatureState('regions', id, { [key]: value });

/** Selection highlight for a place, read by the dot and label paint. */
const setPlaceState = (id: number | null, selected: boolean) =>
  setFeatureState('places', id, { selected });

/** Selection highlight for an island, read by the island label paint. */
const setIslandState = (id: number | null, selected: boolean) =>
  setFeatureState('islandLabels', id, { selected });

/**
 * Exactly one thing is selected at a time, across all three kinds.
 *
 * Every panel used to clear the other kinds by hand, which is how a stale
 * highlight survives: miss one line and a previously-selected island stays
 * brass behind the settlement you just picked. Routing every selection change
 * through here means adding a fourth kind is one edit, not four.
 */
function select(
  kind: 'region' | 'place' | 'island' | null,
  id: number | null = null,
) {
  if (selectedRegion !== null && !(kind === 'region' && id === selectedRegion)) {
    setRegionState(selectedRegion, 'selected', false);
    selectedRegion = null;
  }
  if (selectedPlaceId !== null && !(kind === 'place' && id === selectedPlaceId)) {
    setPlaceState(selectedPlaceId, false);
    selectedPlaceId = null;
  }
  if (selectedIsland !== null && !(kind === 'island' && id === selectedIsland)) {
    setIslandState(selectedIsland, false);
    selectedIsland = null;
  }

  if (kind === 'region') {
    selectedRegion = id;
    setRegionState(id, 'selected', true);
  } else if (kind === 'place') {
    selectedPlaceId = id;
    setPlaceState(id, true);
  } else if (kind === 'island') {
    selectedIsland = id;
    setIslandState(id, true);
  }
}

/* --------------------------------------------------------------- search --- */

/**
 * URL-safe form of a name. Deliberately lossy and stable: "King's Landing"
 * and "The Dreadfort" become `kings-landing` and `the-dreadfort`, so a deep
 * link is readable and survives being retyped by hand.
 *
 * Apostrophes are *deleted* rather than treated as separators, which matters
 * more here than it would elsewhere — Westeros is full of them (King's
 * Landing, Crow's Nest, Widow's Watch, Griffin's Roost). Folding them into
 * the separator pass yields `king-s-landing`: correct, unique, and something
 * nobody would ever type or guess.
 */
const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Subsequence match: every character of the query appears in order, not
 * necessarily adjacently. This is what makes "wnfl" find Winterfell and "kl"
 * find King's Landing, and it is forgiving of a dropped letter mid-word.
 *
 * It is *not* an edit-distance match, so it does not tolerate a wrong letter:
 * "rivarrun" finds nothing. Typo correction needs Levenshtein and 205 names
 * do not justify it — prefix and substring cover the realistic cases.
 *
 * Returns a score, lower being better, or null for no match. The score is the
 * span the query occupies in the target: a tight run of characters near the
 * start beats the same characters scattered across a long name.
 */
function fuzzyScore(query: string, target: string): number | null {
  let qi = 0;
  let first = -1;
  let last = -1;
  let boundaries = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] !== query[qi]) continue;
    // A character matched at the start of a word is worth far more than one
    // matched mid-word: it is what makes "kl" mean King's Landing rather
    // than Karhold, whose k and l happen to sit close together.
    if (ti === 0 || /[^a-z0-9]/.test(target[ti - 1])) boundaries++;
    if (first === -1) first = ti;
    last = ti;
    qi++;
  }
  if (qi < query.length) return null;
  // Every matched character landing on a word boundary is the acronym case
  // ("kl", "wh" for White Harbor) and outranks any same-length span match.
  const acronym = boundaries === query.length ? -100 : 0;
  return acronym + (last - first) * 2 + first - boundaries * 8;
}

/**
 * Rank targets against a query.
 *
 * Exact and prefix matches are promoted ahead of the fuzzy pool outright,
 * because typing "the north" and getting a castle whose letters happen to
 * interleave would be absurd. Within a tier, shorter names win — "Hornwood"
 * should outrank "Hornwood Hills" for the query "hornwood".
 */
function search(query: string, limit = 8): Target[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: { target: Target; tier: number; score: number }[] = [];
  for (const target of targets) {
    const name = target.name.toLowerCase();
    let tier: number;
    let score: number;

    if (name === q) {
      tier = 0;
      score = 0;
    } else if (name.startsWith(q)) {
      tier = 1;
      score = name.length;
    } else if (name.includes(q)) {
      tier = 2;
      score = name.indexOf(q) * 2 + name.length;
    } else {
      const fuzzy = fuzzyScore(q, name);
      if (fuzzy === null) continue;
      tier = 3;
      score = fuzzy + name.length;
    }
    scored.push({ target, tier, score });
  }

  return scored
    .sort((a, b) => a.tier - b.tier || a.score - b.score)
    .slice(0, limit)
    .map((s) => s.target);
}

/* ------------------------------------------------------------- geography --- */

/**
 * Kilometres per degree on this map.
 *
 * Calibrated against canon rather than assumed: Winterfell → King's Landing is
 * 23.07° here and about 2,500 km in a straight line — the distance from
 * Istanbul to St Petersburg, which is the comparison the books invite.
 *
 * Taken from the 2,500 km figure directly rather than by converting the 1,550
 * mile one. The two describe the same distance, but 1,550 mi is itself a
 * rounded conversion of 2,500 km, so converting it back would bake that
 * rounding into every distance in the atlas for no reason.
 *
 * **This must be calibrated against a straight-line distance, not a road one.**
 * An earlier value divided the ~1,650-mile Kingsroad *road* distance by the
 * same 23.07° of straight-line map measurement, charging the road's bends to
 * the line and inflating every distance by ~5%. A road is always longer than
 * the line it follows, so the canon figures do not disagree — they measure
 * different things, and only the straight-line one belongs here.
 *
 * This is still an *estimate*: the projection is approximate by construction
 * (see ROADMAP) and canon distances are themselves loose. The UI rounds and
 * prefixes "~" accordingly, and says plainly that these are straight lines.
 */
const KM_PER_DEGREE = 108.35;

/**
 * Planar distance in degrees, with longitude scaled by cos(latitude).
 *
 * Westeros spans ~-12° to 50° on this map, where a degree of longitude is
 * between 0.98 and 0.64 of a degree of latitude. Ignoring that overstates
 * every east-west distance in the North by a third, which is exactly where
 * the Kingsroad calibration was taken.
 */
function degreesBetween(a: [number, number], b: [number, number]): number {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * Math.cos(midLat);
  const dy = a[1] - b[1];
  return Math.hypot(dx, dy);
}

/** Distance as the UI states it: rounded, estimated, never spuriously precise. */
function kmBetween(a: [number, number], b: [number, number]): number {
  const km = degreesBetween(a, b) * KM_PER_DEGREE;
  // Below 150 km round to 10, above it to 25 — the same relative coarseness
  // the mile figures had, not the same numbers. Quoting "558 km" from a
  // hand-drawn map would claim an accuracy the projection cannot support.
  return km < 150 ? Math.round(km / 10) * 10 : Math.round(km / 25) * 25;
}

/**
 * Shown by every panel that quotes a distance.
 *
 * Distances here are straight lines between two points, and a reader seeing a
 * distance next to a place name will otherwise read it as a journey. The gap is
 * not small or uniform: anything separated by mountains, water or a detour
 * around a bay understates the real travel considerably, and the Kingsroad
 * itself runs ~150 km longer than the line it follows. Saying so once, in
 * the panel that shows the number, is cheaper than being quietly wrong in a
 * way only a reader who knows the roads would catch.
 */
const DISTANCE_CAVEAT =
  'Distances are straight lines, not travel routes, and approximate.';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Compass point from `from` to `to`, as one of eight. */
function bearingBetween(
  from: [number, number],
  to: [number, number],
): (typeof COMPASS)[number] {
  const midLat = ((from[1] + to[1]) / 2) * (Math.PI / 180);
  const dx = (to[0] - from[0]) * Math.cos(midLat);
  const dy = to[1] - from[1];
  // atan2(dx, dy) measures clockwise from north, which is what a compass does.
  const deg = (Math.atan2(dx, dy) * (180 / Math.PI) + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/**
 * The settlements a viewer can use to place somewhere they've never heard of.
 *
 * This is the panel's answer to the actual question behind most lookups —
 * "where is this, relative to somewhere I know?" — so it is biased towards
 * *recognisable* neighbours rather than merely close ones. A minor holdfast
 * a few km away orients nobody; Winterfell eighty km north does.
 *
 * Rank is therefore traded against distance: a place must be within
 * `RADIUS` degrees, and among those the highest-ranked win, with distance
 * breaking ties. Speculative points are excluded — they are not drawn on the
 * map, so offering one as a landmark points at empty ground.
 */
const NEIGHBOUR_RADIUS = 6;

function nearbyPlaces(origin: Place, limit = 4) {
  return places
    .filter(
      (p) =>
        p.id !== origin.id &&
        p.props.confirmed &&
        degreesBetween(p.lngLat, origin.lngLat) <= NEIGHBOUR_RADIUS,
    )
    .map((p) => ({
      place: p,
      degrees: degreesBetween(p.lngLat, origin.lngLat),
    }))
    .sort(
      (a, b) =>
        // A ruling seat is the most orienting neighbour there is, so it wins
        // a rank tie against an ordinary town of the same rank.
        Number(b.place.props.seat ?? false) - Number(a.place.props.seat ?? false) ||
        b.place.props.rank - a.place.props.rank ||
        a.degrees - b.degrees,
    )
    .slice(0, limit)
    .sort((a, b) => a.degrees - b.degrees);
}

/** Plurals for the four settlement kinds. Only "City" is irregular. */
const plural = (type: string) =>
  (type === 'City' ? 'cities' : `${type.toLowerCase()}s`);

/**
 * Which regions share a border with this one.
 *
 * Computed by shared vertices rather than by true polygon adjacency: the
 * upstream regions are drawn as a coverage, so neighbours are digitised from
 * the same boundary line and their rings hold identical coordinate pairs. That
 * makes an exact-match test both correct and cheap, where a real adjacency
 * test would mean segment intersection over 12 multipolygons.
 *
 * The tradeoff is that a boundary traced twice at slightly different precision
 * would read as no border at all. `SHARED_VERTICES` guards the other
 * direction: a single coincidental point (two regions meeting the coast at one
 * spot) is not a border, so a handful of shared points are required before one
 * is claimed. Verified against the map — see the counts in ROADMAP.
 */
const SHARED_VERTICES = 3;

const regionVertices = new Map<string, Set<string>>();

/** Every coordinate of a geometry, as `x,y` strings for set comparison. */
function vertexKeys(geom: Geometry): Set<string> {
  const keys = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === 'number') {
      const [x, y] = node as [number, number];
      keys.add(`${x},${y}`);
      return;
    }
    for (const child of node as unknown[]) walk(child);
  };
  walk((geom as { coordinates: unknown }).coordinates);
  return keys;
}

function regionNeighbours(name: string): string[] {
  const own = regionVertices.get(name);
  if (!own) return [];
  const hits: string[] = [];
  for (const [other, keys] of regionVertices) {
    if (other === name) continue;
    let shared = 0;
    for (const key of keys) {
      if (own.has(key) && ++shared >= SHARED_VERTICES) break;
    }
    if (shared >= SHARED_VERTICES) hits.push(other);
  }
  return hits.sort();
}

/* ---------------------------------------------------------------- panel --- */

/** Escape for interpolation into markup. Tolerates null/undefined so that one
 *  malformed upstream feature can't abort a whole render pass. */
const escape = (s: string | null | undefined) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );

/**
 * Base URL for wiki articles, e.g. `https://…/wiki/`.
 *
 * Read from the data rather than hard-coded: `check-wiki-links.mjs` records
 * which wiki it verified against, and the two must not drift apart — titles
 * checked on one wiki pointed at another is exactly the dead link the
 * allowlist exists to prevent. Empty until the data loads, which is why
 * `wikiLink` degrades to plain text rather than emitting a bare `href`.
 */
let wikiBase = '';

/**
 * A name, linked to its wiki page when one is known to exist.
 *
 * Falls back to plain escaped text otherwise — about a fifth of places have no
 * page, either because they are nameless upstream ("Village", "Holdfast") or
 * because the wiki lacks them. Rendering a link that 404s would be the same
 * failure as presenting a speculative point as confirmed, so the absence is
 * carried honestly instead.
 *
 * `noopener` because `target=_blank` otherwise hands the opened page a
 * reference back to this one.
 */
function wikiLink(name: string, title: string | undefined): string {
  if (!title || !wikiBase) return escape(name);
  // Spaces are the only routine difference between a MediaWiki title and its
  // URL form; encodeURIComponent handles apostrophes and parentheses.
  const href = wikiBase + encodeURIComponent(title.replace(/ /g, '_'));
  return `<a class="wiki-link" href="${escape(href)}" target="_blank" rel="noopener">${escape(name)}</a>`;
}

function openPanel(html: string) {
  panelBody.innerHTML = html;
  panel.hidden = false;
  // Force reflow so the transition runs from the hidden state.
  void panel.offsetWidth;
  panel.classList.add('is-open');
}

function closePanel() {
  panel.classList.remove('is-open');
  writeUrl(null);
  select(null);
  const done = () => {
    if (!panel.classList.contains('is-open')) panel.hidden = true;
    panel.removeEventListener('transitionend', done);
  };
  panel.addEventListener('transitionend', done);
  // Reduced-motion collapses transitions to ~0ms, so guarantee the hide.
  setTimeout(done, 500);
}

function showRegion(feature: MapGeoJSONFeature) {
  const { name, claimedBy } = feature.properties as {
    name: string;
    claimedBy: string;
  };

  const within = places.filter((p) => p.region === name && p.props.confirmed);

  /*
   * The ruling seat leads, then everything else by rank.
   *
   * Rank alone put White Harbor above Winterfell in the North: a City
   * outranks a Castle, and that is the right order for a *map label*, where
   * the question is which name survives a collision. It is the wrong order
   * for a list headed "Principal seats", where the seat of the house that
   * holds the region is the answer and the rest is context.
   */
  const seats = within
    .filter((p) => p.props.rank >= 2)
    .sort(
      (a, b) =>
        Number(b.props.seat ?? false) - Number(a.props.seat ?? false) ||
        b.props.rank - a.props.rank,
    )
    .slice(0, 6);

  /*
   * "Settlements: 34" is a number without a shape. The same count broken into
   * kinds says something a reader can picture — the Reach is towns and castles,
   * the North is castles and not much else — and costs one more line.
   *
   * Only kinds actually present are listed, in descending significance, so a
   * region with no cities doesn't advertise "0 cities".
   *
   * `Other` must be in the list even though it says little: 25 of the 151
   * confirmed places carry it, so omitting it made the breakdown disagree with
   * the total directly above it — Dorne read "19 settlements / 1 town, 17
   * castles". A breakdown that doesn't add up undermines every other number in
   * the panel, which is a worse cost than one vague word.
   */
  const byType = ['City', 'Town', 'Castle', 'Ruin', 'Other']
    .map((t) => ({ type: t, n: within.filter((p) => p.props.type === t).length }))
    .filter((x) => x.n > 0)
    .map(({ type, n }) =>
      type === 'Other'
        ? `${n} other`
        : `${n} ${n === 1 ? type.toLowerCase() : plural(type)}`,
    )
    .join(', ');

  const borders = regionNeighbours(name)
    .map((n) => wikiLink(n, regionWiki.get(n)))
    .join(', ');

  select('region', feature.id as number);
  writeUrl(targets.find((t) => t.kind === 'region' && t.name === name) ?? null);

  openPanel(`
    <p class="panel__kicker">Region</p>
    <h2 class="panel__title" id="panel-title">${wikiLink(name, regionWiki.get(name))}</h2>
    <dl class="facts">
      <div><dt>Claimed by</dt><dd>${escape(holderName(claimedBy))}</dd></div>
      <div><dt>Settlements</dt><dd>${within.length}</dd></div>
      ${byType ? `<div><dt>Of which</dt><dd>${escape(byType)}</dd></div>` : ''}
      ${borders ? `<div><dt>Borders</dt><dd>${borders}</dd></div>` : ''}
    </dl>
    ${
      seats.length
        ? `<div class="listing">
             <h3>Principal seats</h3>
             <ul>${seats
               .map(
                 (p) =>
                   `<li><span>${wikiLink(p.props.name, p.props.wiki)}</span><em>${escape(p.props.type)}</em></li>`,
               )
               .join('')}</ul>
           </div>`
        : ''
    }
  `);
}

function showPlace(place: Place, featureId: number) {
  select('place', featureId);
  writeUrl(
    targets.find((t) => t.kind === 'place' && t.place.id === featureId) ?? null,
  );

  const { name, type, confirmed, added, note } = place.props;
  const holder = place.region ? regionHolder.get(place.region) : undefined;
  const nearby = nearbyPlaces(place);

  /*
   * Placement used to be a fact row. It was answering a question about the
   * *dataset* — is this point confirmed, speculative, or ours — in the slot a
   * reader was scanning for facts about the *place*. Someone pausing an
   * episode wants to know where Pyke is and who holds it, not our provenance
   * policy.
   *
   * The distinction still matters and is still shown, but as a caveat under
   * the facts, in the register of a footnote, and only when there is something
   * to caveat. A confirmed upstream point now says nothing at all, which is
   * correct: it is the unremarkable case.
   */
  const caveat = added
    ? (note ?? 'Placed by this atlas; approximate.')
    : !confirmed
      ? 'Not sited in the source maps. Position is inferred from the text and approximate.'
      : '';

  const toCapital = capitalDistance(place);
  // Only caveat distances the panel actually shows. King's Landing itself has
  // no capital row, and would have no Nearby list if it stood alone.
  const showsDistance = Boolean(toCapital) || nearby.length > 0;

  openPanel(`
    <p class="panel__kicker">${escape(type)}</p>
    <h2 class="panel__title" id="panel-title">${wikiLink(name, place.props.wiki)}</h2>
    <dl class="facts">
      ${
        place.region
          ? `<div><dt>Region</dt><dd>${wikiLink(
              place.region,
              regionWiki.get(place.region),
            )}</dd></div>`
          : ''
      }
      ${holder ? `<div><dt>Held by</dt><dd>${escape(holder)}</dd></div>` : ''}
      ${
        toCapital
          ? `<div><dt>From King's Landing</dt><dd>${escape(toCapital)}</dd></div>`
          : ''
      }
    </dl>
    ${
      nearby.length
        ? `<div class="listing">
             <h3>Nearby</h3>
             <ul>${nearby
               .map(
                 ({ place: p }) =>
                   `<li><span>${wikiLink(p.props.name, p.props.wiki)}</span><em>${kmBetween(
                     p.lngLat,
                     place.lngLat,
                   ).toLocaleString()} km ${bearingBetween(place.lngLat, p.lngLat)}</em></li>`,
               )
               .join('')}</ul>
           </div>`
        : ''
    }
    ${showsDistance ? `<p class="panel__note">${escape(DISTANCE_CAVEAT)}</p>` : ''}
    ${caveat ? `<p class="panel__note">${escape(caveat)}</p>` : ''}
  `);
}

/**
 * Distance to King's Landing, the one place every viewer already knows.
 *
 * A single well-chosen reference point does more orienting work than a table
 * of coordinates, and it is the anchor the show itself uses. Returns empty for
 * King's Landing so the panel doesn't tell you it is nought km from itself.
 */
function capitalDistance(place: Place): string {
  const capital = places.find((p) => p.props.name === "King's Landing");
  if (!capital || capital.id === place.id) return '';
  return `~${kmBetween(place.lngLat, capital.lngLat).toLocaleString()} km ${bearingBetween(capital.lngLat, place.lngLat)}`;
}

/* ----------------------------------------------------------- navigation --- */

/**
 * The zoom a searched settlement lands at.
 *
 * Deep links carry the target only, never the camera (see ROADMAP), so this
 * constant decides what every shared link looks like. 5.6 is chosen because
 * it clears the reveal ladder in `map-style.ts` — at 5.4 the `Other` places
 * are still fading in, so a link to a minor holdfast could arrive before its
 * own dot did. Above 5.8 everything is drawn and the neighbours are context.
 */
const PLACE_ZOOM = 5.6;

/** Bounding box of any geometry, as MapLibre's [[w,s],[e,n]]. */
function geometryBounds(geom: Geometry): [[number, number], [number, number]] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const walk = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === 'number') {
      const [x, y] = node as [number, number];
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
      return;
    }
    for (const child of node as unknown[]) walk(child);
  };
  walk((geom as { coordinates: unknown }).coordinates);
  return [
    [w, s],
    [e, n],
  ];
}

/**
 * Fly to a target and open its panel. The single path shared by search, deep
 * links and (for regions) nothing else — clicks resolve their own feature
 * from the rendered map, which search cannot do because the target may be
 * off-screen or below its label's zoom threshold.
 */
function goTo(target: Target, animate = true) {
  // Feature state needs a loaded style (see setFeatureState). A deep link
  // resolves before the first render, so defer rather than lose the highlight.
  if (!map.isStyleLoaded()) {
    map.once('idle', () => goTo(target, animate));
    return;
  }

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fly = (opts: { center: [number, number]; zoom: number }) =>
    animate && !motion ? map.flyTo(opts) : map.jumpTo(opts);

  if (target.kind === 'region') {
    // A region is an area, so frame the whole thing rather than its centre.
    map.fitBounds(geometryBounds(target.feature.geometry), {
      padding: { top: 96, bottom: 72, left: 48, right: 380 },
      animate: animate && !motion,
    });
    const feature = map
      .querySourceFeatures('regions')
      .find((f) => f.id === target.id);
    // The panel needs a feature for its properties; the source copy will do.
    showRegion(
      (feature ?? {
        id: target.id,
        properties: target.feature.properties,
      }) as MapGeoJSONFeature,
    );
    return;
  }

  if (target.kind === 'island') {
    fly({ center: target.lngLat, zoom: PLACE_ZOOM });
    showIsland(target);
    return;
  }

  fly({ center: target.place.lngLat, zoom: PLACE_ZOOM });
  showPlace(target.place, target.place.id);
}

/**
 * Islands carry only a name upstream — no house, no type, no area worth
 * quoting. So the panel says what is actually known: the name, and any
 * settlements that sit on it. Padding it out with invented facts would be the
 * same mistake as presenting a speculative point as confirmed.
 *
 * Settlements are matched by distance to the label anchor rather than by
 * point-in-polygon: island geometries are in a separate source from the one
 * `loadPlaces` tests against, and `halfWidth`/`halfHeight` from the label
 * data give a good enough box for what is a supporting list, not a claim.
 */
function showIsland(target: Extract<Target, { kind: 'island' }>) {
  select('island', target.id);
  writeUrl(target);

  const [ix, iy] = target.lngLat;
  const { halfWidth, halfHeight } = target;
  const on = places
    .filter(
      (p) =>
        p.props.confirmed &&
        Math.abs(p.lngLat[0] - ix) <= halfWidth &&
        Math.abs(p.lngLat[1] - iy) <= halfHeight,
    )
    .sort((a, b) => b.props.rank - a.props.rank)
    .slice(0, 6);

  // The nearest settlement of any consequence, which for an uninhabited island
  // is the only orienting fact available. Islands with their own settlements
  // get the listing below instead and don't need it.
  const anchor = on.length
    ? undefined
    : places
        .filter((p) => p.props.confirmed && p.props.rank >= 2)
        .map((p) => ({ p, d: degreesBetween(p.lngLat, target.lngLat) }))
        .sort((a, b) => a.d - b.d)[0];

  openPanel(`
    <p class="panel__kicker">Island</p>
    <h2 class="panel__title" id="panel-title">${wikiLink(target.name, target.wiki)}</h2>
    <dl class="facts">
      ${
        on.length
          ? `<div><dt>Settlements</dt><dd>${on.length}</dd></div>`
          : ''
      }
      ${
        anchor
          ? `<div><dt>Nearest seat</dt><dd>${wikiLink(anchor.p.props.name, anchor.p.props.wiki)}, ~${kmBetween(
              anchor.p.lngLat,
              target.lngLat,
            ).toLocaleString()} km ${bearingBetween(target.lngLat, anchor.p.lngLat)}</dd></div>`
          : ''
      }
    </dl>
    ${
      on.length
        ? `<div class="listing">
             <h3>Settlements</h3>
             <ul>${on
               .map(
                 (p) =>
                   `<li><span>${wikiLink(p.props.name, p.props.wiki)}</span><em>${escape(p.props.type)}</em></li>`,
               )
               .join('')}</ul>
           </div>`
        : ''
    }
    ${anchor ? `<p class="panel__note">${escape(DISTANCE_CAVEAT)}</p>` : ''}
  `);
}

/* --------------------------------------------------------------- places --- */

type Ring = Position[];

/** Ray-casting test against a single linear ring. */
function pointInRing(pt: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Point-in-polygon for Polygon and MultiPolygon, respecting holes.
 * Both are normalised to a list of polygons, where each polygon is
 * `[outerRing, ...holes]` — the nesting depth differs between the two types
 * and conflating them silently reports every point as outside.
 */
function pointInGeometry(pt: [number, number], geom: Geometry): boolean {
  const polygons: Ring[][] =
    geom.type === 'Polygon'
      ? [geom.coordinates]
      : geom.type === 'MultiPolygon'
        ? geom.coordinates
        : [];

  for (const [outer, ...holes] of polygons) {
    if (!outer || !pointInRing(pt, outer)) continue;
    if (!holes.some((hole) => pointInRing(pt, hole))) return true;
  }
  return false;
}

/**
 * Build the place index used by the panels.
 *
 * Rendering is entirely the style's job now — the `place-dot` and
 * `place-label` layers draw from the same GeoJSON source. This exists only to
 * resolve which region each place falls in, which the panel needs and the GPU
 * has no way to compute.
 */
async function loadPlaces() {
  const [placesRes, regionsRes] = await Promise.all([
    fetch('/data/places.geojson'),
    fetch('/data/regions.geojson'),
  ]);
  const placeData: FeatureCollection = await placesRes.json();
  const regionData: FeatureCollection = await regionsRes.json();

  // Recorded per collection by check-wiki-links.mjs. All three files carry the
  // same value; the first one present wins.
  wikiBase = (placeData as { wikiBase?: string }).wikiBase ?? '';

  /*
   * All 205 places are indexed, including the 54 speculative ones.
   *
   * The *map* still draws only the confirmed 151 (`CONFIRMED_ONLY` in the
   * style) — but search covers everything, because "Summerhall" returning no
   * results reads as a broken search rather than as editorial restraint. The
   * distinction is carried in the UI instead: speculative hits are marked in
   * the result list, and the panel footnotes the point as inferred.
   *
   * Panels that count settlements must therefore filter by `confirmed`
   * themselves; the index is no longer pre-filtered for them.
   */
  for (const feature of placeData.features) {
    const props = feature.properties as PlaceProps;
    const lngLat = (feature.geometry as Point).coordinates as [number, number];
    const region = regionData.features.find((r: Feature) =>
      pointInGeometry(lngLat, r.geometry),
    )?.properties?.name as string | undefined;

    places.push({ id: feature.id as number, props, lngLat, region });
  }

  for (const feature of regionData.features) {
    const name = feature.properties?.name as string | undefined;
    // One political feature is unnamed upstream (the wildling lands).
    if (!name) continue;
    const claimedBy = feature.properties?.claimedBy as string | undefined;
    if (claimedBy) regionHolder.set(name, holderName(claimedBy));
    const wiki = feature.properties?.wiki as string | undefined;
    if (wiki) regionWiki.set(name, wiki);
    regionVertices.set(name, vertexKeys(feature.geometry));
    targets.push({
      kind: 'region',
      name,
      slug: slugify(name),
      id: feature.id as number,
      feature,
      wiki: feature.properties?.wiki as string | undefined,
    });
  }

  /*
   * Two upstream places are both called "Holdfast", so a name alone does not
   * make a unique slug. The first keeps the bare slug and any later clash is
   * suffixed with the feature id (`holdfast-155`) — stable across runs
   * because the ids come from the prepared file's own ordering, and readable
   * enough that a hand-typed `?place=holdfast` still resolves to something
   * sensible rather than 404ing.
   */
  const usedSlugs = new Set(targets.map((t) => t.slug));
  for (const place of places) {
    let slug = slugify(place.props.name);
    if (usedSlugs.has(slug)) slug = `${slug}-${place.id}`;
    usedSlugs.add(slug);
    targets.push({ kind: 'place', name: place.props.name, slug, place });
  }

  const islandData: FeatureCollection = await (
    await fetch('/data/island-labels.geojson')
  ).json();
  for (const feature of islandData.features) {
    const name = feature.properties?.name as string | undefined;
    if (!name) continue;
    let slug = slugify(name);
    if (usedSlugs.has(slug)) slug = `${slug}-${feature.id ?? targets.length}`;
    usedSlugs.add(slug);
    targets.push({
      kind: 'island',
      name,
      slug,
      id: feature.id as number,
      lngLat: (feature.geometry as Point).coordinates as [number, number],
      halfWidth: (feature.properties?.halfWidth as number) ?? 0,
      halfHeight: (feature.properties?.halfHeight as number) ?? 0,
      wiki: feature.properties?.wiki as string | undefined,
    });
  }
}

/* ------------------------------------------------------------ deep links --- */

/**
 * The URL carries *what* you are looking at, never *where the camera is*.
 *
 * `?place=winterfell` means "show me Winterfell", so the link means the same
 * thing to everyone who opens it. Encoding the camera instead would make the
 * URL churn on every pan, write a history entry per gesture, and freeze one
 * person's window size into a link opened on someone else's screen.
 *
 * `replaceState`, not `pushState`: selecting places is browsing the map, not
 * navigating a site. Twelve selections should not mean twelve presses of the
 * back button to leave.
 */
function writeUrl(target: Target | null) {
  const url = new URL(window.location.href);
  url.search = '';
  if (target) url.searchParams.set(target.kind, target.slug);
  history.replaceState(null, '', url);
}

/** Resolve `?place=` / `?region=` / `?island=` against the target index. */
function readUrl(): Target | null {
  const params = new URLSearchParams(window.location.search);
  for (const kind of ['place', 'region', 'island'] as const) {
    const slug = params.get(kind);
    if (!slug) continue;
    const hit = targets.find((t) => t.kind === kind && t.slug === slug);
    if (hit) return hit;
    // A slug that resolves to nothing is a stale or mistyped link. Say so
    // rather than silently opening the default view as if nothing was asked.
    hint.textContent = `No ${kind} called "${slug}"`;
    hint.classList.add('is-visible');
    setTimeout(() => hint.classList.remove('is-visible'), 4200);
  }
  return null;
}

/* ------------------------------------------------------------ behaviour --- */

/** Frame Westeros once the container has settled at its real size. */
function fitWesteros(animate = false) {
  map.resize();
  map.fitBounds(WESTEROS_BOUNDS, {
    padding: { top: 96, bottom: 72, left: 48, right: 48 },
    animate,
  });
}

/**
 * No re-apply guard here, deliberately.
 *
 * There was a `setTimeout(50)` that called `setStyle` whenever
 * `isStyleLoaded()` was false. That check is false during *normal* loading, so
 * the timer always fired and always re-applied the style mid-load — MapLibre
 * logged "Unable to perform style diff: Style is not done loading. Rebuilding
 * the style from scratch" and restarted the load, which is the blank map the
 * guard was meant to fix. It was the cause, not the cure.
 *
 * If a genuine first-application race ever reappears, wait on the `style.load`
 * event rather than a wall-clock timer, and re-apply only after confirming the
 * style is idle.
 *
 * The "map loads blank with no error" reports that motivated the guard were
 * reproduced and traced to a *hidden tab*: Chrome throttles requestAnimationFrame
 * to zero frames in a backgrounded tab, and MapLibre completes style load on the
 * render loop, so `style.load` never fires. Pump frames (or foreground the tab)
 * and the same style loads all 12 layers. Nothing to fix in the app — but it
 * means automated checks must run against a foreground tab or a headless browser,
 * or they will "reproduce" a bug that isn't there.
 */

/**
 * Icons must exist before the symbol layer that references them can draw, and
 * `setStyle` discards registered images — so register on every style load
 * rather than once at startup. MapLibre also fires `styleimagemissing` when a
 * layer asks for an image it doesn't have, which covers any remaining gap.
 */
map.on('styledata', () => void registerIcons(map));
map.on('styleimagemissing', () => void registerIcons(map));

map.once('styledata', () => fitWesteros());
map.on('load', () => fitWesteros());

/*
 * Builds the region index the panels read and the target index search uses;
 * rendering is the style's job.
 *
 * A deep link is resolved only once both the index and the map are ready —
 * the index because a slug means nothing without it, the map because
 * `fitBounds`/`flyTo` need a real container size. `fitWesteros` has already
 * run by then, so an incoming link overrides the default framing rather than
 * racing it.
 */
loadPlaces().then(() => {
  const target = readUrl();
  if (!target) {
    hint.textContent = 'Select a region or settlement';
    hint.classList.add('is-visible');
    setTimeout(() => hint.classList.remove('is-visible'), 4200);
    return;
  }
  // goTo defers itself until the style is loaded, so this is safe to call
  // immediately regardless of how far along the map is.
  goTo(target, false);
});

// Keep the framing sensible when the window changes shape.
let resizeTimer: number;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => map.resize(), 120);
});

/** Both place layers are clickable; the dot is the more forgiving target. */
const PLACE_LAYERS = ['place-dot', 'place-label'];

for (const layer of PLACE_LAYERS) {
  map.on('mouseenter', layer, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', layer, () => {
    map.getCanvas().style.cursor = '';
  });
}

map.on('mousemove', 'region-fill', (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
  if (!e.features?.length) return;
  const id = e.features[0].id as number;
  if (hoveredRegion === id) return;
  setRegionState(hoveredRegion, 'hover', false);
  hoveredRegion = id;
  setRegionState(hoveredRegion, 'hover', true);
  map.getCanvas().style.cursor = 'pointer';
});

map.on('mouseleave', 'region-fill', () => {
  setRegionState(hoveredRegion, 'hover', false);
  hoveredRegion = null;
  map.getCanvas().style.cursor = '';
});

/**
 * One click handler, resolved in priority order: a settlement wins over the
 * region beneath it, and bare sea dismisses. Doing this in a single handler
 * avoids the layer-specific handlers racing each other on overlapping hits.
 */
map.on('click', (e: MapMouseEvent) => {
  const placeHit = map.queryRenderedFeatures(e.point, {
    layers: PLACE_LAYERS,
  })[0];

  if (placeHit) {
    const name = placeHit.properties?.name as string;
    const place = places.find((p) => p.props.name === name);
    if (place) showPlace(place, placeHit.id as number);
    return;
  }

  const regionHit = map.queryRenderedFeatures(e.point, {
    layers: ['region-fill'],
  })[0];

  if (regionHit) showRegion(regionHit);
  else closePanel();
});

document.querySelector('#panel-close')!.addEventListener('click', closePanel);

/* --------------------------------------------------------- search UI --- */

const searchInput = document.querySelector<HTMLInputElement>('#search-input')!;
const searchResults = document.querySelector<HTMLElement>('#search-results')!;

let results: Target[] = [];
let active = -1;

/** Kind shown beside each result, so "Hornwood" the wood and the castle differ. */
const KIND_LABEL: Record<Target['kind'], string> = {
  place: 'Settlement',
  region: 'Region',
  island: 'Island',
};

function renderResults() {
  if (!results.length) {
    searchResults.hidden = true;
    searchResults.innerHTML = '';
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
    return;
  }

  searchResults.innerHTML = results
    .map((t, i) => {
      // Speculative places are findable but flagged: the map doesn't draw
      // them, and the result list shouldn't imply that it does.
      const speculative =
        t.kind === 'place' && !t.place.props.confirmed
          ? '<em class="search__flag">Unconfirmed</em>'
          : '';
      const kind = t.kind === 'place' ? t.place.props.type : KIND_LABEL[t.kind];
      return `<li
          class="search__result${i === active ? ' is-active' : ''}"
          id="search-result-${i}"
          role="option"
          aria-selected="${i === active}"
        ><span>${escape(t.name)}</span><em>${escape(kind)}</em>${speculative}</li>`;
    })
    .join('');

  searchResults.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
  if (active >= 0) {
    searchInput.setAttribute('aria-activedescendant', `search-result-${active}`);
  } else {
    searchInput.removeAttribute('aria-activedescendant');
  }
}

function closeResults() {
  results = [];
  active = -1;
  renderResults();
}

function commit(index: number) {
  const target = results[index];
  if (!target) return;
  searchInput.value = target.name;
  searchInput.blur();
  closeResults();
  goTo(target);
}

searchInput.addEventListener('input', () => {
  results = search(searchInput.value);
  active = results.length ? 0 : -1;
  renderResults();
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!results.length) return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    active = (active + step + results.length) % results.length;
    renderResults();
    return;
  }
  if (e.key === 'Enter' && active >= 0) {
    e.preventDefault();
    commit(active);
    return;
  }
  if (e.key === 'Escape') {
    // First Escape dismisses the list; a second clears the field. Escape
    // should never be a dead key while the field has focus.
    if (results.length) closeResults();
    else searchInput.value = '';
    e.stopPropagation();
  }
});

searchResults.addEventListener('mousedown', (e) => {
  // mousedown, not click: blur would tear the list down before click fires.
  const li = (e.target as HTMLElement).closest('.search__result');
  if (!li) return;
  e.preventDefault();
  commit([...searchResults.children].indexOf(li));
});

searchInput.addEventListener('blur', () => {
  // Deferred so a mousedown on a result is not cancelled by the blur.
  setTimeout(closeResults, 120);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panel.hidden) closePanel();
  // "/" is the conventional focus-search key and costs no visible chrome.
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});
