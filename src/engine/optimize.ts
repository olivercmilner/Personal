import type {
  BringRecommendation,
  MatchupCell,
  OpponentBringEstimate,
  PokemonBuild,
} from '../types'
import { getSpecies } from '../data'
import { bringPrior, EMPTY_CALIBRATION, type CalibrationWeights } from './predict'
import type { OpponentMon } from './matrix'

/** Tunable weights for the whole optimizer — calibrate from field practice here. */
export const WEIGHTS = {
  lead: 0.45,
  coverage: 0.45,
  unansweredPenalty: 0.35,
  speedControlBonus: 0.12,
  fakeOutBonus: 0.06,
  speedThreat: -0.15, // cell score below this = "no answer"
  oppTopK: 5,
  softmaxTemp: 0.6,
}

const SPEED_CONTROL_MOVES = new Set(['tailwind', 'icywind', 'electroweb', 'trickroom', 'bleakwindstorm'])
const FAKE_OUT = 'fakeout'

function combosOf<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [head, ...rest] = arr
  return [
    ...combosOf(rest, k - 1).map((c) => [head, ...c]),
    ...combosOf(rest, k),
  ]
}

const IDX6 = [0, 1, 2, 3, 4, 5]
const BRING_COMBOS = combosOf(IDX6, 4)

/**
 * Estimate which 4 the opponent brings, scored from their perspective
 * against my full 6 plus usage/calibration priors.
 */
export function estimateOpponentBrings(
  matrix: MatchupCell[][],
  opponents: OpponentMon[],
  calib: CalibrationWeights = EMPTY_CALIBRATION,
): OpponentBringEstimate[] {
  // Their per-mon value = how well it does against my team on average.
  const monValue = IDX6.map((j) => {
    const avg = matrix.reduce((a, row) => a + row[j].score, 0) / matrix.length
    return -avg + 0.6 * bringPrior(opponents[j].speciesId, calib)
  })
  const scored = BRING_COMBOS.map((combo) => ({
    combo,
    v: combo.reduce((a, j) => a + monValue[j], 0) + roleBalance(combo, opponents),
  }))
  const maxV = Math.max(...scored.map((s) => s.v))
  const exps = scored.map((s) => Math.exp((s.v - maxV) / WEIGHTS.softmaxTemp))
  const total = exps.reduce((a, b) => a + b, 0)
  return scored
    .map((s, i) => ({
      bring: s.combo,
      leads: guessLeads(s.combo, opponents),
      probability: exps[i] / total,
    }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, WEIGHTS.oppTopK)
}

function setRoles(j: number, opponents: OpponentMon[]): string[] {
  return opponents[j].sets[0]?.roles ?? []
}
function setMoves(j: number, opponents: OpponentMon[]): string[] {
  return opponents[j].sets[0]?.moves ?? []
}

function roleBalance(combo: number[], opponents: OpponentMon[]): number {
  const roles = combo.flatMap((j) => setRoles(j, opponents))
  const moves = combo.flatMap((j) => setMoves(j, opponents))
  let bonus = 0
  if (roles.includes('speed-control') || moves.some((m) => SPEED_CONTROL_MOVES.has(m))) bonus += 0.1
  if (roles.includes('fake-out') || moves.includes(FAKE_OUT)) bonus += 0.05
  return bonus
}

function leadDesire(j: number, opponents: OpponentMon[]): number {
  const roles = setRoles(j, opponents)
  const moves = setMoves(j, opponents)
  let v = 0
  if (moves.includes(FAKE_OUT) || roles.includes('fake-out')) v += 1
  if (moves.some((m) => SPEED_CONTROL_MOVES.has(m)) || roles.includes('speed-control')) v += 0.7
  if (roles.includes('redirection')) v += 0.6
  if (roles.includes('setup')) v -= 0.3 // setup mons usually sit in the back
  return v
}

function guessLeads(bring: number[], opponents: OpponentMon[]): number[] {
  return [...bring].sort((a, b) => leadDesire(b, opponents) - leadDesire(a, opponents)).slice(0, 2)
}

function myRoleBonuses(bring: number[], myBuilds: PokemonBuild[]): { bonus: number; notes: string[] } {
  const moves = bring.flatMap((i) => myBuilds[i].moves)
  let bonus = 0
  const notes: string[] = []
  const sc = moves.find((m) => SPEED_CONTROL_MOVES.has(m))
  if (sc) {
    bonus += WEIGHTS.speedControlBonus
    notes.push(`keeps speed control (${sc === 'trickroom' ? 'Trick Room' : sc === 'tailwind' ? 'Tailwind' : 'Icy Wind-style'})`)
  }
  if (moves.includes(FAKE_OUT)) {
    bonus += WEIGHTS.fakeOutBonus
    notes.push('keeps Fake Out pressure')
  }
  return { bonus, notes }
}

const name = (id: string) => getSpecies(id)?.name ?? id

export function recommendBrings(
  matrix: MatchupCell[][],
  myBuilds: PokemonBuild[],
  opponents: OpponentMon[],
  calib: CalibrationWeights = EMPTY_CALIBRATION,
  topN = 3,
): { recommendations: BringRecommendation[]; oppEstimates: OpponentBringEstimate[] } {
  const oppEstimates = estimateOpponentBrings(matrix, opponents, calib)
  const results: BringRecommendation[] = []

  for (const bring of BRING_COMBOS) {
    const { bonus: roleBonus } = myRoleBonuses(bring, myBuilds)
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
      total += roleBonus

      results.push({
        bring,
        leads,
        back: bring.filter((i) => !leads.includes(i)),
        bench: IDX6.filter((i) => !bring.includes(i)),
        score: total,
        reasons: [], // filled for the top N below
      })
    }
  }

  results.sort((a, b) => b.score - a.score)
  const top = results.slice(0, topN)
  for (const rec of top) rec.reasons = explain(rec, matrix, myBuilds, opponents, oppEstimates, myRoleBonuses(rec.bring, myBuilds).notes)
  return { recommendations: top, oppEstimates }
}

function explain(
  rec: BringRecommendation,
  matrix: MatchupCell[][],
  myBuilds: PokemonBuild[],
  opponents: OpponentMon[],
  oppEstimates: OpponentBringEstimate[],
  roleNotes: string[],
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
  const threats = [...topEst.bring].sort((a, b) => {
    const danger = (j: number) => Math.max(...matrix.map((row) => 1 / row[j].defense.koTurns))
    return danger(b) - danger(a)
  })
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
  return reasons.slice(0, 5)
}
