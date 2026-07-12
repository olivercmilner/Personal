import type { PokemonBuild, PredictedSet } from '../types'
import { getMove, getSpecies } from '../data'
import { effectiveness } from '../data/typechart'
import type { OpponentMon } from './matrix'

export interface Insight {
  severity: 'warn' | 'info'
  text: string
}

/** Abilities that grant outright immunity to an attack type. */
const ABILITY_IMMUNITY: Record<string, string> = {
  'Levitate': 'Ground',
  'Eelevate': 'Ground',
  'Earth Eater': 'Ground',
  'Lightning Rod': 'Electric',
  'Volt Absorb': 'Electric',
  'Motor Drive': 'Electric',
  'Storm Drain': 'Water',
  'Water Absorb': 'Water',
  'Dry Skin': 'Water',
  'Flash Fire': 'Fire',
  'Sap Sipper': 'Grass',
  'Well-Baked Body': 'Fire',
}

/** Moves that lower opposing stats — free boosts into Contrary/Defiant/Competitive. */
const STAT_DROP_MOVES = new Set([
  'icywind', 'snarl', 'faketears', 'charm', 'partingshot', 'breakingswipe',
  'lunge', 'strugglebug', 'mudshot', 'electroweb', 'scaryface', 'tickle',
])
const DROP_PUNISH_ABILITIES: Record<string, { gain: string; penalty: number }> = {
  Contrary: { gain: 'RAISES its stats instead', penalty: 0.07 },
  Defiant: { gain: 'gives it +2 Attack', penalty: 0.05 },
  Competitive: { gain: 'gives it +2 Sp. Atk', penalty: 0.05 },
}
const FAKE_OUT_BLOCK_ABILITIES = new Set(['Armor Tail', 'Psychic Surge', 'Queenly Majesty', 'Dazzling'])

const name = (id: string) => getSpecies(id)?.name ?? id

/** Candidate sets worth warning about: the top set plus any set ≥ 25% likely. */
function likelySets(o: OpponentMon): PredictedSet[] {
  return o.sets.filter((s, i) => i === 0 || s.probability >= 0.25)
}

function battleSpecies(o: OpponentMon, set: PredictedSet) {
  return getSpecies(set.formeId ?? o.speciesId) ?? getSpecies(o.speciesId)!
}

function isImmune(attackType: string, o: OpponentMon, set: PredictedSet): boolean {
  const sp = battleSpecies(o, set)
  if (effectiveness(attackType, sp.types) === 0) return true
  return ABILITY_IMMUNITY[set.ability] === attackType
}

/**
 * Per-my-Pokemon penalties for bringing stat-droppers (Intimidate, Icy Wind,
 * Parting Shot…) into Contrary/Defiant/Competitive opponents — used by the
 * optimizer, with a matching human-readable note per offender.
 */
export function statDropPenalties(
  myBuilds: PokemonBuild[],
  opponents: OpponentMon[],
): { penalties: number[]; notes: Map<number, string> } {
  const punishers: { oppName: string; ability: string; gain: string; penalty: number }[] = []
  for (const o of opponents) {
    for (const set of likelySets(o)) {
      const punish = DROP_PUNISH_ABILITIES[set.ability]
      if (punish) {
        punishers.push({
          oppName: battleSpecies(o, set).name,
          ability: set.ability,
          gain: punish.gain,
          penalty: punish.penalty * set.probability,
        })
      }
    }
  }

  const penalties = myBuilds.map(() => 0)
  const notes = new Map<number, string>()
  if (!punishers.length) return { penalties, notes }
  // Strongest punisher drives the warning text.
  const worst = [...punishers].sort((a, b) => b.penalty - a.penalty || a.oppName.localeCompare(b.oppName))[0]

  myBuilds.forEach((build, i) => {
    const dropsViaAbility = build.ability === 'Intimidate'
    const dropMoves = build.moves.filter((m) => STAT_DROP_MOVES.has(m))
    if (!dropsViaAbility && dropMoves.length === 0) return
    penalties[i] = punishers.reduce((a, p) => a + p.penalty, 0)
    const source = dropsViaAbility
      ? 'Intimidate'
      : getMove(dropMoves[0])?.name ?? dropMoves[0]
    notes.set(
      i,
      `Careful: ${name(build.speciesId)}'s ${source} into ${worst.oppName} (${worst.ability}) ${worst.gain}.`,
    )
  })
  return { penalties, notes }
}

