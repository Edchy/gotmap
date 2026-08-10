/**
 * Annotates prepared features with the wiki page that describes them.
 *
 * Writes a `wiki` property — the *resolved* page title — onto every place,
 * region and island whose name matches a real page, and leaves the property
 * absent otherwise. The panel then links only where a link is known to work:
 * a dead link that looks authoritative is the same failure as presenting a
 * speculative point as confirmed.
 *
 * Run: node scripts/check-wiki-links.mjs [--wiki=<host>] [--dry]
 *
 *
 * WHY THIS IS A SEPARATE SCRIPT, AND NOT PART OF THE BUILD
 *
 * `awoiaf.westeros.org/robots.txt` disallows a number of automated agents by
 * name. Whether any given tool is covered is a question about that tool, not
 * about this repo — so this script is *not* wired into `npm run build` and is
 * not run automatically. A person runs it deliberately, having decided their
 * own access is appropriate, and commits the result.
 *
 * That is also why the output is committed rather than regenerated: the atlas
 * ships a static allowlist and never contacts the wiki at runtime. Readers of
 * the site make no request to it at all, and the data goes stale only as fast
 * as a wiki about a finished series does.
 *
 * Set a contact address in USER_AGENT before running. An unidentified script
 * hammering someone's wiki is rude, and MediaWiki operators block on exactly
 * that.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CONTACT = process.env.WIKI_CONTACT ?? 'unset';
const USER_AGENT = `westeros-atlas/1.0 (non-commercial fan map; build-time link check; ${CONTACT})`;

const DATA = join(process.cwd(), 'public', 'data');

/**
 * The wiki to check against.
 *
 * AWOIAF (awoiaf.westeros.org) is the better fit on register and on book
 * coverage, and was the first choice. It is unusable from a script: Cloudflare
 * serves a browser-integrity challenge on *every* path including the homepage,
 * so a 403 is returned regardless of who is asking or how politely. Passing it
 * would mean defeating a bot check rather than identifying ourselves properly,
 * which is not something to build into a repo.
 *
 * Fandom's API is open and answers plainly, so that is what ships. Pass
 * `--wiki=` to override if AWOIAF ever drops the challenge.
 */
const DEFAULT_WIKI = 'gameofthrones.fandom.com';

/** MediaWiki caps a titles= query at 50. */
const BATCH = 50;

/**
 * Where each wiki puts its articles. MediaWiki installs differ: Fandom serves
 * `/wiki/Title`, a default install serves `/index.php/Title`.
 *
 * Written into the data as `wikiBase` alongside the titles so the UI builds
 * URLs from what was actually checked, rather than hard-coding a host that
 * could drift out of sync with the allowlist.
 */
const ARTICLE_PATH = {
  'gameofthrones.fandom.com': '/wiki/',
  'awoiaf.westeros.org': '/index.php/',
};

/** Files to annotate, and where the name lives in each. */
const TARGETS = ['places', 'regions', 'island-labels'];

/**
 * Alternate titles to try when a name matches no page.
 *
 * Only the leading article, and only as a *fallback* after the exact name
 * fails. This is worth doing rather than clever: on the show wiki it rescues
 * the Eyrie, the Twins, the Dreadfort, the Iron Islands and the Bloody Gate —
 * which is to say, precisely the places people look up.
 *
 * Deliberately not fuzzy. A near-match that resolves to the wrong page is
 * worse than no link, and "Darry" the castle vs "Darry" the house is exactly
 * the kind of collision a looser rule would get wrong silently.
 */
const variantsFor = (name) => (/^The /.test(name) ? [name.replace(/^The /, '')] : []);

/**
 * Ask the wiki which of these titles exist.
 *
 * Returns a Map of queried title -> resolved page title. MediaWiki answers
 * with the *canonical* title, having followed normalisation and redirects, so
 * both hops are unwound to get back to the name we asked about. Without that
 * the map is keyed by a title the caller never mentioned.
 */
