# Product

## Register

product

## Users

Primarily **curious viewers mid-episode**. Someone is watching Game of Thrones, pauses, and wants to know where a place is, what it's near, and who holds it. Their context is specific and shapes everything:

- **Interrupted.** They are not settling in to browse. They have a question and want it answered in seconds, then they resume the episode.
- **Second-screen, often mobile.** Phone in hand, on a couch, in a dark room, at night.
- **Spoiler-sensitive.** They are partway through the series. Showing them a later-season state of the world is a product failure, not an edge case.
- **Not lore experts.** They may not know that the Riverlands and the Trident are related. The map must teach by showing, never by requiring prior knowledge.

Secondary: lore readers who want to trace journeys and holdings in depth. They are served by depth that stays *out of the way* until asked for — never by making the default view denser.

The job to be done: **"Where is this place, and how does it relate to the places I already know?"**

## Product Purpose

An interactive map of the known world of Ice and Fire that answers spatial questions instantly and beautifully, without spoiling the user and without demanding they learn an interface first.

It exists because the available fan maps are either visually dated (quartermaester.info: 2010-era Google Maps tiles, fixed zoom, no mobile story) or visually pleasant but shallow. None treat the viewer's actual moment — paused, curious, mid-episode, spoiler-exposed — as the design target.

Success looks like:

- A newcomer lands cold, understands what they're looking at within one screen, and finds a place without reading instructions.
- A user can set how far they've watched, and trust the map never gets ahead of them.
- It works well enough on a phone in a dark room that it becomes the reflexive thing to reach for mid-episode.
- It is good enough to look at that people open it when they have no question at all.

Non-commercial by necessity: the underlying map data is CC BY-NC-SA 3.0, and the world is George R.R. Martin's IP. This is a fan project and is scoped as one.

## Brand Personality

**Clean, effortless, invisible.**

The interface disappears; only the world remains. Every control must earn its pixels, and the default state is close to bare map. Confidence is expressed through restraint and accuracy, not ornament.

Voice: plain and factual. Place names, distances, and allegiances stated without embellishment. No in-world roleplay in the UI copy — the map does not address the user as "my lord," and nothing is labelled a "raven." The world supplies the atmosphere; the interface stays quiet.

Emotional goal: calm, oriented, slightly awed. The feeling of a well-made instrument, not a fan shrine.

## Anti-references

Four explicit rejections, all confirmed by the user:

- **Fan-wiki clutter** (Fandom.com). Dense sidebars, mismatched type, ad slots, nested boxes. The default look of Game of Thrones content on the web, and the easiest trap to fall into as data depth grows.
- **Faux-medieval kitsch.** Parchment textures, blackletter type, sepia everything, dragons in the chrome, ornamental borders. The obvious move for this subject and therefore the crowded one. Warm-neutral cream/sand/parchment backgrounds are banned outright.
- **Generic map-provider UI.** Stock chrome: floating white pill buttons, default blue accent, teardrop markers, an attribution bar treated as an afterthought. Reads as unstyled rather than deliberately restrained.
- **Dashboard SaaS.** Card grids, stat tiles, persistent sidebar nav, gradient accents. Treating a world map as an analytics product.

Additionally, quartermaester.info is a **functional** reference (its spoiler slider and character paths are good ideas worth carrying forward) but a **visual** anti-reference.

## Design Principles

1. **The map is the product.** Chrome is guilty until proven necessary. Any panel, toolbar, or badge must justify itself against simply not existing. When in doubt, it goes away until asked for.

2. **Spoiler safety is a feature, not a filter.** The user's progress through the series is a first-class piece of state that the entire map respects — labels, territory, journeys, and search results alike. It is set early, remembered, and never silently violated.

3. **Depth on demand, never by default.** The first screen is calm and legible. Density arrives only when the user asks for it, by zooming, selecting, or searching. Lore readers get their depth without the mid-episode viewer paying for it.

4. **Answer in three seconds.** The core loop — open, find, understand, close — is the thing to optimize. Nothing in the default path may require reading instructions, waiting on a load, or dismissing a modal.

5. **One object, not layers.** The basemap and the interactive vector layers must read as a single crafted artifact. Nothing may look like clip art floating over a painting.

## Accessibility & Inclusion

- **WCAG AA contrast throughout**, committed from the start rather than retrofitted. Body text ≥4.5:1, large text and UI affordances ≥3:1, against the actual dark ground they sit on — verified, not assumed. Map labels over varied terrain are the hard case and get explicit treatment (halo, casing, or plate).
- Dark ground is the default, chosen for the night-viewing context. It must not become an excuse for low-contrast "atmospheric" gray-on-gray text.
- Not committed for the MVP but designed so as not to preclude: full keyboard navigation of map and search, reduced-motion alternatives for timeline and camera animation, and colorblind-safe encoding (house and allegiance color always paired with label, pattern, or icon rather than carrying meaning alone). Principle 2 and the timeline feature both imply motion, so reduced-motion support should land with them rather than after.
