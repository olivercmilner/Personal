import { describe, expect, it } from 'vitest'
import type { PokemonBuild } from '../types'
import { getSpecies } from '../data'
import { EMPTY_POINTS } from './stats'
import { predictSets, megaTargetForBuild, STONE_TO_MEGA } from './predict'
import { inferContext, NEUTRAL_CONTEXT } from './field'
import { buildCalcPokemon, buildField, bestAttack, effectiveSpeed } from './calc'
import { combatantFromBuild, computeMatrix, type OpponentMon } from './matrix'

const mk = (speciesId: string, moves: string[], nature: string, pts: Partial<typeof EMPTY_POINTS>, ability?: string, item = ''): PokemonBuild => ({
  speciesId,
  moves,
  ability: ability ?? getSpecies(speciesId)!.abilities[0],
  item,
  nature,
  points: { ...EMPTY_POINTS, ...pts },
})

const oppFor = (ids: string[]): OpponentMon[] => ids.map((id) => ({ speciesId: id, sets: predictSets(id) }))

describe('battle context inference', () => {
  it('detects rain, trick room and screens from opponent sets', () => {
    const ctx = inferContext([], oppFor(['pelipper', 'swampert', 'sinistcha', 'grimmsnarl', 'basculegion', 'raichu']))
    expect(ctx.weather).toBe('Rain')
    expect(ctx.trickRoomLikely).toBe(true)
    expect(ctx.screensLikely).toBe(true)
  })
  it('detects sun from Charizard-Y mega set and my own abilities', () => {
    const ctx = inferContext([], oppFor(['charizard', 'venusaur', 'garchomp', 'torkoal']))
    expect(ctx.weather).toBe('Sun')
    const mine = inferContext([mk('pelipper', ['hurricane'], 'Modest', { spa: 32 }, 'Drizzle')], [])
    expect(mine.weather).toBe('Rain')
  })
})

describe('weather and speed mechanics', () => {
  const bascul = mk('basculegion', ['wavecrash', 'lastrespects', 'aquajet', 'protect'], 'Adamant', { atk: 32, spe: 32, hp: 2 }, 'Adaptability', 'Choice Scarf')
  const chomp = mk('garchomp', ['earthquake', 'dragonclaw', 'rockslide', 'protect'], 'Jolly', { atk: 32, spe: 32, hp: 2 }, 'Rough Skin')

  it('rain boosts Water damage', () => {
    // Wave Crash only, so the best move can't switch to scaled Last Respects
    const a = combatantFromBuild({ ...bascul, moves: ['wavecrash'] })
    const d = combatantFromBuild(chomp)
    const neutral = bestAttack(a, buildCalcPokemon(a), d, buildCalcPokemon(d), buildField(NEUTRAL_CONTEXT))
    const rain = bestAttack(a, buildCalcPokemon(a), d, buildCalcPokemon(d), buildField({ ...NEUTRAL_CONTEXT, weather: 'Rain' }))
    expect(rain.dmgPct[1]).toBeGreaterThan(neutral.dmgPct[1] * 1.3)
  })

  it('Choice Scarf and Swift Swim affect effective speed', () => {
    const scarfed = combatantFromBuild(bascul)
    const base = combatantFromBuild({ ...bascul, item: '' })
    expect(effectiveSpeed(scarfed)).toBe(Math.floor(effectiveSpeed(base) * 1.5))
    const swampert = combatantFromBuild(mk('swampert', ['waterfall'], 'Adamant', { atk: 32, spe: 32 }, 'Swift Swim'))
    expect(effectiveSpeed(swampert, { ...NEUTRAL_CONTEXT, weather: 'Rain' })).toBe(effectiveSpeed(swampert) * 2)
  })

  it('Last Respects is scored at mid-game scaling with a note', () => {
    const a = combatantFromBuild({ ...bascul, moves: ['lastrespects'] })
    const d = combatantFromBuild(chomp)
    const result = bestAttack(a, buildCalcPokemon(a), d, buildCalcPokemon(d), buildField(NEUTRAL_CONTEXT))
    expect(result.scaledNote).toMatch(/2 fainted allies/)
    expect(result.dmgPct[1]).toBeGreaterThan(50) // 150 BP Adaptability
  })
})

