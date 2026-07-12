import type {
  BringRecommendation,
  MatchupCell,
  OpponentBringEstimate,
  PokemonBuild,
} from '../types'
import { getSpecies } from '../data'
import { bringPrior, EMPTY_CALIBRATION, isMegaBuild, isMegaSet, type CalibrationWeights } from './predict'
import { matchArchetype, type ArchetypeMatch } from './archetypes'
import { statDropPenalties } from './insights'
import type { OpponentMon } from './matrix'

/** Tunable weights for the whole optimizer — calibrate from field practice here. */
export const WEIGHTS = {
  lead: 0.45,
  coverage: 0.45,
  unansweredPenalty: 0.35,
  speedThreat: -0.15, // cell score below this = "no answer"
  oppTopK: 5,
  softmaxTemp: 0.6,
  /** each Mega Stone beyond the first in a bring-4 costs this much */
  doubleMegaPenalty: 0.3,
  /** scale for archetype bring-rate priors in the opponent estimate */
  archetypeBring: 1.1,
  /** scale for archetype lead-rate priors in lead guessing */
  archetypeLead: 1.6,
  /** scale for support-role value in the opponent bring estimate */
  oppSupportScale: 0.5,
  /** scale for support-role value in my own bring scoring */
  mySupportScale: 0.16,
}

/** Value of utility roles beyond raw damage — why Whimsicott always comes. */
const SUPPORT_ROLE_VALUE: Record<string, number> = {
  'speed-control': 0.5,
  redirection: 0.35,
  'fake-out': 0.3,
  screens: 0.3,
  disruption: 0.2,
  support: 0.2,
}

const SPEED_CONTROL_MOVES = new Set(['tailwind', 'icywind', 'electroweb', 'trickroom', 'bleakwindstorm'])
const SCREEN_MOVES = new Set(['lightscreen', 'reflect', 'auroraveil'])
const REDIRECT_MOVES = new Set(['followme', 'ragepowder'])
const DISRUPT_MOVES = new Set(['encore', 'taunt', 'faketears', 'charm', 'helpinghand', 'spore', 'thunderwave', 'willowisp'])
const FAKE_OUT = 'fakeout'

/**
 * Which support categories a moveset/roleset provides. Categories are
 * deduplicated so stacking two Tailwind users doesn't double-count.
 */
function supportCategories(moves: string[], roles: string[] = []): Set<string> {
  const cats = new Set<string>()
  for (const role of roles) if (role in SUPPORT_ROLE_VALUE) cats.add(role)
  if (moves.some((m) => SPEED_CONTROL_MOVES.has(m))) cats.add('speed-control')
  if (moves.some((m) => SCREEN_MOVES.has(m))) cats.add('screens')
  if (moves.some((m) => REDIRECT_MOVES.has(m))) cats.add('redirection')
  if (moves.includes(FAKE_OUT)) cats.add('fake-out')
  if (moves.some((m) => DISRUPT_MOVES.has(m))) cats.add('disruption')
  return cats
}

function supportValue(moves: string[], roles: string[] = []): number {
  let v = 0
  for (const cat of supportCategories(moves, roles)) v += SUPPORT_ROLE_VALUE[cat]
  return v
}

function combosOf<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [head, ...rest] = arr
  return [
    ...combosOf(rest, k - 1).map((c) => [head, ...c]),
    ...combosOf(rest, k),
  ]
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/** Stable key for an index set, independent of entry order. */
const comboKey = (combo: number[], ids: string[]) =>
  combo.map((i) => ids[i]).sort().join('|')

function setOf(j: number, opponents: OpponentMon[]) {
  return opponents[j].sets[0]
}

function oppMegaCount(combo: number[], opponents: OpponentMon[]): number {
  return combo.filter((j) => setOf(j, opponents) && isMegaSet(setOf(j, opponents))).length
}

/**
 * Estimate which 4 the opponent brings: matchup value vs my six + usage and
 * calibration priors + support-role value + recognized-archetype bring
 * rates, with a penalty for stacking multiple Mega Stones. Fully
 * deterministic in the face of ties (species-id keyed), so opponent entry
 * order never changes the result.
 */
