import type { MetaEntry, MetaSet, PokemonBuild, PredictedSet, SpeciesData, StatName } from '../types'
import { getSpecies, SPECIES, toId } from '../data'
import metaJson from '../data/meta-sets.json'
import { EMPTY_POINTS } from './stats'

/** Every Mega Stone in Champions, derived from the Mega formes' requiredItem. */
export const MEGA_STONE_IDS: Set<string> = new Set(
  SPECIES.filter((s) => s.requiredItem).map((s) => toId(s.requiredItem!)),
)

/** Does this predicted/curated set Mega Evolve? (stone, Mega forme, or role tag) */
export function isMegaSet(set: Pick<MetaSet, 'item' | 'formeId' | 'roles'>): boolean {
  if (set.formeId && getSpecies(set.formeId)?.forme?.includes('Mega')) return true
  if (set.roles?.includes('mega')) return true
  return MEGA_STONE_IDS.has(toId(set.item ?? ''))
}

/** Does this user build Mega Evolve? (Mega forme species or held stone) */
export function isMegaBuild(build: PokemonBuild): boolean {
  if (getSpecies(build.speciesId)?.forme?.includes('Mega')) return true
  return MEGA_STONE_IDS.has(toId(build.item ?? ''))
}

/** Mega Stone item id -> the Mega forme species id it produces. */
export const STONE_TO_MEGA: Map<string, string> = new Map(
  SPECIES.filter((s) => s.requiredItem).map((s) => [toId(s.requiredItem!), s.id]),
)

/**
 * The Mega forme a build transforms into in battle: base species holding
 * its matching stone. Null when not applicable (wrong stone, already Mega).
 */
export function megaTargetForBuild(build: Pick<PokemonBuild, 'speciesId' | 'item'>): SpeciesData | null {
  const megaId = STONE_TO_MEGA.get(toId(build.item ?? ''))
  if (!megaId || megaId === build.speciesId) return null
  const mega = getSpecies(megaId)
  const base = getSpecies(build.speciesId)
  if (!mega || !base || toId(mega.baseSpecies ?? '') !== base.id) return null
  return mega
}

export interface MetaFile {
  regulation: string
  updated: string
  entries: MetaEntry[]
}

export const BUNDLED_META = metaJson as unknown as MetaFile

/** Calibration signal accumulated from the user's logged matches. */
export interface CalibrationWeights {
  /** speciesId -> set name -> times this set was confirmed in a real game */
  setSeen: Record<string, Record<string, number>>
  /** speciesId -> bring/lead frequency across games where it was on the opposing side */
  brought: Record<string, { games: number; brought: number; led: number }>
}

export const EMPTY_CALIBRATION: CalibrationWeights = { setSeen: {}, brought: {} }

const metaBySpecies = new Map(BUNDLED_META.entries.map((e) => [e.speciesId, e]))

export function getMetaEntry(
  speciesId: string,
  userEntries?: MetaEntry[],
): MetaEntry | undefined {
  const user = userEntries?.find((e) => e.speciesId === speciesId)
  return user ?? metaBySpecies.get(speciesId)
}

/**
 * Weighted candidate sets for an opponent species. Meta sets are boosted by
 * calibration counts (each confirmed sighting counts like doubling the
 * set's base weight); unknown species get a stat-inferred archetype set so
 * the engine always has something concrete to calculate against.
 */
export function predictSets(
  speciesId: string,
  calib: CalibrationWeights = EMPTY_CALIBRATION,
  userEntries?: MetaEntry[],
): PredictedSet[] {
  const entry = getMetaEntry(speciesId, userEntries)
  const species = getSpecies(speciesId)
  if (!species) return []

  if (entry && entry.sets.length > 0) {
    const seen = calib.setSeen[speciesId] ?? {}
    const weighted = entry.sets.map((s) => ({
      set: s,
      w: s.weight * (1 + (seen[s.name] ?? 0)),
    }))
    const total = weighted.reduce((a, b) => a + b.w, 0)
    return weighted
      .map(({ set, w }) => ({
        ...set,
        probability: w / total,
        source: 'meta' as const,
      }))
      .sort((a, b) => b.probability - a.probability || a.name.localeCompare(b.name))
  }

  return [archetypeSet(species)]
}

