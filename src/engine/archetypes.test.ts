import { describe, expect, it } from 'vitest'
import type { PokemonBuild } from '../types'
import { getSpecies } from '../data'
import { EMPTY_POINTS } from './stats'
import { predictSets, isMegaSet, isMegaBuild } from './predict'
import { matchArchetype } from './archetypes'
import { computeMatrix, type OpponentMon } from './matrix'
import { recommendBrings, WEIGHTS } from './optimize'
import { computeInsights, statDropPenalties } from './insights'

const BIG_SIX = ['charizard', 'floetteeternal', 'kingambit', 'basculegion', 'garchomp', 'whimsicott']

const mk = (speciesId: string, moves: string[], nature: string, pts: Partial<typeof EMPTY_POINTS>, ability?: string, item = ''): PokemonBuild => ({
  speciesId,
  moves,
  ability: ability ?? getSpecies(speciesId)!.abilities[0],
  item,
  nature,
  points: { ...EMPTY_POINTS, ...pts },
})

const myTeam = [
  mk('garchomp', ['earthquake', 'dragonclaw', 'rockslide', 'protect'], 'Jolly', { atk: 32, spe: 32, hp: 2 }, 'Rough Skin', 'Life Orb'),
  mk('whimsicott', ['tailwind', 'moonblast', 'encore', 'protect'], 'Timid', { spa: 32, spe: 32, hp: 2 }, 'Prankster', 'Focus Sash'),
  mk('kingambit', ['kowtowcleave', 'suckerpunch', 'ironhead', 'protect'], 'Adamant', { atk: 32, hp: 32, spd: 2 }, 'Defiant'),
  mk('incineroar', ['fakeout', 'flareblitz', 'partingshot', 'knockoff'], 'Impish', { hp: 32, def: 16, spd: 16, atk: 2 }, 'Intimidate', 'Sitrus Berry'),
  mk('heatran', ['heatwave', 'earthpower', 'flashcannon', 'protect'], 'Modest', { spa: 32, hp: 32, spd: 2 }, 'Flash Fire'),
  mk('dragonite', ['extremespeed', 'outrage', 'icespinner', 'protect'], 'Adamant', { atk: 32, spe: 32, hp: 2 }, 'Multiscale', 'Choice Band'),
]

const oppFor = (ids: string[]): OpponentMon[] => ids.map((id) => ({ speciesId: id, sets: predictSets(id) }))

describe('Big Six field-test scenario', () => {
  it('Floette-Eternal predicts the Mega Floettite set, not Life Orb', () => {
    const sets = predictSets('floetteeternal')
    expect(sets[0].item).toBe('Floettite')
    expect(sets[0].ability).toBe('Fairy Aura')
    expect(sets[0].formeId).toBe('floetteeternalmega')
    expect(isMegaSet(sets[0])).toBe(true)
  })

  it('recognizes the Big Six archetype regardless of order', () => {
    const match = matchArchetype(BIG_SIX)
    expect(match?.archetype.id).toBe('big-six')
    const shuffled = matchArchetype([...BIG_SIX].reverse())
    expect(shuffled?.archetype.id).toBe('big-six')
  })

  it('estimates Whimsicott in the bring-four and as a lead', () => {
    const opponents = oppFor(BIG_SIX)
    const matrix = computeMatrix(myTeam, opponents)
    const { oppEstimates, archetype } = recommendBrings(matrix, myTeam, opponents)
    expect(archetype?.archetype.id).toBe('big-six')
    const whims = opponents.findIndex((o) => o.speciesId === 'whimsicott')
    // Whimsicott appears in the clear majority of likely brings and leads the top estimate.
    const inBring = oppEstimates.filter((e) => e.bring.includes(whims)).length
    expect(inBring).toBeGreaterThanOrEqual(Math.ceil(oppEstimates.length / 2))
    expect(oppEstimates[0].bring).toContain(whims)
    expect(oppEstimates[0].leads).toContain(whims)
  })

  it('does not predict both Charizard and Floette (double Mega) in the top bring', () => {
    const opponents = oppFor(BIG_SIX)
    const matrix = computeMatrix(myTeam, opponents)
    const { oppEstimates } = recommendBrings(matrix, myTeam, opponents)
    const zard = opponents.findIndex((o) => o.speciesId === 'charizard')
    const floette = opponents.findIndex((o) => o.speciesId === 'floetteeternal')
    const top = oppEstimates[0]
    expect(top.bring.includes(zard) && top.bring.includes(floette)).toBe(false)
  })

  it('recommendations are invariant to opponent entry order', () => {
    const permutations = [
      BIG_SIX,
      [...BIG_SIX].reverse(),
      ['whimsicott', 'garchomp', 'charizard', 'basculegion', 'floetteeternal', 'kingambit'],
    ]
    const outcomes = permutations.map((perm) => {
      const opponents = oppFor(perm)
      const matrix = computeMatrix(myTeam, opponents)
      const { recommendations, oppEstimates } = recommendBrings(matrix, myTeam, opponents)
      const key = (idxs: number[]) => idxs.map((j) => opponents[j].speciesId).sort().join(',')
      return {
        myBring: recommendations[0].bring.map((i) => myTeam[i].speciesId).sort().join(','),
        myLeads: recommendations[0].leads.map((i) => myTeam[i].speciesId).sort().join(','),
        theirBring: key(oppEstimates[0].bring),
        theirLeads: key(oppEstimates[0].leads),
      }
    })
    expect(outcomes[1]).toEqual(outcomes[0])
    expect(outcomes[2]).toEqual(outcomes[0])
  })
})

