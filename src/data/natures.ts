import type { StatName } from '../types'

/**
 * Champions "Stat Alignments": the classic natures minus the redundant
 * neutrals (Docile, Hardy, Bashful, Quirky). Serious is the only neutral.
 */
export interface Nature {
  name: string
  plus?: Exclude<StatName, 'hp'>
  minus?: Exclude<StatName, 'hp'>
}

export const NATURES: Nature[] = [
  { name: 'Serious' },
  { name: 'Adamant', plus: 'atk', minus: 'spa' },
  { name: 'Lonely', plus: 'atk', minus: 'def' },
  { name: 'Brave', plus: 'atk', minus: 'spe' },
  { name: 'Naughty', plus: 'atk', minus: 'spd' },
  { name: 'Bold', plus: 'def', minus: 'atk' },
  { name: 'Impish', plus: 'def', minus: 'spa' },
  { name: 'Lax', plus: 'def', minus: 'spd' },
  { name: 'Relaxed', plus: 'def', minus: 'spe' },
  { name: 'Modest', plus: 'spa', minus: 'atk' },
  { name: 'Mild', plus: 'spa', minus: 'def' },
  { name: 'Rash', plus: 'spa', minus: 'spd' },
  { name: 'Quiet', plus: 'spa', minus: 'spe' },
  { name: 'Calm', plus: 'spd', minus: 'atk' },
  { name: 'Gentle', plus: 'spd', minus: 'def' },
  { name: 'Careful', plus: 'spd', minus: 'spa' },
  { name: 'Sassy', plus: 'spd', minus: 'spe' },
  { name: 'Timid', plus: 'spe', minus: 'atk' },
  { name: 'Hasty', plus: 'spe', minus: 'def' },
  { name: 'Jolly', plus: 'spe', minus: 'spa' },
  { name: 'Naive', plus: 'spe', minus: 'spd' },
]

const byName = new Map(NATURES.map((n) => [n.name.toLowerCase(), n]))

export function getNature(name: string): Nature {
  return byName.get(name.toLowerCase()) ?? NATURES[0]
}

export function natureMultiplier(nature: string, stat: StatName): number {
  const n = getNature(nature)
  if (n.plus === stat) return 1.1
  if (n.minus === stat) return 0.9
  return 1
}