/** Representative ~STAB moves per type used for unknown-set estimation. */
const TYPE_MOVES: Record<string, { phys: string; spec: string }> = {
  Normal: { phys: 'Body Slam', spec: 'Hyper Voice' },
  Fire: { phys: 'Flare Blitz', spec: 'Heat Wave' },
  Water: { phys: 'Waterfall', spec: 'Hydro Pump' },
  Electric: { phys: 'Wild Charge', spec: 'Thunderbolt' },
  Grass: { phys: 'Power Whip', spec: 'Energy Ball' },
  Ice: { phys: 'Icicle Crash', spec: 'Ice Beam' },
  Fighting: { phys: 'Close Combat', spec: 'Focus Blast' },
  Poison: { phys: 'Poison Jab', spec: 'Sludge Bomb' },
  Ground: { phys: 'Earthquake', spec: 'Earth Power' },
  Flying: { phys: 'Brave Bird', spec: 'Hurricane' },
  Psychic: { phys: 'Zen Headbutt', spec: 'Psychic' },
  Bug: { phys: 'X-Scissor', spec: 'Bug Buzz' },
  Rock: { phys: 'Rock Slide', spec: 'Power Gem' },
  Ghost: { phys: 'Phantom Force', spec: 'Shadow Ball' },
  Dragon: { phys: 'Dragon Claw', spec: 'Draco Meteor' },
  Dark: { phys: 'Knock Off', spec: 'Dark Pulse' },
  Steel: { phys: 'Iron Head', spec: 'Flash Cannon' },
  Fairy: { phys: 'Play Rough', spec: 'Moonblast' },
}

/**
 * Fallback set inferred from base stats: assume max investment in the
 * better attacking stat, speed if naturally fast otherwise HP, and STAB
 * coverage — a reasonable worst-case stand-in for damage estimation.
 */
export function archetypeSet(species: SpeciesData): PredictedSet {
  const { baseStats, types } = species
  const physical = baseStats.atk >= baseStats.spa
  const fast = baseStats.spe >= 85
  const attackStat: StatName = physical ? 'atk' : 'spa'

  const points = { ...EMPTY_POINTS }
  points[attackStat] = 32
  if (fast) {
    points.spe = 32
    points.hp = 2
  } else {
    points.hp = 32
    points.def = 1
    points.spd = 1
  }

  const moves = types
    .map((t) => TYPE_MOVES[t]?.[physical ? 'phys' : 'spec'])
    .filter(Boolean)
    .map(toId)

  return {
    name: 'Estimated (no data)',
    moves,
    ability: species.abilities[0] ?? '',
    item: '',
    nature: fast
      ? physical ? 'Jolly' : 'Timid'
      : physical ? 'Adamant' : 'Modest',
    points,
    weight: 1,
    roles: [physical ? 'physical-attacker' : 'special-attacker'],
    probability: 1,
    source: 'archetype',
  }
}

/**
 * Champions enforces item clause: no two team members can hold the same
 * item. Predicted top sets are chosen greedily (most confident first) so
 * that no item repeats across the opponent's six — a mon whose preferred
 * item is already claimed is re-predicted on its next-best set, inheriting
 * the displaced set's probability so the display stays ordered.
 */
export function applyItemClause<T extends { speciesId: string; sets: PredictedSet[] }>(
  opponents: T[],
): T[] {
  const claimed = new Set<string>()
  const resolved = new Map<string, PredictedSet[]>()
  const order = [...opponents].sort(
    (a, b) =>
      (b.sets[0]?.probability ?? 0) - (a.sets[0]?.probability ?? 0) ||
      a.speciesId.localeCompare(b.speciesId),
  )
  for (const o of order) {
    const sets = [...o.sets]
    const freeIdx = sets.findIndex((s) => !s.item || !claimed.has(toId(s.item)))
    if (freeIdx > 0) {
      const [promoted] = sets.splice(freeIdx, 1)
      // The clause genuinely shifts likelihood mass onto the promoted set.
      const displaced = sets[0]
      sets.unshift({ ...promoted, probability: displaced.probability })
      sets[1] = { ...displaced, probability: promoted.probability }
    } else if (freeIdx === -1 && sets.length > 0) {
      sets[0] = { ...sets[0], item: '', name: `${sets[0].name} (item claimed by teammate)` }
    }
    const top = sets[0]
    if (top?.item) claimed.add(toId(top.item))
    resolved.set(o.speciesId, sets)
  }
  return opponents.map((o) => ({ ...o, sets: resolved.get(o.speciesId) ?? o.sets }))
}

/** Prior probability that this species is brought to a given game. */
export function bringPrior(speciesId: string, calib: CalibrationWeights): number {
  const b = calib.brought[speciesId]
  const observed = b && b.games >= 2 ? b.brought / b.games : undefined
  const meta = metaBySpecies.get(speciesId)
  // Default: everything on a team of 6 has a 2/3 chance of being in the 4.
  const base = 4 / 6
  const usageNudge = meta ? Math.min(0.1, meta.usage * 0.2) : 0
  return observed !== undefined ? 0.5 * observed + 0.5 * (base + usageNudge) : base + usageNudge
}
