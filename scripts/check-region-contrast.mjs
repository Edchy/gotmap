/**
 * Verifies the region fills satisfy The Value-First Rule (DESIGN.md).
 *
 * Every distinction on this map must survive being converted to greyscale —
 * both as a legibility rule for dark cartography and as the foundation for
 * colourblind-safe encoding. Region fills are the hard case: they carry a data
 * role, they are large, and hue alone is not enough.
 *
 * This composites each tint over `land` at the layer's real opacity, converts
 * to WCAG relative luminance, and checks every *adjacent* pair. Only adjacent
 * pairs matter — two regions at opposite ends of the continent may share a
 * value without anyone noticing — and adjacency is taken from shared vertices,
 * the same test `main.ts` uses to compute "Borders".
 *
 * Also checks the label ink that sits on those fills still clears AA, because
 * the two constraints pull against each other: darkening a fill separates it
 * from its neighbour and *helps* the label, but lightening it does the reverse.
 *
 * Run: node scripts/check-region-contrast.mjs
 * Exits non-zero on failure, so it can gate a build if that is ever wanted.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Opacity of the `region-fill` layer in map-style.ts. Keep in sync. */
const FILL_OPACITY = 0.42;

/**
 * Minimum greyscale separation between two adjacent fills.
 *
 * Below ~0.005 relative luminance two dark greys are indistinguishable on a
 * dark ground. 0.005 is the floor, not the target; the current ladder holds
 * 0.0068 at its worst.
 */
const MIN_ADJACENT = 0.005;

