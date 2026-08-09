/**
 * The palette, in OKLCH, as the single source of truth.
 *
 * This lives in TypeScript rather than CSS because the map style needs these
 * values at module-evaluation time. Vite injects imported CSS as <style> tags
 * asynchronously, so reading custom properties during construction returns
 * empty strings and MapLibre silently rejects the style. Defining them here
 * and projecting them into CSS (see applyTokens) removes the race entirely.
 *
 * See DESIGN.md for the rules these encode.
 */

export const palette = {
  /* Neutrals: the near-monochrome interface ground. */
  sea: 'oklch(16% 0.012 250)',
  'sea-deep': 'oklch(12% 0.014 250)',
  land: 'oklch(23% 0.008 250)',
  'land-high': 'oklch(27% 0.008 250)',
  /* Essos and Sothoryos. Between sea (16%) and land (23%): far enough back to
     read as "not the subject", far enough forward to be land and not water. */
  'land-far': 'oklch(19.5% 0.007 250)',
  /* Inland water — rivers and lakes — is the *same* value as the sea.
     Water is water: a lake that matches the bay down the coast reads as water
     instantly, where a lake in its own lighter tone reads as a clearing or a
     region boundary. Compared on screen at z5, this also renders the river
     network far more legibly; a lighter inland tone let the Trident's forks
     fade into the region fills. A hair more chroma than `sea` so it survives
     being a one-pixel line rather than a whole background. */
  water: 'oklch(16% 0.016 245)',
  rule: 'oklch(38% 0.010 250)',
  'rule-soft': 'oklch(30% 0.010 250)',

  /* Ink ramp, measured against --sea: ink 15.8:1, ink-muted 7.3:1 (both clear
     AA for body text). ink-faint is 3.5:1 — hairlines and marks only. */
  ink: 'oklch(93% 0.004 250)',
  'ink-muted': 'oklch(70% 0.006 250)',
  'ink-faint': 'oklch(52% 0.008 250)',
  /* Water labels: between ink-faint and ink-muted (~5:1 on sea). ink-faint
     disappears into the darkest water; ink-muted makes a sea name compete
     with the settlements sitting on top of it. */
  'ink-sea': 'oklch(61% 0.007 250)',

  /* Brass: the single interface accent. <=10% of any screen. */
  brass: 'oklch(78% 0.085 85)',
  'brass-dim': 'oklch(62% 0.070 85)',

  /* Data roles — map fills only, never chrome.

     Chroma and hue are both tuned for *adjacent* legibility rather than for
     how each colour looks alone. Painted at 0.42 over `land`, the original
     set left map-neighbouring regions 3-9 apart in RGB — below the ~10 where
     two colours stop reading as different on a dark ground. The North and the
     Vale were 3 apart; the Riverlands and the Iron Islands, 4.

     Raising chroma alone did not fix it: it lifted the *average* separation
     but barely moved the worst pairs, because those hues sat 20-25 degrees
     apart. So the old blue cluster (north/vale/riverlands/iron, all 195-265)
     is spread — the Vale to violet, the Iron Islands to teal — while The North
     keeps the cold blue that belongs to it. Worst adjacent pair is now 12,
     every pair 12+. See scripts note in ROADMAP.md. */
  'region-north': 'oklch(46% 0.065 245)',
  'region-vale': 'oklch(45% 0.065 295)',
  'region-riverlands': 'oklch(46% 0.065 200)',
  'region-iron': 'oklch(44% 0.065 165)',
  'region-west': 'oklch(47% 0.065 95)',
  'region-crown': 'oklch(46% 0.065 25)',
  'region-reach': 'oklch(47% 0.065 135)',
  'region-storm': 'oklch(45% 0.065 340)',
  'region-dorne': 'oklch(48% 0.065 60)',
  /* The Gift and the lands beyond the Wall stay near-neutral: they are not
     house territory, and a hue here would imply an allegiance they lack. */
  'region-watch': 'oklch(42% 0.016 250)',
  'region-wild': 'oklch(40% 0.014 250)',

  /* Region *labels*: each name in a pale tint of its own territory's hue, so
     the name is tied to the fill without needing a colour key.

     Same hue as the fill, L raised to 86% and chroma dropped to 0.055. The
     fills are dark (L~46% at 0.42 over land), so lightening is the only
     direction with room — going darker would sink the name into its own
     territory. Measured against the composited fill this holds 7.7-8.3:1, and
     10.8:1+ where a label straddles bare land or open sea. */
  'label-north': 'oklch(86% 0.055 245)',
  'label-vale': 'oklch(86% 0.055 295)',
  'label-riverlands': 'oklch(86% 0.055 200)',
  'label-iron': 'oklch(86% 0.055 165)',
  'label-west': 'oklch(86% 0.055 95)',
  'label-crown': 'oklch(86% 0.055 25)',
  'label-reach': 'oklch(86% 0.055 135)',
  'label-storm': 'oklch(86% 0.055 340)',
  'label-dorne': 'oklch(86% 0.055 60)',
  /* Not house territory, so no hue — matches the neutral fills above. */
  'label-watch': 'oklch(86% 0.010 250)',
  'label-wild': 'oklch(86% 0.010 250)',
} as const;

export type TokenName = keyof typeof palette;

/**
 * Project the palette into CSS custom properties on :root, so stylesheets can
 * use `var(--sea)` while TypeScript keeps the authoritative values.
 */
export function applyTokens() {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(palette)) {
    root.style.setProperty(`--${name}`, value);
  }
}
