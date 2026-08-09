/**
 * Generates MapLibre SDF glyph files (PBF) from Inter TTFs.
 *
 * WebGL has no concept of text — symbol layers draw each character as a small
 * textured quad. The texture holds a *signed distance field* rather than a
 * bitmap: each pixel stores its distance from the glyph's edge, which stays
 * meaningful under interpolation and so keeps text crisp at any zoom.
 *
 * Every place name in this atlas is ASCII, so only the 0-255 range is built —
 * a general-purpose map would need dozens of ranges to cover other scripts.
 *
 * Run: node scripts/build-glyphs.mjs   (output is committed; rerun only if
 * the font or the weights in use change)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fontnik from 'fontnik';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets', 'fonts');
const OUT = join(ROOT, 'public', 'glyphs');

/**
 * One stack per weight used by the label hierarchy. The names here are what
 * the style's `text-font` refers to, so they must match exactly.
 */
const STACKS = [
  { file: 'Inter-Regular.ttf', name: 'Inter Regular' },
  { file: 'Inter-Medium.ttf', name: 'Inter Medium' },
  { file: 'Inter-SemiBold.ttf', name: 'Inter SemiBold' },
];

/** Latin-1 only: every label in the dataset falls inside it. */
const RANGE = { start: 0, end: 255 };

const range = (buffer, start, end) =>
  new Promise((resolve, reject) => {
    fontnik.range({ font: buffer, start, end }, (err, data) =>
      err ? reject(err) : resolve(data),
    );
  });

async function main() {
  for (const { file, name } of STACKS) {
    const buffer = await readFile(join(SRC, file));
    const pbf = await range(buffer, RANGE.start, RANGE.end);

    const dir = join(OUT, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${RANGE.start}-${RANGE.end}.pbf`), pbf);

    console.log(
      `${name.padEnd(18)} ${String(Math.round(pbf.length / 1024)).padStart(4)} KB`,
    );
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
