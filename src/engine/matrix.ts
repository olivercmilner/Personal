import type { MatchupCell, PokemonBuild, PredictedSet } from '../types'
import { getSpecies } from '../data'
import { buildCalcPokemon, bestAttack, calcSpeed, type Combatant } from './calc'

export interface OpponentMon {
  speciesId: string
  sets: PredictedSet[]
}

export function combatantFromBuild(build: PokemonBuild): Combatant {
  const species = getSpecies(build.speciesId)
  if (!species) throw new Error(`Unknown species: ${build.speciesId}`)
  return {
    species,
    moves: build.moves,
    ability: build.ability,
    item: build.item,
    nature: build.nature,
    points: build.points,
  }
}

export function combatantFromSet(speciesId: string, set: PredictedSet): Combatant {
  const species = getSpecies(speciesId)
  if (!species) throw new Error(`Unknown species: ${speciesId}`)
  return {
    species,
    moves: set.moves,
    ability: set.ability,
    item: set.item,
    nature: set.nature,
    points: set.points,
  }
}

function scoreCell(offKo: number, defKo: number, speed: MatchupCell['speed']): number {
  const off = 1 / offKo
  const def = 1 / defKo
  let raw = off - def
  if (speed === 'faster') raw += 0.12 * off
  else if (speed === 'slower') raw -= 0.12 * def
  return Math.max(-1, Math.min(1, raw))
}

/**
 * 6x6 matchup matrix: my team (rows) vs opponent species (columns), each
 * cell aggregated over the opponent's predicted sets weighted by
 * probability. This is the single computation everything downstream reads.
 */
export function computeMatrix(
  myBuilds: PokemonBuild[],
  opponents: OpponentMon[],
): MatchupCell[][] {
  const mine = myBuilds.map((b) => {
    const c = combatantFromBuild(b)
    return { c, poke: buildCalcPokemon(c), spe: calcSpeed(c) }
  })
  const theirs = opponents.map((o) =>
    o.sets.map((set) => {
      const c = combatantFromSet(o.speciesId, set)
      return { c, poke: buildCalcPokemon(c), spe: calcSpeed(c), p: set.probability }
    }),
  )

  return mine.map((me, i) =>
    theirs.map((oppSets, j) => {
      let offMin = 0, offMax = 0, offKo = 0, defMin = 0, defMax = 0, defKo = 0
      let bestMoveOff = '—', bestMoveDef = '—', topP = -1
      let speed: MatchupCell['speed'] = 'tie'
      for (const os of oppSets) {
        const off = bestAttack(me.c, me.poke, os.c, os.poke)
        const def = bestAttack(os.c, os.poke, me.c, me.poke)
        offMin += off.dmgPct[0] * os.p
        offMax += off.dmgPct[1] * os.p
        offKo += off.koTurns * os.p
        defMin += def.dmgPct[0] * os.p
        defMax += def.dmgPct[1] * os.p
        defKo += def.koTurns * os.p
        if (os.p > topP) {
          topP = os.p
          bestMoveOff = off.bestMove
          bestMoveDef = def.bestMove
          speed = me.spe > os.spe ? 'faster' : me.spe < os.spe ? 'slower' : 'tie'
        }
      }
      const round1 = (n: number) => Math.round(n * 10) / 10
      return {
        mine: myBuilds[i].speciesId,
        theirs: opponents[j].speciesId,
        offense: {
          bestMove: bestMoveOff,
          dmgPct: [round1(offMin), round1(offMax)] as [number, number],
          koTurns: round1(offKo),
        },
        defense: {
          bestMove: bestMoveDef,
          dmgPct: [round1(defMin), round1(defMax)] as [number, number],
          koTurns: round1(defKo),
        },
        speed,
        score: scoreCell(offKo, defKo, speed),
      }
    }),
  )
}
