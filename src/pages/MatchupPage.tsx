import { useMemo, useState } from 'react'
import type { MatchupCell, PredictedSet } from '../types'
import { getSpecies, searchSpecies } from '../data'
import { getMove } from '../data'
import { useTeams } from '../store/teams'
import { useMatchLogs, useUserMeta, deriveCalibration } from '../store/calibration'
import { useStored } from '../store/storage'
import { getMetaEntry, predictSets } from '../engine/predict'
import { computeMatrix, type OpponentMon } from '../engine/matrix'
import { recommendBrings } from '../engine/optimize'
import { computeInsights } from '../engine/insights'
import type { ArchetypeMatch } from '../engine/archetypes'
import { Combobox, Modal, Sprite, SpeciesRow, TypeBadge } from '../components/shared'

export interface LastMatchup {
  teamId: string
  opponent: string[]
  myBring?: string[]
}

/**
 * Cell background keyed to KO certainty, not just the aggregate score:
 * guaranteed OHKO against you = vivid red; your guaranteed OHKO slides from
 * green toward blue with overkill; mutual OHKO is decided by speed.
 */
function cellColor(cell: MatchupCell): string {
  const theirOhko = cell.defense.dmgPct[0] >= 100
  const myOhko = cell.offense.dmgPct[0] >= 100
  const overkillBlue = () => {
    const hue = 150 + Math.min((cell.offense.dmgPct[0] - 100) / 60, 1) * 55
    return `hsl(${hue} 75% 34%)`
  }
  if (myOhko && theirOhko) {
    if (cell.speed === 'faster') return overkillBlue()
    if (cell.speed === 'slower') return 'hsl(0 85% 45%)'
    return 'hsl(40 90% 40%)' // speed tie coin flip
  }
  if (theirOhko) return 'hsl(0 85% 45%)'
  if (myOhko) return overkillBlue()
  const hue = 8 + ((cell.score + 1) / 2) * 140
  const sat = 40 + Math.abs(cell.score) * 55
  return `hsl(${hue} ${sat}% ${22 + Math.abs(cell.score) * 10}%)`
}

