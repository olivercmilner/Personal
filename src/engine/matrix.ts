import type { MatchupCell, OpponentMon, PokemonBuild, PredictedSet } from '../types'
import { getMove, getSpecies, toId } from '../data'
import { megaTargetForBuild } from './predict'
import { NEUTRAL_CONTEXT, TRICK_ROOM_SPEED_DISCOUNT, type BattleContext } from './field'
import { buildCalcPokemon, buildField, bestAttack, effectiveSpeed, type Combatant } from './calc'

export type { OpponentMon } from '../types'

export function combatantFromBuild(build: PokemonBuild): Combatant {
  const species = getSpecies(build.speciesId)
  if (!species) throw new Error(`Unknown species: ${build.speciesId}`)
  // A base species holding its matching Mega Stone fights as the Mega.
  const mega = megaTargetForBuild(build)
  if (mega) {
    return {
      species: mega,
      moves: build.moves,
      ability: mega.abilities[0] ?? build.ability,
      item: build.item,
      nature: build.nature,
      points: build.points,
    }
  }
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
  // Mega/transform sets point battle math at the transformed forme.
  const species = getSpecies(set.formeId ?? speciesId) ?? getSpecies(speciesId)
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

function hasSash(c: Combatant): boolean {
  return toId(c.item) === 'focussash' || c.ability === 'Sturdy'
}

function bestMovePriority(c: Combatant, bestMoveName: string): boolean {
  const move = c.moves.map(getMove).find((m) => m?.name === bestMoveName)
  return (move?.priority ?? 0) > 0
}

function scoreCell(
  offKo: number,
  defKo: number,
  speed: MatchupCell['speed'],
  ctx: BattleContext,
  flags: NonNullable<MatchupCell['flags']>,
): number {
  const off = 1 / offKo
  const def = 1 / defKo
  let raw = off - def
  // Priority softens speed: being slower matters less when my kill move is
  // priority; being faster is worth less into their priority.
  let speedBonus = 0
  if (speed === 'faster') speedBonus = 0.12 * off * (flags.theirPriority ? 0.5 : 1)
  else if (speed === 'slower') speedBonus = -0.12 * def * (flags.myPriority ? 0.5 : 1)
  // Likely Trick Room halves how much speed is worth at all.
  if (ctx.trickRoomLikely) speedBonus *= TRICK_ROOM_SPEED_DISCOUNT
  raw += speedBonus
  return Math.max(-1, Math.min(1, raw))
}

/**
 * 6x6 matchup matrix: my team (rows) vs opponent species (columns), each
 * cell aggregated over the opponent's predicted sets weighted by
 * probability, computed under the inferred battle conditions.
 */
export function computeMatrix(
  myBuilds: PokemonBuild[],
  opponents: OpponentMon[],
  ctx: BattleContext = NEUTRAL_CONTEXT,
): MatchupCell[][] {
  const field = buildField(ctx)
  const mine = myBuilds.map((b) => {
    const c = combatantFromBuild(b)
    return { c, poke: buildCalcPokemon(c), spe: effectiveSpeed(c, ctx) }
  })
  const theirs = opponents.map((o) =>
    o.sets.map((set) => {
      const c = combatantFromSet(o.speciesId, set)
      return { c, poke: buildCalcPokemon(c), spe: effectiveSpeed(c, ctx), p: set.probability }
    }),
  )

  return mine.map((me, i) =>
    theirs.map((oppSets, j) => {
      let offMin = 0, offMax = 0, offKo = 0, defMin = 0, defMax = 0, defKo = 0
      let offense: MatchupCell['offense'] | null = null
      let defense: MatchupCell['defense'] | null = null
      let topP = -1
      let speed: MatchupCell['speed'] = 'tie'
      const flags: NonNullable<MatchupCell['flags']> = {}
      for (const os of oppSets) {
        const off = bestAttack(me.c, me.poke, os.c, os.poke, field)
        const def = bestAttack(os.c, os.poke, me.c, me.poke, field)
        // Sash/Sturdy holders survive an OHKO at 1 HP: floor their KO at 2.
        let offTurns = off.koTurns
        if (offTurns <= 1.5 && hasSash(os.c)) {
          offTurns = 2
          if (os.p >= 0.25) flags.sash = true
        }
        offMin += off.dmgPct[0] * os.p
        offMax += off.dmgPct[1] * os.p
        offKo += offTurns * os.p
        defMin += def.dmgPct[0] * os.p
        defMax += def.dmgPct[1] * os.p
        defKo += def.koTurns * os.p
        if (os.p > topP) {
          topP = os.p
          offense = off
          defense = def
          speed = me.spe > os.spe ? 'faster' : me.spe < os.spe ? 'slower' : 'tie'
          flags.myPriority = bestMovePriority(me.c, off.bestMove)
          flags.theirPriority = bestMovePriority(os.c, def.bestMove)
        }
      }
      const round1 = (n: number) => Math.round(n * 10) / 10
      return {
        mine: myBuilds[i].speciesId,
        theirs: opponents[j].speciesId,
        offense: {
          ...offense!,
          dmgPct: [round1(offMin), round1(offMax)] as [number, number],
          koTurns: round1(offKo),
        },
        defense: {
          ...defense!,
          dmgPct: [round1(defMin), round1(defMax)] as [number, number],
          koTurns: round1(defKo),
        },
        speed,
        score: scoreCell(offKo, defKo, speed, ctx, flags),
        flags,
      }
    }),
  )
}
