/**
 * Generates the bundled datasets from Pokemon Showdown's `champions` mod —
 * the authoritative machine-readable implementation of Pokemon Champions
 * (current regulation). Run with: npm run generate-data
 *
 * Sources (fetched from raw.githubusercontent.com/smogon/pokemon-showdown):
 * - data/mods/champions/formats-data.ts  -> the exact legal roster (tier != Illegal)
 * - data/mods/champions/items.ts         -> per-item availability overrides
 * - data/mods/champions/moves.ts         -> move availability + Champions balance changes
 * - data/pokedex.ts                      -> species stats/types/abilities (incl. new Megas + requiredItem stones)
 * - data/items.ts                        -> item names/descriptions
 *
 * champions overrides applied on top.
 */
import { transformSync } from 'esbuild'
import * as fs from 'node:fs'
import * as path from 'node:path'

const RAW = 'https://raw.githubusercontent.com/smogon/pokemon-showdown/master'
const OUT_DIR = path.join(import.meta.dirname, '..', 'src', 'data', 'generated')
fs.mkdirSync(OUT_DIR, { recursive: true })

async function fetchDataObject(urlPath: string): Promise<Record<string, any>> {
  const res = await fetch(`${RAW}/${urlPath}`)
  if (!res.ok) throw new Error(`${urlPath}: HTTP ${res.status}`)
  // Data files are TS modules whose sole export is one big object literal
  // (with TS casts inside handler bodies) — transpile to CJS and evaluate.
  const { code } = transformSync(await res.text(), { loader: 'ts', format: 'cjs' })
  const module = { exports: {} as Record<string, any> }
  new Function('exports', 'module', 'require', code)(module.exports, module, () => ({}))
  const values = Object.values(module.exports)
  if (values.length !== 1) throw new Error(`${urlPath}: expected a single export`)
  return values[0] as Record<string, any>
}

const [champFormats, champItems, champMoves, mainDex, mainItems, mainMoves] = await Promise.all([
  fetchDataObject('data/mods/champions/formats-data.ts'),
  fetchDataObject('data/mods/champions/items.ts'),
  fetchDataObject('data/mods/champions/moves.ts'),
  fetchDataObject('data/pokedex.ts'),
  fetchDataObject('data/items.ts'),
  fetchDataObject('data/moves.ts'),
])

// ---- Species: exactly the Champions roster ----
const species = Object.entries(champFormats)
  .filter(([, fd]: [string, any]) => fd.tier && fd.tier !== 'Illegal')
  .map(([id]) => {
    const d = mainDex[id]
    if (!d) throw new Error(`roster species missing from pokedex: ${id}`)
    return {
      id,
      name: d.name as string,
      num: d.num as number,
      types: d.types as string[],
      baseStats: d.baseStats,
      abilities: Object.values(d.abilities) as string[],
      baseSpecies: d.baseSpecies && d.baseSpecies !== d.name ? (d.baseSpecies as string) : undefined,
      forme: (d.forme as string) || undefined,
      weightkg: d.weightkg as number,
      requiredItem: (d.requiredItem as string) || undefined,
    }
  })
  .sort((a, b) => a.num - b.num || a.name.localeCompare(b.name))

fs.writeFileSync(path.join(OUT_DIR, 'species.json'), JSON.stringify(species))
console.log(`species.json: ${species.length} species in the Champions roster`)

// ---- Items: only what the champions mod leaves standard ----
// The mod enumerates overrides: isNonstandard "Past" = removed from the
// game, null = explicitly available. Items without an override inherit the
// gen 9 default (standard = available).
function itemAvailable(id: string): boolean {
  const override = champItems[id]
  if (override && 'isNonstandard' in override) return override.isNonstandard === null
  const base = mainItems[id]
  return !!base && !base.isNonstandard
}
const items = Object.entries(mainItems)
  .filter(([id]) => itemAvailable(id))
  .map(([id, d]: [string, any]) => ({
    id,
    name: d.name as string,
    shortDesc: (d.shortDesc ?? d.desc) as string | undefined,
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

fs.writeFileSync(path.join(OUT_DIR, 'items.json'), JSON.stringify(items))
console.log(`items.json: ${items.length} items available in Champions`)

// ---- Moves: Showdown master base data + champions availability/balance overrides ----
function moveAvailable(id: string): boolean {
  const override = champMoves[id]
  if (override && 'isNonstandard' in override) return override.isNonstandard === null
  return !mainMoves[id].isNonstandard
}
const moves = Object.entries(mainMoves)
  .filter(([id, d]: [string, any]) => typeof d.num === 'number' && d.num > 0 && moveAvailable(id))
  .map(([id, d]: [string, any]) => {
    const o = champMoves[id] ?? {}
    const accuracy = o.accuracy ?? d.accuracy
    return {
      id,
      name: d.name as string,
      type: (o.type ?? d.type) as string,
      category: (o.category ?? d.category) as string,
      basePower: (o.basePower ?? d.basePower) as number,
      accuracy: accuracy === true ? 0 : (accuracy as number),
      priority: (o.priority ?? d.priority) as number,
      target: (o.target ?? d.target) as string,
      shortDesc: (o.shortDesc ?? d.shortDesc ?? d.desc) as string | undefined,
    }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

fs.writeFileSync(path.join(OUT_DIR, 'moves.json'), JSON.stringify(moves))
console.log(`moves.json: ${moves.length} moves available in Champions`)