export function MatchupPage({ teamId, onTeamChange }: { teamId: string | null; onTeamChange: (id: string | null) => void }) {
  const { teams } = useTeams()
  const { logs } = useMatchLogs()
  const { entries: userMeta } = useUserMeta()
  const [opponent, setOpponent] = useState<string[]>([])
  const [inspecting, setInspecting] = useState<string | null>(null)
  const [, setLastMatchup] = useStored<LastMatchup | null>('lastMatchup', null)

  const team = teams.find((t) => t.id === teamId) ?? teams[0] ?? null
  const calib = useMemo(() => deriveCalibration(logs, userMeta), [logs, userMeta])

  const opponents: OpponentMon[] = useMemo(
    () =>
      opponent
        .map((id) => ({ speciesId: id, sets: predictSets(id, calib, userMeta) }))
        // Canonical order (usage, then id): entry order carries no signal
        // about the opponent's intentions and must not affect the analysis.
        .sort((a, b) => {
          const usage = (id: string) => getMetaEntry(id, userMeta)?.usage ?? 0
          return usage(b.speciesId) - usage(a.speciesId) || a.speciesId.localeCompare(b.speciesId)
        }),
    [opponent, calib, userMeta],
  )

  const analysis = useMemo(() => {
    if (!team || team.pokemon.length < 4 || opponents.length < 4) return null
    try {
      const matrix = computeMatrix(team.pokemon, opponents)
      const { recommendations, oppEstimates, archetype } = recommendBrings(matrix, team.pokemon, opponents, calib)
      const insights = computeInsights(team.pokemon, opponents, oppEstimates[0]?.bring ?? [])
      return { matrix, recommendations, oppEstimates, archetype, insights }
    } catch (err) {
      console.error(err)
      return null
    }
  }, [team, opponents, calib])

  if (!team)
    return (
      <div className="panel p-10 text-center text-ink-300">
        Create a team first — the matchup screen needs your prepared six.
      </div>
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Matchup</h1>
        <select
          className="input !w-auto"
          value={team.id}
          onChange={(e) => onTeamChange(e.target.value)}
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {team.pokemon.map((p, i) => {
            const s = getSpecies(p.speciesId)
            return s ? <Sprite key={i} species={s} size={34} /> : null
          })}
        </div>
        <div className="flex-1" />
        {opponent.length > 0 && (
          <button className="btn" onClick={() => setOpponent([])}>
            Clear opponent
          </button>
        )}
      </div>

      {/* Opponent entry — the speed-critical input */}
      <div className="panel p-4">
        <div className="mb-2 flex items-center justify-between text-sm text-ink-300">
          <span>
            Opponent's six — type and hit <kbd className="rounded bg-ink-700 px-1">Enter</kbd>, repeat
          </span>
          <span className={opponent.length === 6 ? 'font-semibold text-good-500' : ''}>
            {opponent.length}/6
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {opponent.map((id, i) => {
            const s = getSpecies(id)
            if (!s) return null
            return (
              <button
                key={i}
                className="group flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-850 py-1 pl-1 pr-3 transition hover:border-bad-500"
                onClick={() => setOpponent(opponent.filter((_, j) => j !== i))}
                title="Click to remove"
              >
                <Sprite species={s} size={36} />
                <span className="text-sm">{s.name}</span>
                <span className="text-ink-500 group-hover:text-bad-500">×</span>
              </button>
            )
          })}
          {opponent.length < 6 && (
            <div className="w-64">
              <Combobox
                value=""
                placeholder={opponent.length === 0 ? 'Their first Pokemon…' : 'Next…'}
                autoFocus
                search={(q) => searchSpecies(q).filter((s) => !opponent.includes(s.id))}
                onSelect={(s) => setOpponent([...opponent, s.id])}
                renderItem={(s) => <SpeciesRow species={s} />}
              />
            </div>
          )}
        </div>

        {/* Predicted sets strip */}
        {opponents.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {opponents.map((o) => {
              const s = getSpecies(o.speciesId)!
              const top = o.sets[0]
              return (
                <button
                  key={o.speciesId}
                  className="flex items-start gap-2 rounded-xl border border-ink-700/60 bg-ink-850/60 p-2 text-left transition hover:border-accent-500"
                  onClick={() => setInspecting(o.speciesId)}
                >
                  <Sprite species={s} size={40} />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="flex items-center gap-1 font-semibold text-sm">
                      {s.name}
                      {top.source === 'archetype' && (
                        <span className="rounded bg-ink-700 px-1 text-[9px] text-ink-300">est.</span>
                      )}
                    </div>
                    <div className="truncate text-ink-300">
                      {top.item || 'item?'} · {top.ability}
                    </div>
                    <div className="truncate text-ink-500">
                      {top.moves.map((m) => getMove(m)?.name ?? m).join(' / ')}
                    </div>
                  </div>
                  <span className="text-[10px] text-accent-400">{Math.round(top.probability * 100)}%</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {opponent.length >= 4 && !analysis && (
        <div className="panel p-4 text-sm text-bad-500">
          Analysis unavailable — check that your team has at least 4 valid Pokemon.
        </div>
      )}

      {analysis && (
        <Analysis
          analysis={analysis}
          team={team}
          opponents={opponents}
          onLog={(myBring) => setLastMatchup({ teamId: team.id, opponent, myBring })}
        />
      )}

      {inspecting && (
        <SetInspector
          speciesId={inspecting}
          sets={opponents.find((o) => o.speciesId === inspecting)?.sets ?? []}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  )
}

function Analysis({
  analysis,
  team,
  opponents,
  onLog,
}: {
  analysis: {
    matrix: MatchupCell[][]
    recommendations: ReturnType<typeof recommendBrings>['recommendations']
    oppEstimates: ReturnType<typeof recommendBrings>['oppEstimates']
    archetype: ArchetypeMatch | null
    insights: ReturnType<typeof computeInsights>
  }
  team: { pokemon: { speciesId: string }[] }
  opponents: OpponentMon[]
  onLog: (myBring: string[]) => void
}) {
  const [picked, setPicked] = useState(0)
  const { matrix, recommendations, oppEstimates, archetype, insights } = analysis
  const rec = recommendations[picked] ?? recommendations[0]
  const mySpecies = (i: number) => getSpecies(team.pokemon[i].speciesId)!
  const topOpp = oppEstimates[0]

  return (
    <>
      {archetype && (
        <div className="panel border-accent-500/40 bg-accent-500/5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-accent-500/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-accent-400">
              Recognized team
            </span>
            <span className="font-semibold">{archetype.archetype.name}</span>
            <span className="text-xs text-ink-500">
              {archetype.overlap}/6 match — bring/lead predictions use this team's known patterns
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-ink-300">
            {archetype.archetype.notes.slice(0, 4).map((n) => (
              <li key={n} className="flex gap-2">
                <span className="text-accent-400">▸</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {insights.length > 0 && (
        <div className="panel p-4">
          <h2 className="mb-2 font-semibold">Watch-outs</h2>
          <ul className="space-y-1.5 text-sm">
            {insights.map((ins) => (
              <li key={ins.text} className="flex gap-2">
                <span>{ins.severity === 'warn' ? '⚠️' : 'ℹ️'}</span>
                <span className={ins.severity === 'warn' ? 'text-amber-200/90' : 'text-ink-300'}>
                  {ins.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recommendation card */}
        <div className="panel p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-accent-400">Bring these four</h2>
            <div className="flex gap-1">
              {recommendations.map((_r, i) => (
                <button
                  key={i}
                  className={`btn px-2 py-1 text-xs ${i === picked ? 'btn-primary' : ''}`}
                  onClick={() => setPicked(i)}
                >
                  #{i + 1}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-center gap-6">
            <Squad label="LEAD" ids={rec.leads.map((i) => mySpecies(i))} size={84} accent />
            <Squad label="BACK" ids={rec.back.map((i) => mySpecies(i))} size={64} />
            <Squad label="BENCH" ids={rec.bench.map((i) => mySpecies(i))} size={48} dim />
          </div>

          <ul className="mt-4 space-y-1.5 text-sm text-ink-300">
            {rec.reasons.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent-400">▸</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex justify-end">
            <button
              className="btn"
              onClick={() => onLog(rec.bring.map((i) => team.pokemon[i].speciesId))}
              title="Snapshot this matchup for post-game logging"
            >
              Save for match log
            </button>
          </div>
        </div>

        {/* Opponent likely brings */}
        <div className="panel p-4">
          <h2 className="mb-3 font-semibold">They likely bring</h2>
          <div className="space-y-2">
            {oppEstimates.slice(0, 3).map((est, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-ink-850/60 p-2">
                <span className="w-10 text-right text-xs text-accent-400">
                  {Math.round(est.probability * 100)}%
                </span>
                <div className="flex gap-1">
                  {est.bring.map((j) => {
                    const s = getSpecies(opponents[j].speciesId)!
                    const isLead = est.leads.includes(j)
                    return (
                      <div key={j} className={isLead ? 'rounded-lg ring-2 ring-accent-500/70' : ''} title={`${s.name}${isLead ? ' (likely lead)' : ''}`}>
                        <Sprite species={s} size={36} />
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          {topOpp && (
            <p className="mt-3 text-xs text-ink-500">
              Ringed = likely leads. Based on type matchups vs your six, usage priors and your
              logged games.
            </p>
          )}
        </div>
      </div>

      {/* Threat matrix */}
      <div className="panel overflow-x-auto p-4">
        <h2 className="mb-3 font-semibold">Threat matrix — you (rows) vs them (columns)</h2>
        <table className="border-separate border-spacing-1">
          <thead>
            <tr>
              <th />
              {opponents.map((o) => {
                const s = getSpecies(o.speciesId)!
                return (
                  <th key={o.speciesId} className="p-1 text-center">
                    <Sprite species={s} size={36} className="mx-auto" />
                    <div className="max-w-24 truncate text-[10px] font-normal text-ink-300">{s.name}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={i}>
                <td className="p-1 text-center">
                  <Sprite species={mySpecies(i)} size={36} className="mx-auto" />
                  <div className="max-w-24 truncate text-[10px] text-ink-300">{mySpecies(i).name}</div>
                </td>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="min-w-24 rounded-lg p-1.5 align-top text-[10px] leading-tight"
                    style={{ backgroundColor: cellColor(cell) }}
                    title={`${mySpecies(i).name} vs ${getSpecies(cell.theirs)?.name}\nYou: ${cell.offense.bestMove} ${cell.offense.dmgPct[0]}–${cell.offense.dmgPct[1]}%\nThem: ${cell.defense.bestMove} ${cell.defense.dmgPct[0]}–${cell.defense.dmgPct[1]}%\nSpeed: ${cell.speed}`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>{cell.offense.dmgPct[1]}%</span>
                      <span>{cell.speed === 'faster' ? '⚡' : cell.speed === 'slower' ? '🐢' : '='}</span>
                    </div>
                    <div className="truncate opacity-80">{cell.offense.bestMove}</div>
                    <div className="mt-0.5 truncate opacity-60">↩ {cell.defense.dmgPct[1]}% {cell.defense.bestMove}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-500">
          Cell = your best move damage (top) and their best answer (bottom). Bright red = they
          have a guaranteed OHKO on you; green→blue = your guaranteed OHKO (bluer = more
          overkill); amber = mutual OHKO decided by a speed tie. ⚡ you're faster · 🐢 slower.
        </p>
      </div>
    </>
  )
}

function Squad({
  label,
  ids,
  size,
  accent,
  dim,
}: {
  label: string
  ids: ReturnType<typeof getSpecies>[]
  size: number
  accent?: boolean
  dim?: boolean
}) {
  return (
    <div className="text-center">
      <div className={`mb-1 text-[10px] font-bold tracking-widest ${accent ? 'text-accent-400' : 'text-ink-500'}`}>
        {label}
      </div>
      <div className={`flex gap-2 ${dim ? 'opacity-40 grayscale' : ''}`}>
        {ids.map(
          (s) =>
            s && (
              <div key={s.id} className={accent ? 'rounded-2xl bg-accent-500/10 p-1 ring-2 ring-accent-500/60' : ''}>
                <Sprite species={s} size={size} kind="art" />
                <div className="mt-0.5 max-w-24 truncate text-[10px] text-ink-300">{s.name}</div>
              </div>
            ),
        )}
      </div>
    </div>
  )
}

function SetInspector({
  speciesId,
  sets,
  onClose,
}: {
  speciesId: string
  sets: PredictedSet[]
  onClose: () => void
}) {
  const s = getSpecies(speciesId)!
  return (
    <Modal title={`Predicted sets — ${s.name}`} onClose={onClose} wide>
      <div className="space-y-3">
        {sets.map((set) => (
          <div key={set.name} className="rounded-xl border border-ink-700 bg-ink-850/60 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold">
                {set.name}
                {set.source === 'archetype' && (
                  <span className="ml-2 rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-ink-300">
                    stat-inferred estimate
                  </span>
                )}
              </span>
              <span className="text-sm text-accent-400">{Math.round(set.probability * 100)}%</span>
            </div>
            <div className="grid gap-1 text-sm text-ink-300 sm:grid-cols-2">
              <div>Item: {set.item || 'unknown'}</div>
              <div>Ability: {set.ability}</div>
              <div>Alignment: {set.nature}</div>
              <div>
                Points:{' '}
                {Object.entries(set.points)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => `${v} ${k.toUpperCase()}`)
                  .join(' / ')}
              </div>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {set.moves.map((m) => {
                const move = getMove(m)
                return move ? (
                  <span key={m} className="flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 text-xs">
                    <TypeBadge type={move.type} small /> {move.name}
                  </span>
                ) : null
              })}
            </div>
            {set.roles.length > 0 && (
              <div className="mt-1 text-xs text-ink-500">Roles: {set.roles.join(', ')}</div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}
