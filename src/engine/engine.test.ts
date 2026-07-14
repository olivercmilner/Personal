import { describe, expect, it } from 'vitest'
import type { PokemonBuild } from '../types'
import { getSpecies } from '../data'
import { championStat, championStats, EMPTY_POINTS, validateSpread } from './stats'
import { buildCalcPokemon, buildField, bestAttack, koTurns } from './calc'
import { NEUTRAL_CONTEXT } from './field'
import { archetypeSet, predictSets } from './predict'
import { combatantFromBuild, computeMatrix, type OpponentMon } from './matrix'
import { recommendBrings } from './optimize'
import { parseBuild, exportBuild } from '../store/paste'

const garchomp = getSpecies('garchomp')!

describe('Champions stat formula', () => {
  it('adds +1 per point at Lv50 with fixed baseline', () => {
    // Garchomp base 130 Atk: neutral Lv50 baseline = 130+20 = 150
    expect(championStat('atk', 130, 0, 'Serious')).toBe(150)
    expect(championStat('atk', 130, 32, 'Serious')).toBe(182)
  })
  it('applies nature before points', () => {
    // Adamant: floor((150 + 32) * 1.1) = floor(200.2)
    expect(championStat('atk', 130, 32, 'Adamant')).toBe(200)
    expect(championStat('spa', 80, 0, 'Adamant')).toBe(90) // floor(100*0.9)
  })
  it('computes HP as base + 75 + points', () => {
    expect(championStat('hp', 108, 0, 'Serious')).toBe(183)
    expect(championStat('hp', 108, 32, 'Adamant')).toBe(215)
  })
  it('validates the 66-point budget and 32 cap', () => {
    expect(validateSpread({ hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 })).toBeNull()
    expect(validateSpread({ hp: 33, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 })).toMatch(/max 32/)
    expect(validateSpread({ hp: 32, atk: 32, def: 32, spa: 0, spd: 0, spe: 0 })).toMatch(/over budget/)
  })
})

describe('damage calc integration', () => {
  const chompBuild: PokemonBuild = {
    speciesId: 'garchomp',
    moves: ['earthquake', 'dragonclaw', 'rockslide', 'protect'],
    ability: 'Rough Skin',
    item: 'Life Orb',
    nature: 'Jolly',
    points: { ...EMPTY_POINTS, atk: 32, spe: 32, hp: 2 },
  }

  it('calc Pokemon stats match the Champions formula exactly', () => {
    const c = combatantFromBuild(chompBuild)
    const poke = buildCalcPokemon(c)
    const expected = championStats(garchomp.baseStats, chompBuild.points, 'Jolly')
    expect(poke.maxHP()).toBe(expected.hp)
    expect(poke.stats.atk).toBe(expected.atk)
    expect(poke.stats.spe).toBe(expected.spe)
  })

  it('picks the best move and reports sane doubles damage', () => {
    const atk = combatantFromBuild(chompBuild)
    const def = combatantFromBuild({
      speciesId: 'aggron',
      moves: ['heavyslam'],
      ability: 'Sturdy',
      item: '',
      nature: 'Modest',
      points: { ...EMPTY_POINTS, hp: 32, spa: 32 },
    })
    const result = bestAttack(atk, buildCalcPokemon(atk), def, buildCalcPokemon(def), buildField(NEUTRAL_CONTEXT))
    // Ground vs Rock/Steel is 4x: EQ should be the pick and OHKO territory.
    expect(result.bestMove).toBe('Earthquake')
    expect(result.dmgPct[1]).toBeGreaterThan(100)
    expect(result.koTurns).toBeLessThanOrEqual(1.5)
  })

  it('handles megas via the calc dex', () => {
    const mega = combatantFromBuild({
      speciesId: 'venusaurmega',
      moves: ['gigadrain'],
      ability: 'Thick Fat',
      item: '',
      nature: 'Modest',
      points: { ...EMPTY_POINTS, spa: 32 },
    })
    const poke = buildCalcPokemon(mega)
    expect(poke.stats.spa).toBe(Math.floor((122 + 20 + 32) * 1.1))
  })

  it('koTurns classification', () => {
    expect(koTurns([110, 130])).toBe(1)
    expect(koTurns([90, 110])).toBe(1.5)
    expect(koTurns([45, 55])).toBe(2)
    expect(koTurns([0, 0])).toBe(9)
  })
})

describe('prediction', () => {
  it('produces an archetype set for unknown species', () => {
    const set = archetypeSet(garchomp)
    expect(set.source).toBe('archetype')
    expect(set.points.atk).toBe(32) // 130 Atk > 80 SpA
    expect(set.points.spe).toBe(32) // base 102 is fast
    expect(set.moves.length).toBeGreaterThan(0)
  })
  it('predictSets falls back to archetype when no meta entry exists', () => {
    const sets = predictSets('watchog')
    expect(sets).toHaveLength(1)
    expect(sets[0].source).toBe('archetype')
  })
})

