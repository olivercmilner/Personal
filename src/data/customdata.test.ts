import { describe, expect, it } from 'vitest'
import { CUSTOM_ITEMS, ITEMS, getSpecies, itemsById, searchItems, SPECIES } from './index'
import customSpecies from './custom-species.json'

describe('custom Champions data integrity', () => {
  it('every custom Mega Stone maps to a real Mega forme', () => {
    for (const item of CUSTOM_ITEMS) {
      expect(item.megaFor, item.name).toBeDefined()
      const mega = getSpecies(item.megaFor!)
      expect(mega, `${item.name} -> ${item.megaFor}`).toBeDefined()
      expect(mega!.forme).toMatch(/Mega/)
    }
  })

  it('every custom Mega forme has a stone', () => {
    const stoneTargets = new Set(CUSTOM_ITEMS.map((i) => i.megaFor))
    for (const s of customSpecies as { id: string; name: string }[]) {
      expect(stoneTargets.has(s.id), `no stone for ${s.name}`).toBe(true)
    }
  })

  it('custom ids do not collide with generated data', () => {
    const ids = ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    const speciesIds = SPECIES.map((s) => s.id)
    expect(new Set(speciesIds).size).toBe(speciesIds.length)
  })

  it('Delphoxite is findable in the item search', () => {
    expect(itemsById.get('delphoxite')?.name).toBe('Delphoxite')
    expect(searchItems('delph').map((i) => i.name)).toContain('Delphoxite')
  })

  it('custom Megas have valid base stats and a base-species sprite fallback', () => {
    for (const s of customSpecies as (typeof SPECIES)[number][]) {
      for (const v of Object.values(s.baseStats)) {
        expect(v).toBeGreaterThan(0)
        expect(v).toBeLessThanOrEqual(216)
      }
      expect(s.baseSpecies, s.name).toBeDefined()
    }
  })
})
