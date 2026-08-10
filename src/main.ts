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
  | { kind: 'region'; name: string; slug: string; id: number; feature: Feature }
  | {
      kind: 'island';
      name: string;
      slug: string;
      /** Feature id in the islandLabels source, to drive the label highlight. */
      id: number;
      lngLat: [number, number];
      halfWidth: number;
      halfHeight: number;
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

/* ---------------------------------------------------------------- panel --- */

/** Escape for interpolation into markup. Tolerates null/undefined so that one
 *  malformed upstream feature can't abort a whole render pass. */
const escape = (s: string | null | undefined) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );

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

  const seats = places
    .filter((p) => p.region === name && p.props.confirmed && p.props.rank >= 2)
    .sort((a, b) => b.props.rank - a.props.rank)
    .slice(0, 6);

  select('region', feature.id as number);
  writeUrl(targets.find((t) => t.kind === 'region' && t.name === name) ?? null);

  openPanel(`
    <p class="panel__kicker">Region</p>
    <h2 class="panel__title" id="panel-title">${escape(name)}</h2>
    <dl class="facts">
      <div><dt>Claimed by</dt><dd>House ${escape(claimedBy)}</dd></div>
      <div><dt>Settlements</dt><dd>${places.filter((p) => p.region === name && p.props.confirmed).length}</dd></div>
    </dl>
    ${
      seats.length
        ? `<div class="listing">
             <h3>Principal seats</h3>
             <ul>${seats
               .map(
                 (p) =>
                   `<li><span>${escape(p.props.name)}</span><em>${escape(p.props.type)}</em></li>`,
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
  // Three states, not two: upstream-confirmed, upstream-speculative, and ours.
  // Presenting our own placement as "confirmed" would overstate the map.
  const placement = added
    ? 'Approximate'
    : confirmed
      ? 'Confirmed'
      : 'Speculative';

  openPanel(`
    <p class="panel__kicker">${escape(type)}</p>
    <h2 class="panel__title" id="panel-title">${escape(name)}</h2>
    <dl class="facts">
      ${place.region ? `<div><dt>Region</dt><dd>${escape(place.region)}</dd></div>` : ''}
      <div><dt>Placement</dt><dd>${placement}</dd></div>
    </dl>
    ${
      added && note ? `<p class="panel__note">${escape(note)}</p>` : ''
    }
  `);
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

  openPanel(`
    <p class="panel__kicker">Island</p>
    <h2 class="panel__title" id="panel-title">${escape(target.name)}</h2>
    ${
      on.length
        ? `<div class="listing">
             <h3>Settlements</h3>
             <ul>${on
               .map(
                 (p) =>
                   `<li><span>${escape(p.props.name)}</span><em>${escape(p.props.type)}</em></li>`,
               )
               .join('')}</ul>
           </div>`
        : ''
    }
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

  /*
   * All 205 places are indexed, including the 54 speculative ones.
   *
   * The *map* still draws only the confirmed 151 (`CONFIRMED_ONLY` in the
   * style) — but search covers everything, because "Summerhall" returning no
   * results reads as a broken search rather than as editorial restraint. The
   * distinction is carried in the UI instead: speculative hits are marked in
   * the result list and the panel says "Placement: Speculative".
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
    targets.push({
      kind: 'region',
      name,
      slug: slugify(name),
      id: feature.id as number,
      feature,
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
