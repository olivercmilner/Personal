import archetypesJson from '../data/team-archetypes.json'

export interface TeamArchetype {
  id: string
  name: string
  /** Known member pool (may exceed 6 — covers common variants) */
  members: string[]
  /** Species that must all be present for a core-based match */
  core: string[]
  /** speciesId -> probability it is in the bring-4 when this team appears */
  bringRates: Record<string, number>
  /** speciesId -> probability it is one of the two leads */
  leadRates: Record<string, number>
  notes: string[]
}

export const ARCHETYPES = (archetypesJson as unknown as { archetypes: TeamArchetype[] }).archetypes

export interface ArchetypeMatch {
  archetype: TeamArchetype
  /** 0..1 — fraction of the opponent's six accounted for by the archetype */
  confidence: number
  overlap: number
}

/**
 * Recognize a known ladder team from the opponent's six. A match requires
 * either 5+ of their six in the member pool, or the full core plus 4+
 * overlap. Highest overlap wins; core matches outrank core-less ones at
 * equal overlap. Result is independent of entry order.
 */
export function matchArchetype(opponentIds: string[]): ArchetypeMatch | null {
  const candidates = ARCHETYPES.flatMap((arch) => {
    const memberSet = new Set(arch.members)
    const overlap = opponentIds.filter((id) => memberSet.has(id)).length
    const coreHit = arch.core.every((id) => opponentIds.includes(id))
    if (overlap < 5 && !(coreHit && overlap >= 4)) return []
    return [{ archetype: arch, confidence: overlap / 6, overlap, coreHit }]
  })
  // Deterministic ranking: overlap, then core match, then id (never entry order).
  candidates.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      Number(b.coreHit) - Number(a.coreHit) ||
      a.archetype.id.localeCompare(b.archetype.id),
  )
  const best = candidates[0]
  return best ? { archetype: best.archetype, confidence: best.confidence, overlap: best.overlap } : null
}
