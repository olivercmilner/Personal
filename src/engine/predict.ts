import type { MetaEntry, PredictedSet, SpeciesData, StatName } from '../types'
import { getSpecies, toId } from '../data'
import metaJson from '../data/meta-sets.json'
import { EMPTY_POINTS } from './stats'

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
      .sort((a, b) => b.probability - a.probability)
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