export function estimateOpponentBrings(
  matrix: MatchupCell[][],
  opponents: OpponentMon[],
  calib: CalibrationWeights = EMPTY_CALIBRATION,
  arch: ArchetypeMatch | null = null,
): OpponentBringEstimate[] {
  const ids = opponents.map((o) => o.speciesId)
  // Canonical enumeration order: species id, never entry order.
  const oppIdx = range(opponents.length).sort((a, b) => ids[a].localeCompare(ids[b]))

  const monValue = new Map<number, number>()
  for (const j of oppIdx) {
    const avg = matrix.reduce((a, row) => a + row[j].score, 0) / matrix.length
    const top = setOf(j, opponents)
    const support = top ? WEIGHTS.oppSupportScale * supportValue(top.moves, top.roles) : 0
    const archBoost = arch
      ? WEIGHTS.archetypeBring * arch.confidence * ((arch.archetype.bringRates[ids[j]] ?? 4 / 6) - 4 / 6)
      : 0
    monValue.set(j, -avg + 0.6 * bringPrior(ids[j], calib) + support + archBoost)
  }

  const scored = combosOf(oppIdx, Math.min(4, opponents.length)).map((combo) => ({
    combo,
    v:
      combo.reduce((a, j) => a + monValue.get(j)!, 0) +
      roleBalance(combo, opponents) -
      WEIGHTS.doubleMegaPenalty * Math.max(0, oppMegaCount(combo, opponents) - 1),
  }))
  const maxV = Math.max(...scored.map((s) => s.v))
  const exps = scored.map((s) => Math.exp((s.v - maxV) / WEIGHTS.softmaxTemp))
  const total = exps.reduce((a, b) => a + b, 0)
  return scored
    .map((s, i) => ({
      bring: s.combo,
      leads: guessLeads(s.combo, opponents, arch),
      probability: exps[i] / total,
    }))
    .sort(
      (a, b) =>
        b.probability - a.probability || comboKey(a.bring, ids).localeCompare(comboKey(b.bring, ids)),
    )
    .slice(0, WEIGHTS.oppTopK)
}

function roleBalance(combo: number[], opponents: OpponentMon[]): number {
  const cats = new Set<string>()
  for (const j of combo) {
    const top = setOf(j, opponents)
    if (top) for (const c of supportCategories(top.moves, top.roles)) cats.add(c)
  }
  let bonus = 0
  if (cats.has('speed-control')) bonus += 0.1
  if (cats.has('fake-out')) bonus += 0.05
  return bonus
}

function leadDesire(j: number, opponents: OpponentMon[], arch: ArchetypeMatch | null): number {
  const top = setOf(j, opponents)
  const roles = top?.roles ?? []
  const moves = top?.moves ?? []
  let v = 0
  if (moves.includes(FAKE_OUT) || roles.includes('fake-out')) v += 1
  if (moves.some((m) => SPEED_CONTROL_MOVES.has(m)) || roles.includes('speed-control')) v += 0.7
  if (roles.includes('redirection')) v += 0.6
  if (roles.includes('screens')) v += 0.6
  if (roles.includes('setup')) v -= 0.3 // setup mons usually sit in the back
  if (arch) v += WEIGHTS.archetypeLead * arch.confidence * (arch.archetype.leadRates[opponents[j].speciesId] ?? 0)
  return v
}

function guessLeads(bring: number[], opponents: OpponentMon[], arch: ArchetypeMatch | null): number[] {
  return [...bring]
    .sort(
      (a, b) =>
        leadDesire(b, opponents, arch) - leadDesire(a, opponents, arch) ||
        opponents[a].speciesId.localeCompare(opponents[b].speciesId),
    )
    .slice(0, 2)
}

function mySupportBonus(bring: number[], myBuilds: PokemonBuild[]): { bonus: number; notes: string[] } {
  const cats = new Set<string>()
  for (const i of bring) for (const c of supportCategories(myBuilds[i].moves)) cats.add(c)
  let bonus = 0
  const notes: string[] = []
  for (const cat of cats) bonus += WEIGHTS.mySupportScale * SUPPORT_ROLE_VALUE[cat]
  if (cats.has('speed-control')) notes.push('keeps speed control')
  if (cats.has('fake-out')) notes.push('keeps Fake Out pressure')
  if (cats.has('redirection')) notes.push('keeps redirection support')
  return { bonus, notes }
}

const name = (id: string) => getSpecies(id)?.name ?? id

export interface RecommendResult {
  recommendations: BringRecommendation[]
  oppEstimates: OpponentBringEstimate[]
  archetype: ArchetypeMatch | null
}

