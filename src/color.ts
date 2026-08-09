/**
 * OKLCH -> sRGB hex.
 *
 * Tokens are authored in OKLCH (see tokens.css), but MapLibre's style-spec
 * validator predates CSS Color 4 and rejects `oklch(...)` outright. Rather
 * than duplicating the palette in hex — two sources of truth that drift —
 * we read the CSS custom properties and convert at style-build time.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Linear-light sRGB channel to gamma-encoded. */
const encodeGamma = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

const toHex2 = (c: number) =>
  Math.round(clamp01(c) * 255)
    .toString(16)
    .padStart(2, '0');

/** Parse `oklch(L% C H)` or `oklch(L% C H / A)`. */
const OKLCH_RE =
  /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/i;

export function oklchToHex(input: string): string {
  const match = OKLCH_RE.exec(input.trim());
  if (!match) return input; // already hex, or something we shouldn't touch

  const L = parseFloat(match[1]) / 100;
  const C = parseFloat(match[2]);
  const hDeg = parseFloat(match[3]);
  const alpha = match[4] === undefined ? 1 : parseFloat(match[4]);

  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  // OKLab -> LMS
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  // LMS -> linear sRGB
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const hex =
    '#' +
    toHex2(encodeGamma(r)) +
    toHex2(encodeGamma(g)) +
    toHex2(encodeGamma(bl));

  return alpha < 1 ? hex + toHex2(alpha) : hex;
}

/** Read a CSS custom property and return it as a hex string MapLibre accepts. */
export function tokenHex(name: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return oklchToHex(raw);
}
