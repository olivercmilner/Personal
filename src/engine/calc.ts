import { calculate, Field, Generations, Move, Pokemon } from '@smogon/calc'
import type { DuelResult, PointSpread, SpeciesData, StatTable } from '../types'
import { getMove } from '../data'
import { effectiveness } from '../data/typechart'
import { championStats } from './stats'

const gen = Generations.get(9)
const DOUBLES = new Field({ gameType: 'Doubles' })

export interface Combatant {
  species: SpeciesData
  moves: string[] // move ids
  ability: string
  item: string
  nature: string
  points: PointSpread
}

/**
 * Build an @smogon/calc Pokemon whose final stats equal the Champions
 * formula output. We compute the real final stats ourselves, then feed the
 * calc overridden base stats chosen so that (31 IV / 0 EV / neutral / Lv50)
 * reproduces them exactly: at Lv50 a non-HP stat = base' + 20 and
 * HP = base' + 75.
 */
export function buildCalcPokemon(c: Combatant): Pokemon {
  const finalStats = championStats(c.species.baseStats, c.points, c.nature)
  const baseStats: StatTable = {
    hp: Math.max(1, finalStats.hp - 75),
    atk: Math.max(1, finalStats.atk - 20),
    def: Math.max(1, finalStats.def - 20),
    spa: Math.max(1, finalStats.spa - 20),
    spd: Math.max(1, finalStats.spd - 20),
    spe: Math.max(1, finalStats.spe - 20),
  }
  const options = {
    level: 50,
    nature: 'Serious',
    ability: c.ability || undefined,
    item: c.item || undefined,
  }
  try {
    return new Pokemon(gen, c.species.name, { ...options, overrides: { baseStats } })
  } catch {
    // Species unknown to the calc dex: stand in with Mew + full overrides.
    return new Pokemon(gen, 'Mew', {
      ...options,
      overrides: { baseStats, types: c.species.types as never },
    })
  }
}

export function calcSpeed(c: Combatant): number {
  return championStats(c.species.baseStats, c.points, c.nature).spe
}

const NO_DAMAGE: Omit<DuelResult, 'bestMove'> = { dmgPct: [0, 0], koTurns: 9 }

/**
 * Damage % range of `attacker` using move `moveId` against `defender`,
 * in doubles. Returns null for status moves. Falls back to a plain
 * damage-formula estimate when the calc rejects a move it doesn't know.
 */
export function moveDamagePct(
  attacker: Pokemon,
  aInfo: Combatant,
  defender: Pokemon,
  moveId: string,
): [number, number] | null {
  const data = getMove(moveId)
  if (!data || data.category === 'Status' || data.basePower === 0) return null
  try {
    const result = calculate(gen, attacker, defender, new Move(gen, data.name), DOUBLES)
    const range = result.range()
    const maxHP = defender.maxHP()
    return [(range[0] / maxHP) * 100, (range[1] / maxHP) * 100]
  } catch {
    return approximateDamagePct(attacker, aInfo, defender, moveId)
  }
}

/** Bare gen-9 damage formula (no item/ability modifiers) as a safety net. */
function approximateDamagePct(
  attacker: Pokemon,
  aInfo: Combatant,
  defender: Pokemon,
  moveId: string,
): [number, number] | null {
  const data = getMove(moveId)
  if (!data || data.category === 'Status' || data.basePower === 0) return null
  const atk = data.category === 'Physical' ? attacker.stats.atk : attacker.stats.spa
  const def = data.category === 'Physical' ? defender.stats.def : defender.stats.spd
  const stab = aInfo.species.types.includes(data.type) ? 1.5 : 1
  const eff = effectiveness(data.type, defender.types as unknown as string[])
  const spread = data.target === 'allAdjacentFoes' || data.target === 'allAdjacent' ? 0.75 : 1
  const base = Math.floor(Math.floor((Math.floor((2 * 50) / 5 + 2) * data.basePower * atk) / def) / 50) + 2
  const max = base * stab * eff * spread
  const min = max * 0.85
  const maxHP = defender.maxHP()
  return [(min / maxHP) * 100, (max / maxHP) * 100]
}

/** Best damaging move of `attacker` (a) into `defender` (d). */
export function bestAttack(a: Combatant, aPoke: Pokemon, _d: Combatant, dPoke: Pokemon): DuelResult {
  let best: DuelResult = { bestMove: '—', ...NO_DAMAGE }
  let bestAvg = -1
  for (const moveId of a.moves) {
    const pct = moveDamagePct(aPoke, a, dPoke, moveId)
    if (!pct) continue
    const avg = (pct[0] + pct[1]) / 2
    if (avg > bestAvg) {
      bestAvg = avg
      best = {
        bestMove: getMove(moveId)?.name ?? moveId,
        dmgPct: [Math.round(pct[0] * 10) / 10, Math.round(pct[1] * 10) / 10],
        koTurns: koTurns(pct),
      }
    }
  }
  return best
}

export function koTurns(pct: [number, number]): number {
  const [min, max] = pct
  if (min >= 100) return 1
  if (max >= 100) return 1.5 // possible OHKO, roll-dependent
  const avg = (min + max) / 2
  if (avg <= 1) return 9
  return Math.min(9, Math.ceil(100 / avg))
}
