/**
 * Generates the bundled datasets (species.json, moves.json, items.json) from
 * @pkmn/dex (Pokemon Showdown data). Run with: npm run generate-data
 *
 * Champions uses the full National Dex battle engine with Megas legal, so we
 * keep every real species (including past-gen and Mega formes) and exclude
 * only things that cannot appear: CAP fakemons, Gmax/Totem formes, and
 * unobtainable formes.
 */
import { Dex } from '@pkmn/dex'
import * as fs from 'node:fs'
import * as path from 'node:path'

const OUT_DIR = path.join(import.meta.dirname, '..', 'src', 'data', 'generated')
fs.mkdirSync(OUT_DIR, { recursive: true })

// ---- Species ----
const EXCLUDED_FORMES = /-(Gmax|Totem)/
const species = Dex.species
  .all()
  .filter((s) => {
    if (s.num <= 0) return false // CAP / missingno
    if (s.isNonstandard && !['Past', 'Unobtainable'].includes(s.isNonstandard)) return false
    if (s.isNonstandard === 'Unobtainable' && !s.forme.includes('Mega') && s.forme !== 'Primal')
      return false
    if (EXCLUDED_FORMES.test(s.name)) return false
    return true
  })
  .map((s) => ({
    id: s.id as string,
    name: s.name,
    num: s.num,
    types: s.types as string[],
    baseStats: s.baseStats,
    abilities: Object.values(s.abilities).filter(Boolean) as string[],
    baseSpecies: s.baseSpecies !== s.name ? s.baseSpecies : undefined,
    forme: s.forme || undefined,
    weightkg: s.weightkg,
  }))
  .sort((a, b) => a.num - b.num || a.name.localeCompare(b.name))

fs.writeFileSync(path.join(OUT_DIR, 'species.json'), JSON.stringify(species))
console.log(`species.json: ${species.length} species`)

// ---- Moves ----
const moves = Dex.moves
  .all()
  .filter((m) => !m.isNonstandard || m.isNonstandard === 'Past')
  .map((m) => ({
    id: m.id as string,
    name: m.name,
    type: m.type as string,
    category: m.category as string,
    basePower: m.basePower,
    accuracy: m.accuracy === true ? 0 : m.accuracy,
    priority: m.priority,
    target: m.target as string,
    shortDesc: m.shortDesc || undefined,
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

fs.writeFileSync(path.join(OUT_DIR, 'moves.json'), JSON.stringify(moves))
console.log(`moves.json: ${moves.length} moves`)

// ---- Items (held items only, for builder dropdowns) ----
const items = Dex.items
  .all()
  .filter((i) => !i.isNonstandard || i.isNonstandard === 'Past')
  .map((i) => ({ id: i.id as string, name: i.name, shortDesc: i.shortDesc || undefined }))
  .sort((a, b) => a.name.localeCompare(b.name))

fs.writeFileSync(path.join(OUT_DIR, 'items.json'), JSON.stringify(items))
console.log(`items.json: ${items.length} items`)
