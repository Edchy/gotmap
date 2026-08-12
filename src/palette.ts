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

export const darkPalette = {
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

  /* Roads: a made thing, so warm where the water is cold.
     Rivers and roads are both thin lines crossing the same region fills, and
     hue is the only cue that separates them at one pixel — a neutral road
     reads as a tributary. Held to 0.018 chroma and 40% L: enough to say
     "not water", far short of the 0.065 the data roles use, because a road
     is ground truth about the world and not a data role. */
  road: 'oklch(40% 0.018 70)',

  /* The Wall: the one piece of built geography with its own colour.
     Ice, so it takes the coldest hue on the map and the highest value of any
     line — brighter than the coastline hairline, because at z3 this is a
     4-degree stroke that has to read as a border rather than a river. */
  wall: 'oklch(72% 0.030 220)',

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
     every pair 12+. See scripts note in ROADMAP.md.

     LIGHTNESS IS A THREE-STEP LADDER, NOT NINE DISTINCT VALUES.

     Hue alone satisfied the *adjacent legibility* problem above but failed The
     Value-First Rule: every one of these sat at L 44-48%, so composited at
     0.42 the whole political map spanned 0.0104 in greyscale luminance and all
     14 adjacent pairs were below the ~0.005 where two greys stop reading as
     different. Four pairs were identical to four decimal places. Desaturated —
     or seen by a colourblind reader, which is the same test — the map went
     flat.

     Nine separate lightness values cannot fix that. A 3% L step buys only
     ~0.004 luminance here, so nine steps would need a ~27% range, and there is
     nowhere to put it: `ink-muted` (the colour of 96 castle labels) drops
     below AA 4.5:1 against its own fill at about L 46%, so the ladder can only
     go *down*, and the bottom is bounded by `sea` — a fill darker than the
     water reads as water.

     But nine values are not needed. Only *adjacent* regions must differ, which
     makes this a graph colouring: greedy colouring of the adjacency graph
     (shared vertices, the same test `main.ts` uses for "Borders") needs just
     **three** tiers. Three steps can each be large enough to actually read.

     The tiers are 44% / 37% / 30%. Worst adjacent pair goes from 0.0000 to
     0.0068, every pair clears the threshold, and `ink-muted` keeps 4.67:1 —
     real margin over AA rather than the 4.51 a 46% top tier would have left.

     Tier assignment is therefore NOT free: it satisfies the colouring, and
     changing one region's tier can break a neighbour. Re-run the colouring if
     the political layer ever changes. */
  /* tier 1 (44%) — Riverlands, Iron Islands, Stormlands, and both Gifts */
  'region-riverlands': 'oklch(44% 0.065 200)',
  'region-iron': 'oklch(44% 0.065 165)',
  'region-storm': 'oklch(44% 0.065 340)',
  /* tier 2 (37%) — The North, the Vale, the Reach */
  'region-north': 'oklch(37% 0.065 245)',
  'region-vale': 'oklch(37% 0.065 295)',
  'region-reach': 'oklch(37% 0.065 135)',
  /* tier 3 (30%) — the Westerlands, Crownlands, Dorne */
  'region-west': 'oklch(30% 0.065 95)',
  'region-crown': 'oklch(30% 0.065 25)',
  'region-dorne': 'oklch(30% 0.065 60)',
  /* The Gift and the lands beyond the Wall stay near-neutral: they are not
     house territory, and a hue here would imply an allegiance they lack. They
     still take a tier, because "not claimed by a house" is no reason to be
     invisible against the region next door.

     The two Gifts need *separate* tokens even though the Night's Watch holds
     both: they share a border, so a single `region-watch` keyed on `claimedBy`
     would leave them the one pair the ladder failed to separate. `regionTint`
     therefore special-cases them by name before falling through to house. */
  'region-gift-new': 'oklch(44% 0.016 250)',
  'region-gift-bran': 'oklch(37% 0.016 250)',
  'region-wild': 'oklch(44% 0.014 250)',

  /* Region *labels*: each name in a pale tint of its own territory's hue, so
     the name is tied to the fill without needing a colour key.

     Same hue as the fill, L raised to 86% and chroma dropped to 0.055. The
     fills are dark, so lightening is the only direction with room — going
     darker would sink the name into its own territory. Measured against the
     composited fill this holds 8.2-10.3:1 (it improved when the fills were
     laddered downward), and more where a label straddles bare land or sea. */
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

export type TokenName = keyof typeof darkPalette;
export type Palette = Record<TokenName, string>;
export type Theme = 'dark' | 'light';

/**
 * Daylight atlas palette.
 *
 * The water is a cool off-white rather than paper or parchment. Westeros is
 * one clear value step darker, while political fills carry more chroma than
 * the night palette: daylight can support vivid ink without making the map
 * glare. Region lightness still follows three tiers so every shared border
 * survives desaturation.
 */
export const lightPalette: Palette = {
  ...darkPalette,
  sea: 'oklch(97% 0.006 235)',
  'sea-deep': 'oklch(99% 0.004 235)',
  land: 'oklch(88% 0.012 235)',
  'land-high': 'oklch(83% 0.014 235)',
  'land-far': 'oklch(93% 0.008 235)',
  water: 'oklch(97% 0.010 230)',
  rule: 'oklch(55% 0.014 235)',
  'rule-soft': 'oklch(76% 0.012 235)',
  road: 'oklch(48% 0.040 70)',
  wall: 'oklch(48% 0.065 220)',
  ink: 'oklch(20% 0.014 250)',
  'ink-muted': 'oklch(35% 0.014 250)',
  'ink-faint': 'oklch(53% 0.012 250)',
  'ink-sea': 'oklch(43% 0.018 245)',
  brass: 'oklch(43% 0.105 70)',
  'brass-dim': 'oklch(47% 0.085 70)',

  /* tier 1 — darkest daylight fills */
  'region-riverlands': 'oklch(58% 0.125 200)',
  'region-iron': 'oklch(58% 0.125 165)',
  'region-storm': 'oklch(58% 0.125 340)',
  'region-gift-new': 'oklch(58% 0.030 235)',
  'region-wild': 'oklch(58% 0.026 235)',
  /* tier 2 */
  'region-north': 'oklch(68% 0.125 245)',
  'region-vale': 'oklch(68% 0.125 295)',
  'region-reach': 'oklch(68% 0.125 135)',
  'region-gift-bran': 'oklch(68% 0.030 235)',
  /* tier 3 — lightest daylight fills */
  'region-west': 'oklch(78% 0.125 95)',
  'region-crown': 'oklch(78% 0.125 25)',
  'region-dorne': 'oklch(78% 0.125 60)',

  /* Dark label inks preserve each territory hue over the light ground. */
  'label-north': 'oklch(30% 0.095 245)',
  'label-vale': 'oklch(30% 0.095 295)',
  'label-riverlands': 'oklch(30% 0.095 200)',
  'label-iron': 'oklch(30% 0.095 165)',
  'label-west': 'oklch(30% 0.095 95)',
  'label-crown': 'oklch(30% 0.095 25)',
  'label-reach': 'oklch(30% 0.095 135)',
  'label-storm': 'oklch(30% 0.095 340)',
  'label-dorne': 'oklch(30% 0.095 60)',
  'label-watch': 'oklch(30% 0.020 235)',
  'label-wild': 'oklch(30% 0.020 235)',
};

export const palettes: Record<Theme, Palette> = {
  dark: darkPalette,
  light: lightPalette,
};

/**
 * Project the palette into CSS custom properties on :root, so stylesheets can
 * use `var(--sea)` while TypeScript keeps the authoritative values.
 */
export function applyTokens(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  for (const [name, value] of Object.entries(palettes[theme])) {
    root.style.setProperty(`--${name}`, value);
  }
}
