import type { ItemData, MoveData, SpeciesData } from '../types'
import speciesJson from './generated/species.json'
import movesJson from './generated/moves.json'
import itemsJson from './generated/items.json'

// All three datasets are generated from Pokemon Showdown's `champions` mod
// (the authoritative implementation of the game) by
// scripts/generate-champions-data.ts — they contain EXACTLY the species,
// items, and moves available in Pokemon Champions, nothing more.
export const SPECIES = speciesJson as SpeciesData[]
export const MOVES = movesJson as MoveData[]
export const ITEMS = itemsJson as ItemData[]

export const speciesById = new Map(SPECIES.map((s) => [s.id, s]))
export const movesById = new Map(MOVES.map((m) => [m.id, m]))
export const itemsById = new Map(ITEMS.map((i) => [i.id, i]))

export function getSpecies(id: string): SpeciesData | undefined {
  return speciesById.get(id)
}
export function getMove(id: string): MoveData | undefined {
  return movesById.get(id)
}
export function getItem(id: string): ItemData | undefined {
  return itemsById.get(id)
}

export function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Rank-ordered fuzzy-ish search: exact id > name starts-with > word
 * starts-with > substring. Fast enough to run per keystroke over all entries.
 */
export function searchNamed<T extends { id: string; name: string }>(
  pool: T[],
  query: string,
  limit = 12,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const qid = toId(q)
  const scored: { item: T; rank: number }[] = []
  for (const item of pool) {
    const name = item.name.toLowerCase()
    let rank = -1
    if (item.id === qid) rank = 0
    else if (name.startsWith(q) || item.id.startsWith(qid)) rank = 1
    else if (name.split(/[\s-]/).some((w) => w.startsWith(q))) rank = 2
    else if (name.includes(q) || item.id.includes(qid)) rank = 3
    if (rank >= 0) scored.push({ item, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.item.name.length - b.item.name.length)
  return scored.slice(0, limit).map((s) => s.item)
}

// Meta usage is used as a search tiebreaker so that under time pressure
// "sinist" surfaces Sinistcha above Sinistea, "bascul" Basculegion above
// Basculin, etc.
import metaJson from './meta-sets.json'
const usageBySpecies = new Map<string, number>(
  (metaJson as { entries: { speciesId: string; usage: number }[] }).entries.map((e) => [
    e.speciesId,
    e.usage,
  ]),
)

export function searchSpecies(q: string, limit = 12): SpeciesData[] {
  const hits = searchNamed(SPECIES, q, limit * 2)
  return hits
    .map((s, i) => ({ s, i, usage: usageBySpecies.get(s.id) ?? 0 }))
    .sort((a, b) => b.usage - a.usage || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s)
}
export const searchMoves = (q: string, limit = 12) => searchNamed(MOVES, q, limit)
export const searchItems = (q: string, limit = 12) => searchNamed(ITEMS, q, limit)