/**
 * Human-readable interaction notes for the current matchup: immunity
 * clusters against my attack types, stat-drop punishes, Fake Out blockers,
 * and free switch-ins I can exploit.
 */
export function computeInsights(
  myBuilds: PokemonBuild[],
  opponents: OpponentMon[],
  theirLikelyBring: number[],
): Insight[] {
  const insights: Insight[] = []
  const likely = theirLikelyBring.map((j) => opponents[j])

  // 1. Immunity clusters: my damaging move types that much of their four ignores.
  const myAttackTypes = new Map<string, string[]>() // type -> my species using it
  for (const build of myBuilds) {
    for (const m of build.moves) {
      const move = getMove(m)
      if (move && move.category !== 'Status' && move.basePower > 0) {
        const users = myAttackTypes.get(move.type) ?? []
        if (!users.includes(name(build.speciesId))) users.push(name(build.speciesId))
        myAttackTypes.set(move.type, users)
      }
    }
  }
  for (const [type, users] of [...myAttackTypes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const immune = likely.filter((o) => likelySets(o).some((s) => isImmune(type, o, s)))
    if (immune.length >= 2) {
      insights.push({
        severity: 'warn',
        text: `${immune.length} of their likely four can take nothing from ${type} (${immune.map((o) => name(o.speciesId)).join(', ')}) — ${users.join('/')}'s ${type} moves lose a lot of value.`,
      })
    }
  }

  // 2. Stat-drop punishes (Contrary / Defiant / Competitive).
  const seen = new Set<string>()
  for (const o of likely) {
    for (const set of likelySets(o)) {
      const punish = DROP_PUNISH_ABILITIES[set.ability]
      if (!punish || seen.has(o.speciesId)) continue
      seen.add(o.speciesId)
      const droppers = myBuilds
        .filter((b) => b.ability === 'Intimidate' || b.moves.some((m) => STAT_DROP_MOVES.has(m)))
        .map((b) => name(b.speciesId))
      if (droppers.length) {
        insights.push({
          severity: 'warn',
          text: `${battleSpecies(o, set).name} likely has ${set.ability}: stat drops from ${droppers.join(', ')} ${punish.gain}.`,
        })
      }
    }
  }

  // 3. Fake Out blockers.
  const myFakeOutUsers = myBuilds.filter((b) => b.moves.includes('fakeout')).map((b) => name(b.speciesId))
  if (myFakeOutUsers.length) {
    for (const o of likely) {
      const blocker = likelySets(o).find((s) => FAKE_OUT_BLOCK_ABILITIES.has(s.ability))
      if (blocker) {
        insights.push({
          severity: 'info',
          text: `${battleSpecies(o, blocker).name}'s ${blocker.ability} blocks ${myFakeOutUsers.join('/')}'s Fake Out.`,
        })
      }
    }
  }

  // 4. Free pivots for me: their attack types my team is immune to via ability.
  for (const build of myBuilds) {
    const immunityType = ABILITY_IMMUNITY[build.ability]
    if (!immunityType) continue
    const feeders = likely.filter((o) =>
      likelySets(o).some((s) => s.moves.some((m) => getMove(m)?.type === immunityType && getMove(m)!.category !== 'Status')),
    )
    if (feeders.length >= 2) {
      insights.push({
        severity: 'info',
        text: `${name(build.speciesId)}'s ${build.ability} absorbs the ${immunityType} attacks of ${feeders.map((o) => name(o.speciesId)).join(', ')}.`,
      })
    }
  }

  return insights.slice(0, 6)
}
