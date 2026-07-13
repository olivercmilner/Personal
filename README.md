# Champ Check — Pokemon Champions Matchup Assistant

A static web app that helps you win the **90-second team preview** in Pokemon
Champions ranked doubles. Store your teams ahead of time, punch in the
opponent's six during preview, and get a damage-calc-backed recommendation of
**which four to bring, which two to lead, and why** — plus a prediction of the
opponent's likely sets and bring-four.

## How it works

1. **Teams** — build your six exactly as stored in-game: four moves, ability,
   held item, stat alignment (nature), and the 66-point spread (32 cap per
   stat, +1 stat per point at Lv50). Showdown-style paste import/export is
   supported (`Points:` line; `EVs:` lines are auto-converted).
2. **Matchup** — pick your prepared team, type the opponent's six into the
   keyboard-first search (type, Enter, repeat). The engine:
   - predicts each opponent Pokemon's likely moves/item/ability/spread from a
     bundled Reg M-B meta dataset (seeded from public Pikalytics/Pokemon Zone
     usage data), falling back to a stat-inferred estimate for off-meta picks;
   - runs real damage calcs (via `@smogon/calc`, mapped exactly onto the
     Champions stat system) for every pairing in both directions;
   - estimates the opponent's most likely bring-four and leads;
   - scores all 15×6 bring/lead configurations and explains the top picks in
     plain English, with the full 6×6 threat matrix underneath.
3. **Log** — after each game, record what they actually brought/led and any
   revealed moves/items. Predictions recalibrate from your logged games
   (set-confirmation counts and bring/lead frequencies), so the tool gets
   sharper the more you play. Backup/restore everything as JSON.

The engine goes beyond raw type matchups: it recognizes known ladder team
archetypes (`src/data/team-archetypes.json` — The Big Six, Pelipper rain,
Trick Room variants, Grimmsnarl screens, …) and applies their documented
bring/lead patterns; it penalizes bring-fours that stack multiple Mega
Stones (only one Pokemon can Mega Evolve); it values support roles (speed
control, redirection, Fake Out, screens) alongside damage; and a
"Watch-outs" panel surfaces ability interactions — immunity clusters
against your attack types, Contrary/Defiant punishing your Intimidate and
stat-drop moves, Fake Out blockers. Analysis is independent of the order
you enter opponents in.

All data lives in your browser (localStorage). No accounts, no server.

## Champions-specific modelling

- Lv50, 66 stat points, 32 per stat, +1 stat per point, applied after the
  stat alignment multiplier (`src/engine/stats.ts`)
- Stat alignments = natures minus the redundant neutrals (Serious only)
- All 29 new-generation Mega Evolutions (the Legends: Z-A roster — Mega
  Delphox, Chesnaught, Greninja, Dragonite, Starmie, … — plus the
  Champions-exclusive Mega Staraptor and Mega Raichu X/Y) are bundled as
  custom species with community-documented stats
  (`src/data/custom-species.json`), and their Mega Stones as custom held
  items (`src/data/custom-items.json`). A few stone names for the newest
  Megas follow the standard "-ite" pattern where the official name hasn't
  been documented yet — correct them in that file if the in-game name
  differs. To use a Mega on your own team, add the Mega forme as the
  species (e.g. "Delphox-Mega") holding its stone.
- Meta sets for the top ~50 Reg M-B Pokemon live in
  `src/data/meta-sets.json` — edit this file (or add overrides in-app) as the
  meta shifts

## Development

```bash
npm install
npm run dev            # local dev server
npm test               # engine + dataset integrity tests
npm run build          # production build (dist/)
npm run generate-data  # regenerate species/moves/items from @pkmn/dex
```

Engine tuning knobs are in one place: `WEIGHTS` in `src/engine/optimize.ts`.

## Deploying

Pushing to `main` triggers `.github/workflows/deploy.yml`, which tests,
builds, and publishes to GitHub Pages (enable Pages → Source: GitHub Actions
in the repo settings once).

## Disclaimers

Pokemon and Pokemon Champions are trademarks of Nintendo/Creatures
Inc./GAME FREAK inc. This is an unofficial fan-made training tool. Sprite and
artwork images are loaded from public community CDNs (Pokemon Showdown,
PokeAPI) at runtime.
