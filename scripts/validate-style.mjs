/**
 * Validates the map style against MapLibre's spec, outside the browser.
 *
 * Worth having because an invalid style fails *silently*: MapLibre registers
 * no layers and paints nothing, with no console error. Two real bugs found
 * this way — `['zoom']` inside a layer `filter`, and `['zoom']` buried in
 * arithmetic rather than as the direct input to a top-level interpolate.
 *
 * Run: npm run check
 */
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = readFileSync(new URL('../src/map-style.ts', import.meta.url), 'utf8');

// Strip types and the palette import; the token values are irrelevant to
// structural validation, so any valid colour will do.
const stripped = source
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/const token = [^;]+;/, "const token = () => '#888888';");

// Node 24 strips TypeScript natively, so the module can be imported as-is
// once the imports are removed.
const temp = join(tmpdir(), `map-style-${process.pid}.ts`);
writeFileSync(temp, stripped);

let style;
try {
  ({ buildStyle: style } = await import(`file://${temp}`));
  style = style();
} finally {
  unlinkSync(temp);
}
const errors = validateStyleMin(style);

if (errors.length) {
  console.error(`${errors.length} style error(s):\n`);
  for (const error of errors) console.error(`  ${error.message}`);
  process.exit(1);
}

console.log(`style valid — ${style.layers.length} layers, ${Object.keys(style.sources).length} sources`);