describe('Champions ability shims', () => {
  it('Eelevate grants Ground immunity', () => {
    const chomp = combatantFromBuild(mk('garchomp', ['earthquake'], 'Jolly', { atk: 32 }, 'Rough Skin'))
    const eel = combatantFromBuild(mk('eelektrossmega', ['thunderbolt'], 'Modest', { spa: 32 }, 'Eelevate'))
    const result = bestAttack(chomp, buildCalcPokemon(chomp), eel, buildCalcPokemon(eel), buildField(NEUTRAL_CONTEXT))
    expect(result.dmgPct[1]).toBe(0)
  })
  it('Fire Mane boosts Fire moves 1.5x', () => {
    const pyroar = mk('pyroarmega', ['heatwave'], 'Timid', { spa: 32 }, 'Fire Mane')
    const plain = mk('pyroarmega', ['heatwave'], 'Timid', { spa: 32 }, 'Unnerve')
    const d = combatantFromBuild(mk('garchomp', ['earthquake'], 'Jolly', { atk: 32 }))
    const dPoke = buildCalcPokemon(d)
    const a1 = combatantFromBuild(pyroar)
    const a2 = combatantFromBuild(plain)
    const boosted = bestAttack(a1, buildCalcPokemon(a1), d, dPoke, buildField(NEUTRAL_CONTEXT))
    const normal = bestAttack(a2, buildCalcPokemon(a2), d, dPoke, buildField(NEUTRAL_CONTEXT))
    expect(boosted.dmgPct[1] / normal.dmgPct[1]).toBeCloseTo(1.5, 1)
  })
})

describe('auto-Mega and sash mechanics', () => {
  it('maps stones to Mega formes for classic and custom stones', () => {
    expect(STONE_TO_MEGA.get('charizarditey')).toBe('charizardmegay')
    expect(STONE_TO_MEGA.get('delphoxite')).toBe('delphoxmega')
    expect(STONE_TO_MEGA.get('staraptite')).toBe('staraptormega')
  })

  it('a base species holding its stone battles as the Mega', () => {
    const zard = mk('charizard', ['heatwave', 'solarbeam', 'airslash', 'protect'], 'Timid', { spa: 32, spe: 32, hp: 2 }, 'Blaze', 'Charizardite Y')
    expect(megaTargetForBuild(zard)?.id).toBe('charizardmegay')
    const c = combatantFromBuild(zard)
    expect(c.species.id).toBe('charizardmegay')
    expect(c.ability).toBe('Drought')
    // Wrong stone does nothing
    expect(megaTargetForBuild(mk('garchomp', [], 'Jolly', {}, 'Rough Skin', 'Charizardite Y'))).toBeNull()
  })

  it('flags sash survival: no guaranteed-1 KO vs likely Focus Sash holder', () => {
    const team = [
      mk('heatran', ['heatwave', 'flashcannon', 'earthpower', 'protect'], 'Modest', { spa: 32, hp: 32, spd: 2 }, 'Flash Fire'),
      mk('garchomp', ['earthquake', 'dragonclaw', 'rockslide', 'protect'], 'Jolly', { atk: 32, spe: 32, hp: 2 }),
      mk('kingambit', ['kowtowcleave', 'suckerpunch', 'ironhead', 'protect'], 'Adamant', { atk: 32, hp: 32 }),
      mk('dragonite', ['extremespeed', 'icespinner', 'firepunch', 'protect'], 'Adamant', { atk: 32, spe: 32 }),
    ]
    // Whimsicott's top set is Focus Sash
    const opponents = oppFor(['whimsicott', 'garchomp', 'kingambit', 'basculegion'])
    const matrix = computeMatrix(team, opponents, NEUTRAL_CONTEXT)
    const whimsCol = opponents.findIndex((o) => o.speciesId === 'whimsicott')
    const heatranRow = 0
    const cell = matrix[heatranRow][whimsCol]
    // Heat Wave/Flash Cannon massively overkills Whimsicott, but the sash
    // set (~83% likely) floors its KO at 2 — the aggregate is the
    // probability-weighted mix, well above a clean OHKO's 1.0.
    expect(cell.offense.dmgPct[0]).toBeGreaterThan(100)
    expect(cell.flags?.sash).toBe(true)
    expect(cell.offense.koTurns).toBeGreaterThanOrEqual(1.7)
  })
})
