import { describe, expect, it } from 'vitest'
import { getMove, getSpecies, itemsById, toId } from './index'
import { getNature, NATURES } from './natures'
import { validateSpread } from '../engine/stats'
import { EMPTY_POINTS } from '../engine/stats'
import { BUNDLED_META } from '../engine/predict'
import { ARCHETYPES } from '../engine/archetypes'

describe('bundled meta dataset integrity', () => {
  it('has entries', () => {
    expect(BUNDLED_META.entries.length).toBeGreaterThanOrEqual(40)
  })

  for (const entry of BUNDLED_META.entries) {
    describe(entry.speciesId, () => {
      it('species exists', () => {
        expect(getSpecies(entry.speciesId), entry.speciesId).toBeDefined()
      })
      it('sets are valid', () => {
        expect(entry.sets.length).toBeGreaterThan(0)
        for (const set of entry.sets) {
          if (set.formeId) expect(getSpecies(set.formeId), set.formeId).toBeDefined()
          for (const m of set.moves) expect(getMove(m), `${entry.speciesId} move ${m}`).toBeDefined()
          expect(itemsById.get(toId(set.item)), `${entry.speciesId} item ${set.item}`).toBeDefined()
          expect(
            NATURES.some((n) => n.name === set.nature),
            `${entry.speciesId} nature ${set.nature}`,
          ).toBe(true)
          expect(getNature(set.nature).name).toBe(set.nature)
          const spread = { ...EMPTY_POINTS, ...set.points }
          expect(validateSpread(spread), `${entry.speciesId} ${set.name} spread`).toBeNull()
          // Ability must be legal for the species used in battle math
          const battleSpecies = getSpecies(set.formeId ?? entry.speciesId)!
          const baseSpecies = getSpecies(entry.speciesId)!
          const legalAbilities = new Set([...battleSpecies.abilities, ...baseSpecies.abilities])
          expect(
            legalAbilities.has(set.ability),
            `${entry.speciesId} ${set.name} ability ${set.ability} not in [${[...legalAbilities]}]`,
          ).toBe(true)
        }
      })
      it('teammates resolve', () => {
        for (const t of entry.teammates ?? []) expect(getSpecies(t), `teammate ${t}`).toBeDefined()
      })
    })
  }
})

describe('team archetypes match the exact Champions roster', () => {
  it('every archetype member, core and rate key is a roster species', () => {
    for (const a of ARCHETYPES) {
      const ids = [...a.members, ...a.core, ...Object.keys(a.bringRates), ...Object.keys(a.leadRates)]
      for (const id of ids) expect(getSpecies(id), `${a.id}: ${id}`).toBeDefined()
    }
  })
})
