import type { OpponentMon, PokemonBuild } from '../types'
import { getSpecies } from '../data'

/**
 * Inferred battle conditions for a matchup: weather/terrain from either
 * side's abilities, plus whether the opponent likely runs Trick Room or
 * screens. Feeds the damage calcs, speed comparisons, and insights.
 */
export interface BattleContext {
  weather: 'Rain' | 'Sun' | 'Sand' | null
  terrain: 'Grassy' | 'Electric' | 'Psychic' | 'Misty' | null
  trickRoomLikely: boolean
  screensLikely: boolean
}

export const NEUTRAL_CONTEXT: BattleContext = {
  weather: null,
  terrain: null,
  trickRoomLikely: false,
  screensLikely: false,
}

/** How much of the speed-derived score survives when Trick Room is likely. */
export const TRICK_ROOM_SPEED_DISCOUNT = 0.5

const WEATHER_ABILITY: Record<string, BattleContext['weather']> = {
  'Drizzle': 'Rain',
  'Drought': 'Sun',
  'Orichalcum Pulse': 'Sun',
  'Sand Stream': 'Sand',
}
const TERRAIN_ABILITY: Record<string, BattleContext['terrain']> = {
  'Grassy Surge': 'Grassy',
  'Electric Surge': 'Electric',
  'Psychic Surge': 'Psychic',
  'Misty Surge': 'Misty',
}
const SCREEN_MOVES = new Set(['lightscreen', 'reflect', 'auroraveil'])

/** A set is "likely" enough to shape conditions at ≥30% probability. */
const LIKELY = 0.3

export function inferContext(myBuilds: PokemonBuild[], opponents: OpponentMon[]): BattleContext {
  let weather: BattleContext['weather'] = null
  let terrain: BattleContext['terrain'] = null
  let trickRoomLikely = false
  let screensLikely = false

  // Opponent conditions take precedence — we are modeling their threat.
  for (const o of opponents) {
    for (const set of o.sets) {
      if (set.probability < LIKELY && o.sets.indexOf(set) > 0) continue
      weather = weather ?? WEATHER_ABILITY[set.ability] ?? null
      terrain = terrain ?? TERRAIN_ABILITY[set.ability] ?? null
      if (set.moves.includes('trickroom')) trickRoomLikely = true
      if (set.moves.some((m) => SCREEN_MOVES.has(m)) || set.roles.includes('screens'))
        screensLikely = true
    }
  }
  for (const b of myBuilds) {
    const ability = b.ability || getSpecies(b.speciesId)?.abilities[0] || ''
    weather = weather ?? WEATHER_ABILITY[ability] ?? null
    terrain = terrain ?? TERRAIN_ABILITY[ability] ?? null
  }
  return { weather, terrain, trickRoomLikely, screensLikely }
}