describe('matrix + optimizer end to end', () => {
  const mk = (speciesId: string, moves: string[], nature: string, pts: Partial<typeof EMPTY_POINTS>): PokemonBuild => ({
    speciesId,
    moves,
    ability: getSpecies(speciesId)!.abilities[0],
    item: '',
    nature,
    points: { ...EMPTY_POINTS, ...pts },
  })

  const myTeam = [
    mk('garchomp', ['earthquake', 'dragonclaw', 'rockslide', 'protect'], 'Jolly', { atk: 32, spe: 32, hp: 2 }),
    mk('whimsicott', ['tailwind', 'moonblast', 'encore', 'protect'], 'Timid', { spa: 32, spe: 32, hp: 2 }),
    mk('kingambit', ['kowtowcleave', 'suckerpunch', 'ironhead', 'protect'], 'Adamant', { atk: 32, hp: 32, spd: 2 }),
    mk('sneasler', ['fakeout', 'direclaw', 'closecombat', 'protect'], 'Jolly', { atk: 32, spe: 32, hp: 2 }),
    mk('archaludon', ['electroshot', 'flashcannon', 'dragonpulse', 'protect'], 'Modest', { spa: 32, hp: 32, spd: 2 }),
    mk('dragonite', ['extremespeed', 'outrage', 'icespinner', 'protect'], 'Adamant', { atk: 32, spe: 32, hp: 2 }),
  ]
  const oppSpecies = ['charizard', 'gholdengo', 'basculegion', 'sinistcha', 'staraptor', 'weavile']
  const opponents: OpponentMon[] = oppSpecies.map((id) => ({ speciesId: id, sets: predictSets(id) }))

  it('computes a full 6x6 matrix with sane cells', () => {
    const matrix = computeMatrix(myTeam, opponents)
    expect(matrix).toHaveLength(6)
    expect(matrix[0]).toHaveLength(6)
    for (const row of matrix)
      for (const cell of row) {
        expect(cell.score).toBeGreaterThanOrEqual(-1)
        expect(cell.score).toBeLessThanOrEqual(1)
      }
    // Kingambit (Dark STAB) should be strong into Sinistcha (Grass/Ghost) offensively
    const kingambitVsSinistcha = matrix[2][3]
    expect(kingambitVsSinistcha.offense.dmgPct[1]).toBeGreaterThan(50)
  })

  it('recommends 4 with 2 leads and explains itself', () => {
    const matrix = computeMatrix(myTeam, opponents)
    const { recommendations, oppEstimates } = recommendBrings(matrix, myTeam, opponents)
    expect(recommendations).toHaveLength(3)
    const top = recommendations[0]
    expect(top.bring).toHaveLength(4)
    expect(top.leads).toHaveLength(2)
    expect(top.back).toHaveLength(2)
    expect(top.bench).toHaveLength(2)
    expect(top.bring).toEqual(expect.arrayContaining(top.leads))
    expect(top.reasons.length).toBeGreaterThan(0)
    expect(oppEstimates[0].bring).toHaveLength(4)
    expect(oppEstimates.reduce((a, e) => a + e.probability, 0)).toBeLessThanOrEqual(1.01)
  })

  it('runs fast enough for the 90-second window', () => {
    const start = performance.now()
    const matrix = computeMatrix(myTeam, opponents)
    recommendBrings(matrix, myTeam, opponents)
    expect(performance.now() - start).toBeLessThan(3000)
  })
})

describe('paste import/export', () => {
  it('round-trips a Champions paste', () => {
    const text = `Garchomp @ Life Orb\nAbility: Rough Skin\nLevel: 50\nPoints: 2 HP / 32 Atk / 32 Spe\nJolly Nature\n- Earthquake\n- Dragon Claw\n- Rock Slide\n- Protect`
    const build = parseBuild(text)!
    expect(build.speciesId).toBe('garchomp')
    expect(build.item).toBe('Life Orb')
    expect(build.points).toEqual({ ...EMPTY_POINTS, hp: 2, atk: 32, spe: 32 })
    expect(build.moves).toEqual(['earthquake', 'dragonclaw', 'rockslide', 'protect'])
    const out = exportBuild(build)
    expect(parseBuild(out)).toEqual(build)
  })
  it('converts EV pastes into the 66-point budget', () => {
    const text = `Kingambit @ Black Glasses\nAbility: Defiant\nEVs: 252 HP / 252 Atk / 4 SpD\nAdamant Nature\n- Kowtow Cleave`
    const build = parseBuild(text)!
    expect(build.points.atk).toBe(32)
    expect(build.points.hp).toBe(32)
    const total = Object.values(build.points).reduce((a, b) => a + b, 0)
    expect(total).toBeLessThanOrEqual(66)
  })
})