async function resolveTitles(host, titles) {
  const resolved = new Map();

  for (let i = 0; i < titles.length; i += BATCH) {
    const batch = titles.slice(i, i + BATCH);
    const url =
      `https://${host}/api.php?action=query&format=json&redirects=1&titles=` +
      batch.map(encodeURIComponent).join('%7C');

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(
        `${host} returned HTTP ${res.status}.\n` +
          (res.status === 403
            ? '403 usually means the wiki is refusing this client. Check the ' +
              'site\'s robots.txt and terms before retrying, and set ' +
              'WIKI_CONTACT so the request identifies you.'
            : ''),
      );
    }

    const body = await res.json();
    const query = body.query ?? {};

    // `normalized` and `redirects` each map from -> to; chain them so a title
    // that was both normalised and redirected still traces back to our input.
    const origin = new Map();
    for (const n of query.normalized ?? []) origin.set(n.to, n.from);
    for (const r of query.redirects ?? []) origin.set(r.to, origin.get(r.from) ?? r.from);

    for (const page of Object.values(query.pages ?? {})) {
      if ('missing' in page) continue;
      const asked = origin.get(page.title) ?? page.title;
      resolved.set(asked, page.title);
    }

    process.stderr.write('.');
  }

  return resolved;
}

async function main() {
  const args = process.argv.slice(2);
  const host = args.find((a) => a.startsWith('--wiki='))?.slice(7) ?? DEFAULT_WIKI;
  const dry = args.includes('--dry');

  if (CONTACT === 'unset') {
    console.warn(
      'warning: no WIKI_CONTACT set. Run as ' +
        'WIKI_CONTACT="you@example.com" node scripts/check-wiki-links.mjs\n',
    );
  }

  const files = new Map();
  for (const target of TARGETS) {
    const path = join(DATA, `${target}.geojson`);
    files.set(target, JSON.parse(await readFile(path, 'utf8')));
  }

  const names = [
    ...new Set(
      [...files.values()].flatMap((fc) =>
        fc.features.map((f) => f.properties?.name).filter((n) => typeof n === 'string' && n),
      ),
    ),
  ];

  console.log(`checking ${names.length} names against ${host}`);

  const resolved = await resolveTitles(host, names);

  // Second pass: only the names that found nothing, under their variants.
  const unresolved = names.filter((n) => !resolved.has(n));
  const variantOf = new Map();
  for (const name of unresolved) {
    for (const v of variantsFor(name)) variantOf.set(v, name);
  }

  if (variantOf.size) {
    const viaVariant = await resolveTitles(host, [...variantOf.keys()]);
    for (const [variant, title] of viaVariant) {
      const original = variantOf.get(variant);
      // First variant to resolve wins; there is only ever one today.
      if (original && !resolved.has(original)) resolved.set(original, title);
    }
  }

  process.stderr.write('\n');

  const articlePath = ARTICLE_PATH[host] ?? '/wiki/';
  const wikiBase = `https://${host}${articlePath}`;

  let annotated = 0;
  let cleared = 0;
  for (const [target, fc] of files) {
    // Recorded once per collection rather than per feature: 205 copies of the
    // same string is noise in the payload and one more thing to disagree.
    fc.wikiBase = wikiBase;
    for (const feature of fc.features) {
      const name = feature.properties?.name;
      const title = typeof name === 'string' ? resolved.get(name) : undefined;
      if (title) {
        feature.properties.wiki = title;
        annotated++;
      } else if (feature.properties && 'wiki' in feature.properties) {
        // A page that has since been deleted or renamed must lose its link,
        // or a stale run leaves a dead one behind.
        delete feature.properties.wiki;
        cleared++;
      }
    }
    if (!dry) {
      await writeFile(join(DATA, `${target}.geojson`), JSON.stringify(fc));
    }
  }

  const missing = names.filter((n) => !resolved.has(n));
  const pct = Math.round((resolved.size / names.length) * 100);

  console.log(`\nresolved ${resolved.size}/${names.length} (${pct}%)`);
  console.log(`annotated ${annotated} features${cleared ? `, cleared ${cleared} stale` : ''}`);
  if (dry) console.log('(--dry: nothing written)');

  console.log(`\nno page found for ${missing.length}:`);
  for (const name of missing) console.log(`  ${name}`);
  console.log(
    '\nMany of these are genuinely nameless upstream ("Village", "Holdfast", ' +
      '"Tower") and correctly have no page. A recognisable name in this list ' +
      'is more likely a misspelling in the data — add it to NAME_FIXES in ' +
      'prepare-data.mjs rather than special-casing it here.',
  );
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