export function recommendBrings(
  matrix: MatchupCell[][],
  myBuilds: PokemonBuild[],
  opponents: OpponentMon[],
  calib: CalibrationWeights = EMPTY_CALIBRATION,
  topN = 3,
): RecommendResult {
  const archetype = matchArchetype(opponents.map((o) => o.speciesId))
  const oppEstimates = estimateOpponentBrings(matrix, opponents, calib, archetype)
  const { penalties: dropPenalties, notes: dropNotes } = statDropPenalties(myBuilds, opponents)
  const myIds = myBuilds.map((b) => b.speciesId)
  const results: BringRecommendation[] = []
  const myIdx = range(myBuilds.length)

  for (const bring of combosOf(myIdx, Math.min(4, myBuilds.length))) {
    const { bonus: supportBonus } = mySupportBonus(bring, myBuilds)
    const megaCount = bring.filter((i) => isMegaBuild(myBuilds[i])).length
    const megaPenalty = WEIGHTS.doubleMegaPenalty * Math.max(0, megaCount - 1)
    const statDropPenalty = bring.reduce((a, i) => a + dropPenalties[i], 0)

    for (const leads of combosOf(bring, 2)) {
      let total = 0
      for (const est of oppEstimates) {
        // Lead matchup: my leads vs their likely leads.
        let lead = 0
        for (const i of leads) for (const j of est.leads) lead += matrix[i][j].score
        lead /= leads.length * est.leads.length

        // Coverage: my best answer to each of their brought mons.
        let coverage = 0
        let unanswered = 0
        for (const j of est.bring) {
          const best = Math.max(...bring.map((i) => matrix[i][j].score))
          coverage += best
          if (best < WEIGHTS.speedThreat) unanswered++
        }
        coverage /= est.bring.length

        total +=
          est.probability *
          (WEIGHTS.lead * lead +
            WEIGHTS.coverage * coverage -
            WEIGHTS.unansweredPenalty * unanswered)
      }
      total += supportBonus - megaPenalty - statDropPenalty

      results.push({
        bring,
        leads,
        back: bring.filter((i) => !leads.includes(i)),
        bench: myIdx.filter((i) => !bring.includes(i)),
        score: total,
        reasons: [], // filled for the top N below
      })
    }
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      comboKey(a.bring, myIds).localeCompare(comboKey(b.bring, myIds)) ||
      comboKey(a.leads, myIds).localeCompare(comboKey(b.leads, myIds)),
  )
  const top = results.slice(0, topN)
  for (const rec of top) {
    const megaCount = rec.bring.filter((i) => isMegaBuild(myBuilds[i])).length
    rec.reasons = explain(
      rec, matrix, myBuilds, opponents, oppEstimates,
      mySupportBonus(rec.bring, myBuilds).notes, megaCount,
      rec.bring.map((i) => dropNotes.get(i)).filter((n): n is string => !!n),
    )
  }
  return { recommendations: top, oppEstimates, archetype }
}

function explain(
  rec: BringRecommendation,
  matrix: MatchupCell[][],
  myBuilds: PokemonBuild[],
  opponents: OpponentMon[],
  oppEstimates: OpponentBringEstimate[],
  roleNotes: string[],
  megaCount: number,
  dropNotes: string[],
): string[] {
  const reasons: string[] = []
  const topEst = oppEstimates[0]

  // Why these leads: strongest lead-vs-likely-lead interaction.
  let bestLeadCell: MatchupCell | null = null
  for (const i of rec.leads)
    for (const j of topEst.leads) {
      const cell = matrix[i][j]
      if (!bestLeadCell || cell.score > bestLeadCell.score) bestLeadCell = cell
    }
  if (bestLeadCell && bestLeadCell.score > 0) {
    reasons.push(
      `Lead ${name(bestLeadCell.mine)}: threatens their likely ${name(bestLeadCell.theirs)} lead with ${bestLeadCell.offense.bestMove} (${bestLeadCell.offense.dmgPct[0]}–${bestLeadCell.offense.dmgPct[1]}%${bestLeadCell.offense.koTurns <= 1.5 ? ', OHKO range' : ''})${bestLeadCell.speed === 'faster' ? ' and outspeeds it' : ''}.`,
    )
  }

  // Coverage highlights: my best answer to their two scariest mons.
  const danger = (j: number) => Math.max(...matrix.map((row) => 1 / row[j].defense.koTurns))
  const threats = [...topEst.bring].sort(
    (a, b) => danger(b) - danger(a) || opponents[a].speciesId.localeCompare(opponents[b].speciesId),
  )
  for (const j of threats.slice(0, 2)) {
    let bestI = rec.bring[0]
    for (const i of rec.bring) if (matrix[i][j].score > matrix[bestI][j].score) bestI = i
    const cell = matrix[bestI][j]
    if (cell.score > 0.05) {
      reasons.push(
        `${name(cell.mine)} answers ${name(cell.theirs)}: ${cell.offense.bestMove} does ${cell.offense.dmgPct[0]}–${cell.offense.dmgPct[1]}%${cell.speed === 'faster' ? ' while faster' : ''}.`,
      )
    } else {
      reasons.push(
        `Watch ${name(opponents[j].speciesId)} — nothing in this four beats it cleanly (best: ${name(cell.mine)}, ${cell.offense.bestMove} ${cell.offense.dmgPct[0]}–${cell.offense.dmgPct[1]}%).`,
      )
    }
  }

  if (megaCount > 1) {
    reasons.push(
      `Note: this four carries ${megaCount} Mega Stones but only one Pokemon can Mega Evolve per battle.`,
    )
  }
  for (const n of dropNotes) reasons.push(n)

  // Why the bench sits.
  for (const i of rec.bench) {
    const worst = topEst.bring.reduce(
      (w, j) => (matrix[i][j].score < w.score ? matrix[i][j] : w),
      matrix[i][topEst.bring[0]],
    )
    if (worst.score < -0.15) {
      reasons.push(
        `Bench ${name(myBuilds[i].speciesId)}: their ${name(worst.theirs)} pressures it with ${worst.defense.bestMove} (${worst.defense.dmgPct[0]}–${worst.defense.dmgPct[1]}%).`,
      )
    }
  }

  for (const note of roleNotes) reasons.push(`This four ${note}.`)
  return reasons.slice(0, 6)
}