/** AA for body text. `ink-muted` is the colour of most place labels. */
const MIN_LABEL_CONTRAST = 4.5;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const encodeGamma = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/** OKLCH -> gamma-encoded sRGB, matching src/color.ts. */
function oklchToRgb(input) {
  const m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/i.exec(input.trim());
  if (!m) throw new Error(`cannot parse: ${input}`);
  const L = parseFloat(m[1]) / 100;
  const C = parseFloat(m[2]);
  const h = (parseFloat(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const mm = m_ ** 3;
  const s = s_ ** 3;
  return [
    clamp01(encodeGamma(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s)),
    clamp01(encodeGamma(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s)),
    clamp01(encodeGamma(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s)),
  ];
}

const luminance = ([r, g, b]) => {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const over = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

const contrast = (a, b) => {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

/** Which token paints which region. Mirrors `regionTint()` in map-style.ts. */
const HOUSE_TOKEN = {
  Stark: 'region-north',
  Arryn: 'region-vale',
  Tully: 'region-riverlands',
  Greyjoy: 'region-iron',
  Lannister: 'region-west',
  Targaryen: 'region-crown',
  Tyrell: 'region-reach',
  Baratheon: 'region-storm',
  Martell: 'region-dorne',
  Wildlings: 'region-wild',
};

const LABEL_TOKEN = {
  Stark: 'label-north',
  Arryn: 'label-vale',
  Tully: 'label-riverlands',
  Greyjoy: 'label-iron',
  Lannister: 'label-west',
  Targaryen: 'label-crown',
  Tyrell: 'label-reach',
  Baratheon: 'label-storm',
  Martell: 'label-dorne',
  "Night's Watch": 'label-watch',
  Wildlings: 'label-wild',
};

/** The two Gifts share a house but not a border, so they key by name. */
const NAME_TOKEN = {
  'New Gift': 'region-gift-new',
  "Bran's Gift": 'region-gift-bran',
};

function vertexKeys(geom) {
  const keys = new Set();
  const walk = (node) => {
    if (Array.isArray(node) && typeof node[0] === 'number') {
      keys.add(`${node[0]},${node[1]}`);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(geom.coordinates);
  return keys;
}

async function main() {
  // Parsed from source so this cannot drift from the palette it checks.
  const src = await readFile(join(process.cwd(), 'src', 'palette.ts'), 'utf8');
  const parsePalette = (name, end) => {
    const start = src.indexOf(`export const ${name}`);
    const finish = src.indexOf(end, start);
    if (start < 0 || finish < 0) throw new Error(`cannot parse ${name}`);
    const palette = {};
    for (const m of src.slice(start, finish).matchAll(/'?([a-z-]+)'?:\s*'(oklch\([^']+\))'/g)) {
      palette[m[1]] = m[2];
    }
    return palette;
  };
  const dark = parsePalette('darkPalette', '} as const;');
  const light = { ...dark, ...parsePalette('lightPalette', '\n};') };

  const regions = JSON.parse(
    await readFile(join(process.cwd(), 'public', 'data', 'regions.geojson'), 'utf8'),
  ).features;

  const vertices = new Map();
  const tokenOf = new Map();
  const labelTokenOf = new Map();

  for (const f of regions) {
    const name = f.properties?.name;
    if (!name) continue;
    vertices.set(name, vertexKeys(f.geometry));
    const token = NAME_TOKEN[name] ?? HOUSE_TOKEN[f.properties.claimedBy];
    if (token) tokenOf.set(name, token);
    const labelToken = LABEL_TOKEN[f.properties.claimedBy];
    if (labelToken) labelTokenOf.set(name, labelToken);
  }

  const names = [...tokenOf.keys()];
  let failed = 0;

  for (const [theme, palette] of Object.entries({ dark, light })) {
    const land = oklchToRgb(palette.land);
    const lumOf = new Map();
    for (const [name, token] of tokenOf) {
      if (!palette[token]) throw new Error(`no such ${theme} token: ${token}`);
      lumOf.set(name, luminance(over(oklchToRgb(palette[token]), land, FILL_OPACITY)));
    }

    const pairs = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const [a, b] = [names[i], names[j]];
        const A = vertices.get(a);
        const B = vertices.get(b);
        let shared = 0;
        for (const k of B) if (A.has(k) && ++shared >= 3) break;
        if (shared < 3) continue;
        pairs.push({ a, b, d: Math.abs(lumOf.get(a) - lumOf.get(b)) });
      }
    }
    pairs.sort((x, y) => x.d - y.d);

    console.log(`${theme} region fills — ${pairs.length} adjacent pairs, worst first:\n`);
    for (const p of pairs) {
      const ok = p.d >= MIN_ADJACENT;
      if (!ok) failed++;
      console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} ${(p.a + ' / ' + p.b).padEnd(42)}${p.d.toFixed(4)}`,
      );
    }

    const inkMuted = luminance(oklchToRgb(palette['ink-muted']));
    let worstLabel = Infinity;
    let worstOn = '';
    for (const [name, l] of lumOf) {
      const cr = contrast(inkMuted, l);
      if (cr < worstLabel) {
        worstLabel = cr;
        worstOn = name;
      }
    }
    const labelOk = worstLabel >= MIN_LABEL_CONTRAST;
    if (!labelOk) failed++;

    console.log(
      `\n  worst adjacent separation: ${pairs[0].d.toFixed(4)} (floor ${MIN_ADJACENT})`,
    );
    console.log(
      `  ${labelOk ? 'ok  ' : 'FAIL'} ink-muted on ${worstOn}: ${worstLabel.toFixed(2)}:1 ` +
        `(AA ${MIN_LABEL_CONTRAST})`,
    );

    let worstRegionLabel = Infinity;
    let worstRegionOn = '';
    for (const [name, labelToken] of labelTokenOf) {
      const cr = contrast(luminance(oklchToRgb(palette[labelToken])), lumOf.get(name));
      if (cr < worstRegionLabel) {
        worstRegionLabel = cr;
        worstRegionOn = name;
      }
    }
    const regionLabelOk = worstRegionLabel >= MIN_LABEL_CONTRAST;
    if (!regionLabelOk) failed++;
    console.log(
      `  ${regionLabelOk ? 'ok  ' : 'FAIL'} region label on ${worstRegionOn}: ` +
        `${worstRegionLabel.toFixed(2)}:1 (AA ${MIN_LABEL_CONTRAST})\n`,
    );
  }

  if (failed) {
    console.error(
      `\n${failed} check(s) failed. Fills are laddered in three lightness tiers ` +
        `(see palette.ts); a new region or a changed border may need the ` +
        `adjacency graph re-coloured.`,
    );
    process.exit(1);
  }
  console.log('\nThe Value-First Rule holds.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
