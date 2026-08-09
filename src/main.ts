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
  props: PlaceProps;
  lngLat: [number, number];
  region?: string;
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
let hoveredRegion: number | null = null;
let selectedRegion: number | null = null;
let selectedPlaceId: number | null = null;

const setRegionState = (
  id: number | null,
  key: 'hover' | 'selected',
  value: boolean,
) => {
  if (id === null) return;
  map.setFeatureState({ source: 'regions', id }, { [key]: value });
};

/** Selection highlight for a place, read by the dot and label paint. */
const setPlaceState = (id: number | null, selected: boolean) => {
  if (id === null) return;
  map.setFeatureState({ source: 'places', id }, { selected });
};

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
  setRegionState(selectedRegion, 'selected', false);
  selectedRegion = null;
  setPlaceState(selectedPlaceId, false);
  selectedPlaceId = null;
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

  setRegionState(selectedRegion, 'selected', false);
  selectedRegion = feature.id as number;
  setRegionState(selectedRegion, 'selected', true);

  openPanel(`
    <p class="panel__kicker">Region</p>
    <h2 class="panel__title" id="panel-title">${escape(name)}</h2>
    <dl class="facts">
      <div><dt>Claimed by</dt><dd>House ${escape(claimedBy)}</dd></div>
      <div><dt>Settlements</dt><dd>${places.filter((p) => p.region === name).length}</dd></div>
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
  setPlaceState(selectedPlaceId, false);
  setRegionState(selectedRegion, 'selected', false);
  selectedRegion = null;

  selectedPlaceId = featureId;
  setPlaceState(featureId, true);

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

  for (const feature of placeData.features) {
    const props = feature.properties as PlaceProps;
    // Speculative placements are hidden: a map claiming precision
    // shouldn't present guesses at the same weight as canon.
    if (!props.confirmed) continue;

    const lngLat = (feature.geometry as Point).coordinates as [number, number];
    const region = regionData.features.find((r: Feature) =>
      pointInGeometry(lngLat, r.geometry),
    )?.properties?.name as string | undefined;

    places.push({ props, lngLat, region });
  }
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

// Builds the region index the panels read; rendering is the style's job.
loadPlaces();
hint.textContent = 'Select a region or settlement';
hint.classList.add('is-visible');
setTimeout(() => hint.classList.remove('is-visible'), 4200);

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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panel.hidden) closePanel();
});