describe('mega exclusivity', () => {
  it('detects mega builds via forme and via held stone', () => {
    expect(isMegaBuild(mk('venusaurmega', ['gigadrain'], 'Modest', { spa: 32 }))).toBe(true)
    expect(isMegaBuild(mk('charizard', ['heatwave'], 'Timid', { spa: 32 }, 'Blaze', 'Charizardite Y'))).toBe(true)
    expect(isMegaBuild(mk('delphox', ['heatwave'], 'Timid', { spa: 32 }, 'Blaze', 'Delphoxite'))).toBe(true)
    expect(isMegaBuild(mk('garchomp', ['earthquake'], 'Jolly', { atk: 32 }, 'Rough Skin', 'Life Orb'))).toBe(false)
  })

  it('penalizes my bring-fours that stack two Mega Stones', () => {
    const twoMegaTeam = [
      mk('charizard', ['heatwave', 'solarbeam', 'airslash', 'protect'], 'Timid', { spa: 32, spe: 32, hp: 2 }, 'Blaze', 'Charizardite Y'),
      mk('metagross', ['meteormash', 'zenheadbutt', 'bulletpunch', 'protect'], 'Jolly', { atk: 32, spe: 32, hp: 2 }, 'Clear Body', 'Metagrossite'),
      mk('garchomp', ['earthquake', 'dragonclaw', 'rockslide', 'protect'], 'Jolly', { atk: 32, spe: 32, hp: 2 }, 'Rough Skin', 'Life Orb'),
      mk('whimsicott', ['tailwind', 'moonblast', 'encore', 'protect'], 'Timid', { spa: 32, spe: 32, hp: 2 }, 'Prankster', 'Focus Sash'),
    ]
    const opponents = oppFor(['garchomp', 'kingambit', 'sinistcha', 'basculegion'])
    const matrix = computeMatrix(twoMegaTeam, opponents)
    const { recommendations } = recommendBrings(matrix, twoMegaTeam, opponents)
    // With only 4 team members the bring is forced — the double-Mega note must surface.
    expect(recommendations[0].reasons.join(' ')).toMatch(/Mega Stones/)
    expect(WEIGHTS.doubleMegaPenalty).toBeGreaterThan(0)
  })
})

describe('insights', () => {
  it('warns that Intimidate feeds a likely Contrary Mega Staraptor', () => {
    const opponents = oppFor(['staraptor', 'grimmsnarl', 'archaludon', 'sylveon', 'gastrodon', 'sneasler'])
    const { penalties, notes } = statDropPenalties(myTeam, opponents)
    const incin = myTeam.findIndex((b) => b.speciesId === 'incineroar')
    expect(penalties[incin]).toBeGreaterThan(0)
    expect(notes.get(incin)).toMatch(/Contrary/)

    const matrix = computeMatrix(myTeam, opponents)
    const { oppEstimates } = recommendBrings(matrix, myTeam, opponents)
    const insights = computeInsights(myTeam, opponents, oppEstimates[0].bring)
    expect(insights.some((i) => /Contrary/.test(i.text))).toBe(true)
  })

  it('flags immunity clusters against my Ground moves', () => {
    // Charizard (Flying), Staraptor (Flying), plus Levitate-style threats
    const opponents = oppFor(['charizard', 'staraptor', 'talonflame', 'pelipper', 'kingambit', 'garchomp'])
    const matrix = computeMatrix(myTeam, opponents)
    const { oppEstimates } = recommendBrings(matrix, myTeam, opponents)
    const insights = computeInsights(myTeam, opponents, oppEstimates[0].bring)
    const groundNote = insights.find((i) => /from Ground/.test(i.text))
    // Only asserts when the likely-four actually contains 2+ Flying-types;
    // with this opponent pool that is effectively guaranteed.
    expect(groundNote, JSON.stringify(insights)).toBeDefined()
  })
})
