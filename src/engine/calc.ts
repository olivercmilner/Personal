import { calculate, Field, Generations, Move, Pokemon } from '@smogon/calc'
import type { DuelResult, PointSpread, SpeciesData, StatTable } from '../types'
import { getMove, toId } from '../data'
import { effectiveness } from '../data/typechart'
import { championStats } from './stats'
import { NEUTRAL_CONTEXT, type BattleContext } from './field'

const gen = Generations.get(9)

export interface Combatant {
  species: SpeciesData
  moves: string[] // move ids
  ability: string
  item: string
  nature: string
  points: PointSpread
}

export function buildField(ctx: BattleContext): Field {
  return new Field({
    gameType: 'Doubles',
    weather: ctx.weather ?? undefined,
    terrain: ctx.terrain ?? undefined,
  })
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
  // The calc dex is LENIENT with unknown species names (it returns a hollow
  // species with undefined types instead of throwing), so check for real
  // membership; species it doesn't know (Champions-exclusive Megas) become
  // a Mew stand-in with full type/stat overrides.
  const knownToCalc = !!gen.species.get(toId(c.species.name) as never)?.types
  if (knownToCalc) {
    try {
      return new Pokemon(gen, c.species.name, { ...options, overrides: { baseStats } })
    } catch {
      // e.g. an item string the calc rejects — retry without it
      return new Pokemon(gen, c.species.name, { ...options, item: undefined, overrides: { baseStats } })
    }
  }
  return new Pokemon(gen, 'Mew', {
    ...options,
    item: undefined,
    overrides: { baseStats, types: c.species.types as never },
  })
}

export function calcSpeed(c: Combatant): number {
  return championStats(c.species.baseStats, c.points, c.nature).spe
}

/** Weather-activated speed-doubling abilities. */
const SPEED_ABILITY: Record<string, BattleContext['weather']> = {
  'Swift Swim': 'Rain',
  'Chlorophyll': 'Sun',
  'Sand Rush': 'Sand',
}

/** Speed after items/abilities under the inferred conditions. */
export function effectiveSpeed(c: Combatant, ctx: BattleContext = NEUTRAL_CONTEXT): number {
  let spe = calcSpeed(c)
  if (toId(c.item) === 'choicescarf') spe = Math.floor(spe * 1.5)
  if (ctx.weather && SPEED_ABILITY[c.ability] === ctx.weather) spe *= 2
  return spe
}

/**
 * Champions-exclusive abilities no calc library knows about, applied as
 * post-multipliers on the damage result.
 */
function championsAbilityMod(aInfo: Combatant, dInfo: Combatant, moveType: string): number {
  let mod = 1
  if (aInfo.ability === 'Fire Mane' && moveType === 'Fire') mod *= 1.5
  if (dInfo.ability === 'Eelevate' && moveType === 'Ground') mod = 0
  return mod
}

/** Moves whose power scales during the game; scored at a mid-game state. */
const SCALING_MOVES: Record<string, { bp: number; note: string }> = {
  lastrespects: { bp: 150, note: 'scaled for 2 fainted allies' },
  ragefist: { bp: 150, note: 'scaled for 2 hits taken' },
}

const NO_DAMAGE: Omit<DuelResult, 'bestMove'> = { dmgPct: [0, 0], koTurns: 9 }

/**
 * Damage % range of `attacker` using move `moveId` against `defender`,
 * in doubles under `field` conditions. Returns null for status moves.
 * Falls back to a plain damage-formula estimate when the calc rejects a
 * move it doesn't know.
 */
export function moveDamagePct(
  attacker: Pokemon,
  aInfo: Combatant,
  defender: Pokemon,
  dInfo: Combatant,
  moveId: string,
  field: Field,
  bpOverride?: number,
): [number, number] | null {
  const data = getMove(moveId)
  if (!data || data.category === 'Status' || data.basePower === 0) return null
  const mod = championsAbilityMod(aInfo, dInfo, data.type)
  if (mod === 0) return [0, 0]
  try {
    const move = new Move(gen, data.name, bpOverride ? { overrides: { basePower: bpOverride } } : undefined)
    const result = calculate(gen, attacker, defender, move, field)
    const range = result.range()
    const maxHP = defender.maxHP()
    return [(range[0] / maxHP) * 100 * mod, (range[1] / maxHP) * 100 * mod]
  } catch {
    return approximateDamagePct(attacker, aInfo, defender, dInfo, moveId, mod, bpOverride)
  }
}

/** Bare gen-9 damage formula (no item/ability modifiers) as a safety net. */
function approximateDamagePct(
  attacker: Pokemon,
  aInfo: Combatant,
  defender: Pokemon,
  dInfo: Combatant,
  moveId: string,
  mod: number,
  bpOverride?: number,
): [number, number] | null {
  const data = getMove(moveId)
  if (!data || data.category === 'Status' || data.basePower === 0) return null
  const bp = bpOverride ?? data.basePower
  const atk = data.category === 'Physical' ? attacker.stats.atk : attacker.stats.spa
  const def = data.category === 'Physical' ? defender.stats.def : defender.stats.spd
  const stab = aInfo.species.types.includes(data.type) ? 1.5 : 1
  // Use OUR species data for typing — calc Pokemon types are unreliable for
  // custom species stand-ins.
  const eff = effectiveness(data.type, dInfo.species.types)
  const spread = data.target === 'allAdjacentFoes' || data.target === 'allAdjacent' ? 0.75 : 1
  const base = Math.floor(Math.floor((Math.floor((2 * 50) / 5 + 2) * bp * atk) / def) / 50) + 2
  const max = base * stab * eff * spread * mod
  const min = max * 0.85
  const maxHP = defender.maxHP()
  return [(min / maxHP) * 100, (max / maxHP) * 100]
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Best damaging move of `attacker` (a) into `defender` (d) under `field`. */
export function bestAttack(
  a: Combatant,
  aPoke: Pokemon,
  d: Combatant,
  dPoke: Pokemon,
  field: Field,
): DuelResult {
  let best: DuelResult = { bestMove: '—', ...NO_DAMAGE }
  let bestAvg = -1
  for (const moveId of a.moves) {
    const scaling = SCALING_MOVES[moveId]
    const pct = moveDamagePct(aPoke, a, dPoke, d, moveId, field, scaling?.bp)
    if (!pct) continue
    const avg = (pct[0] + pct[1]) / 2
    if (avg > bestAvg) {
      bestAvg = avg
      let scaledNote: string | undefined
      if (scaling) {
        const turn1 = moveDamagePct(aPoke, a, dPoke, d, moveId, field)
        if (turn1) scaledNote = `${scaling.note}; turn 1: ${round1(turn1[0])}–${round1(turn1[1])}%`
      }
      best = {
        bestMove: getMove(moveId)?.name ?? moveId,
        dmgPct: [round1(pct[0]), round1(pct[1])],
        koTurns: koTurns(pct),
        category: getMove(moveId)?.category as DuelResult['category'],
        scaledNote,
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
