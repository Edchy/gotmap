import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Settlement icons, drawn as inline SVG and registered as SDF images.
 *
 * SDF (signed distance field) images are recolourable at runtime: MapLibre
 * treats the alpha channel as a distance field and paints it with the layer's
 * `icon-color`, so one white glyph serves ink, muted and brass states alike.
 * That is why these are monochrome silhouettes rather than detailed artwork.
 *
 * Kept deliberately geometric and small — at 12-16px the eye reads silhouette,
 * not detail, and anything fussier turns to mush against the terrain.
 */

const SIZE = 24;

/**
 * ── Swapping these icons ─────────────────────────────────────────────────
 *
 * Each icon is one SVG path `d` on a 24×24 grid plus a `fill` flag. Shapes
 * are centred on (12, 12) so every mark sits on its coordinate.
 *
 * Two constraints:
 *
 * 1. MONOCHROME. These render as signed distance fields, which store only a
 *    silhouette. Fills, gradients and stroke colours in the source are all
 *    discarded; `icon-color` in the style paints them instead. That is what
 *    lets one mark turn brass when selected.
 * 2. 24×24 viewBox. Rescale if yours differ, or change SIZE — but keep every
 *    icon on the same grid or they won't sit at consistent visual weights.
 *
 * Preview at /icons.html, which reads these same definitions.
 */
type Icon = {
  /** Path data, centred on the 24×24 grid. */
  d: string;
  /** Filled marks read as the higher rank of a pair; hollow as the lower. */
  fill: boolean;
};

/**
 * Two shapes, two weights.
 *
 * Circles are settlements, triangles are fortifications; filled outranks
 * hollow within each pair. That is the whole vocabulary — five types encoded
 * without a single pictogram, which suits the register better than the little
 * buildings that were here before. Detail is the enemy at 14px.
 */
const ICONS: Record<string, Icon> = {
  /** City — filled circle, the largest mark on the map. */
  city: { d: 'M12 5.4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2Z', fill: true },

  /** Town — hollow circle, a shade smaller. */
  town: { d: 'M12 6.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6Z', fill: false },

  /** Castle — filled triangle. Fortification rather than settlement. */
  castle: { d: 'M12 5.8 18.9 17.9H5.1Z', fill: true },

  /** Ruin — hollow triangle: a castle that fell, said without extra shapes. */
  ruin: { d: 'M12 6.4 18.2 17.5H5.8Z', fill: false },

  /**
   * Other — a small hollow square for the places the dataset leaves
   * unclassified: inns, ferries, towers, holdfasts. It needs its own shape
   * rather than a smaller dot: both would be filled circles, separable only
   * by diameter, and the two classes are visible together above zoom 5.6.
   */
  other: { d: 'M8.6 8.6h6.8v6.8H8.6Z', fill: false },
};

/** Read by /icons.html so the preview shows the real definitions. */
export const __ICONS = ICONS;

/**
 * Stroke weight for the icons, in viewBox units. Lucide draws at 2; these sit
 * slightly heavier so the silhouette survives being reduced to ~14px and then
 * rasterised into a distance field.
 */
const STROKE = 2.25;

const svg = (name: string) => {
  const { d, fill } = ICONS[name];
  // Hollow marks are stroked; filled ones get a hairline stroke too, so a
  // filled and a hollow shape of the same nominal size read the same width.
  const paint = fill
    ? `fill="#fff" stroke="#fff" stroke-width="${STROKE}"`
    : `fill="none" stroke="#fff" stroke-width="${STROKE}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" ` +
    `viewBox="0 0 24 24" stroke-linejoin="round">` +
    `<path d="${d.trim().replace(/\s+/g, ' ')}" ${paint}/></svg>`
  );
};

/** Rasterise an SVG string to ImageData at the given pixel ratio. */
async function rasterise(markup: string, ratio: number): Promise<ImageData> {
  const px = SIZE * ratio;
  const blob = new Blob([markup], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  try {
    const bitmap = await createImageBitmap(blob).catch(async () => {
      // Safari historically refused SVG blobs in createImageBitmap; fall back
      // to an <img> decode, which every engine handles.
      const img = new Image();
      img.src = url;
      await img.decode();
      return img as unknown as ImageBitmap;
    });

    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, px, px);
    const data = ctx.getImageData(0, 0, px, px);

    // An unparseable path rasterises to nothing, and MapLibre would accept the
    // blank image without complaint. Fail loudly instead — this is the most
    // likely mistake when swapping in a new icon.
    let ink = false;
    for (let i = 3; i < data.data.length; i += 4) {
      if (data.data[i] > 0) {
        ink = true;
        break;
      }
    }
    if (!ink) throw new Error('icon rendered empty — is the SVG path valid?');

    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Register every settlement icon with the map. Must run before the symbol
 * layer references them; a missing image logs a warning and drops the icon.
 */
export async function registerIcons(map: MapLibreMap) {
  const ratio = Math.min(2, Math.ceil(window.devicePixelRatio || 1));

  await Promise.all(
    Object.keys(ICONS).map(async (name) => {
      const id = `place-${name}`;
      if (map.hasImage(id)) return;

      let data: ImageData;
      try {
        data = await rasterise(svg(name), ratio);
      } catch (err) {
        console.error(`[atlas] icon "${name}": ${(err as Error).message}`);
        return;
      }

      /**
       * Re-check after the await. This function runs on every `styledata`, so
       * several calls can be in flight at once; without this second check they
       * all pass the one above before any of them registers, and the losers
       * throw "An image named … already exists".
       */
      if (map.hasImage(id)) return;

      // `sdf: true` is what makes these recolourable by `icon-color`.
      map.addImage(id, { width: data.width, height: data.height, data: new Uint8Array(data.data.buffer) }, { sdf: true, pixelRatio: ratio });
    }),
  );
}
