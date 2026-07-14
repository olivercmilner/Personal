import type { PointSpread, StatName, StatTable } from '../types'
import { MAX_POINTS_PER_STAT, TOTAL_POINTS } from '../types'
import { natureMultiplier } from '../data/natures'

/**
 * Champions stat formula at Lv50, matching Pokemon Showdown's champions-mod
 * implementation (statModify in data/mods/champions/scripts.ts): points are
 * added to the baseline BEFORE the stat-alignment multiplier applies:
 *   HP    = base + 75 + points
 *   other = floor((base + 20 + points) * nature)
 */
export function championStat(
  stat: StatName,
  base: number,
  points: number,
  nature: string,
): number {
  if (stat === 'hp') {
    if (base === 1) return 1 // Shedinja
    return base + 75 + points
  }
  return Math.floor((base + 20 + points) * natureMultiplier(nature, stat))
}

export function championStats(
  baseStats: StatTable,
  points: PointSpread,
  nature: string,
): StatTable {
  const out = {} as StatTable
  for (const stat of Object.keys(baseStats) as StatName[]) {
    out[stat] = championStat(stat, baseStats[stat], points[stat] ?? 0, nature)
  }
  return out
}

export const EMPTY_POINTS: PointSpread = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }

export function totalPoints(points: PointSpread): number {
  return Object.values(points).reduce((a, b) => a + b, 0)
}

export function validateSpread(points: PointSpread): string | null {
  for (const [stat, v] of Object.entries(points)) {
    if (v < 0 || v > MAX_POINTS_PER_STAT) return `${stat.toUpperCase()}: max ${MAX_POINTS_PER_STAT} points per stat`
    if (!Number.isInteger(v)) return `${stat.toUpperCase()}: points must be whole numbers`
  }
  const total = totalPoints(points)
  if (total > TOTAL_POINTS) return `Total ${total}/${TOTAL_POINTS} points — over budget`
  return null
}
