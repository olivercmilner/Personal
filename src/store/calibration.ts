import type { MatchLog, MetaEntry } from '../types'
import { toId } from '../data'
import { getMetaEntry, type CalibrationWeights } from '../engine/predict'
import { useStored } from './storage'

export function useMatchLogs() {
  const [logs, setLogs] = useStored<MatchLog[]>('matchLogs', [])
  const upsert = (log: MatchLog) =>
    setLogs((prev) => [log, ...prev.filter((l) => l.id !== log.id)])
  const remove = (id: string) => setLogs((prev) => prev.filter((l) => l.id !== id))
  return { logs, upsert, remove }
}

/** User-curated additions/overrides to the bundled meta dataset. */
export function useUserMeta() {
  const [entries, setEntries] = useStored<MetaEntry[]>('userMeta', [])
  const upsert = (entry: MetaEntry) =>
    setEntries((prev) => [entry, ...prev.filter((e) => e.speciesId !== entry.speciesId)])
  const remove = (speciesId: string) =>
    setEntries((prev) => prev.filter((e) => e.speciesId !== speciesId))
  return { entries, upsert, remove }
}

/**
 * Fold the match history into prediction weights:
 * - bring/lead frequency per opposing species
 * - confirmed-set counts, matched by revealed item/moves against the
 *   species' known sets (best-scoring set gets the credit)
 */
export function deriveCalibration(logs: MatchLog[], userEntries?: MetaEntry[]): CalibrationWeights {
  const calib: CalibrationWeights = { setSeen: {}, brought: {} }
  for (const log of logs) {
    if (log.theirBring) {
      for (const speciesId of log.opponent) {
        const b = (calib.brought[speciesId] ??= { games: 0, brought: 0, led: 0 })
        b.games++
        if (log.theirBring.includes(speciesId)) b.brought++
        if (log.theirLeads?.includes(speciesId)) b.led++
      }
    }
    if (log.revealed) {
      for (const [speciesId, info] of Object.entries(log.revealed)) {
        const entry = getMetaEntry(speciesId, userEntries)
        if (!entry?.sets.length) continue
        let best: { name: string; score: number } | null = null
        for (const set of entry.sets) {
          let score = 0
          if (info.item && toId(set.item) === toId(info.item)) score += 2
          if (info.ability && toId(set.ability) === toId(info.ability)) score += 1
          for (const mv of info.moves ?? []) if (set.moves.includes(toId(mv))) score += 1
          if (score > 0 && (!best || score > best.score)) best = { name: set.name, score }
        }
        if (best) {
          const seen = (calib.setSeen[speciesId] ??= {})
          seen[best.name] = (seen[best.name] ?? 0) + 1
        }
      }
    }
  }
  return calib
}
