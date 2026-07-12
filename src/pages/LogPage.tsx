import { useState } from 'react'
import type { MatchLog } from '../types'
import { getSpecies, toId } from '../data'
import { useMatchLogs } from '../store/calibration'
import { useTeams } from '../store/teams'
import { exportAll, importAll, useStored } from '../store/storage'
import { Modal, Sprite } from '../components/shared'
import type { LastMatchup } from './MatchupPage'

export function LogPage() {
  const { logs, upsert, remove } = useMatchLogs()
  const { teams } = useTeams()
  const [lastMatchup] = useStored<LastMatchup | null>('lastMatchup', null)
  const [editing, setEditing] = useState<MatchLog | null>(null)

  const newFromLast = () => {
    if (!lastMatchup) return
    setEditing({
      id: crypto.randomUUID(),
      date: Date.now(),
      myTeamId: lastMatchup.teamId,
      opponent: lastMatchup.opponent,
      myBring: lastMatchup.myBring,
      theirBring: [],
      theirLeads: [],
      revealed: {},
    })
  }

  const backup = () => {
    const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `champ-call-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const restore = async (file: File) => {
    try {
      importAll(JSON.parse(await file.text()))
    } catch {
      alert('Could not read that backup file.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Match Log</h1>
          <p className="text-sm text-ink-300">
            Log what actually happened — predictions get sharper with every entry.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={backup}>
            Backup data
          </button>
          <label className="btn cursor-pointer">
            Restore
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])}
            />
          </label>
          <button className="btn btn-primary" disabled={!lastMatchup} onClick={newFromLast}
            title={lastMatchup ? 'Log the matchup you just analyzed' : 'Analyze a matchup first'}>
            + Log last matchup
          </button>
        </div>
      </div>

      {logs.length === 0 && (
        <div className="panel p-10 text-center text-sm text-ink-300">
          No matches logged yet. After a game, hit “Save for match log” on the matchup screen,
          then record what they brought here.
        </div>
      )}

      <div className="space-y-2">
        {logs.map((log) => {
          const team = teams.find((t) => t.id === log.myTeamId)
          return (
            <div key={log.id} className="panel flex flex-wrap items-center gap-3 p-3">
              <span className={`w-12 text-center text-xs font-bold ${log.result === 'win' ? 'text-good-500' : log.result === 'loss' ? 'text-bad-500' : 'text-ink-500'}`}>
                {log.result?.toUpperCase() ?? '—'}
              </span>
              <div className="flex gap-1">
                {log.opponent.map((id) => {
                  const s = getSpecies(id)
                  if (!s) return null
                  const brought = log.theirBring?.includes(id)
                  const led = log.theirLeads?.includes(id)
                  return (
                    <div
                      key={id}
                      className={led ? 'rounded-lg ring-2 ring-accent-500/70' : ''}
                      style={{ opacity: brought || !log.theirBring?.length ? 1 : 0.3 }}
                      title={s.name}
                    >
                      <Sprite species={s} size={32} />
                    </div>
                  )
                })}
              </div>
              <span className="flex-1 text-xs text-ink-500">
                vs {team?.name ?? 'deleted team'} · {new Date(log.date).toLocaleString()}
                {log.notes ? ` · ${log.notes}` : ''}
              </span>
              <button className="btn px-2 py-1 text-xs" onClick={() => setEditing(structuredClone(log))}>
                Edit
              </button>
              <button className="btn px-2 py-1 text-xs text-bad-500" onClick={() => remove(log.id)}>
                ✕
              </button>
            </div>
          )
        })}
      </div>

      {editing && (
        <LogEditor
          log={editing}
          onSave={(l) => {
            upsert(l)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function LogEditor({
  log,
  onSave,
  onClose,
}: {
  log: MatchLog
  onSave: (l: MatchLog) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(log)

  const toggleBring = (id: string) => {
    const cur = draft.theirBring ?? []
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-4)
    setDraft({
      ...draft,
      theirBring: next,
      theirLeads: (draft.theirLeads ?? []).filter((x) => next.includes(x)),
    })
  }
  const toggleLead = (id: string) => {
    if (!draft.theirBring?.includes(id)) return
    const cur = draft.theirLeads ?? []
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2)
    setDraft({ ...draft, theirLeads: next })
  }

  return (
    <Modal title="Log match result" onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div>
          <div className="mb-2 text-ink-300">
            Tap what they <b>brought</b> (up to 4), then star their <b>leads</b>:
          </div>
          <div className="flex flex-wrap gap-2">
            {draft.opponent.map((id) => {
              const s = getSpecies(id)
              if (!s) return null
              const brought = draft.theirBring?.includes(id)
              const led = draft.theirLeads?.includes(id)
              return (
                <div key={id} className={`flex flex-col items-center gap-1 rounded-xl border p-2 ${brought ? 'border-accent-500 bg-accent-500/10' : 'border-ink-700 opacity-60'}`}>
                  <button onClick={() => toggleBring(id)} title={brought ? 'Brought — click to unmark' : 'Click if they brought it'}>
                    <Sprite species={s} size={44} />
                    <div className="max-w-20 truncate text-xs">{s.name}</div>
                  </button>
                  <button
                    className={`text-xs ${led ? 'text-accent-400' : 'text-ink-500'} ${brought ? '' : 'invisible'}`}
                    onClick={() => toggleLead(id)}
                  >
                    {led ? '★ lead' : '☆ lead?'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 text-ink-300">Revealed info (optional — sharpens set prediction):</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(draft.theirBring ?? []).map((id) => {
              const s = getSpecies(id)
              if (!s) return null
              const info = draft.revealed?.[id] ?? {}
              return (
                <div key={id} className="flex items-center gap-2 rounded-lg bg-ink-850/60 p-2">
                  <Sprite species={s} size={32} />
                  <input
                    className="input flex-1 !py-1 text-xs"
                    placeholder="item"
                    value={info.item ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        revealed: { ...draft.revealed, [id]: { ...info, item: e.target.value } },
                      })
                    }
                  />
                  <input
                    className="input flex-[2] !py-1 text-xs"
                    placeholder="moves seen, comma-separated"
                    value={info.moves?.join(', ') ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        revealed: {
                          ...draft.revealed,
                          [id]: {
                            ...info,
                            moves: e.target.value.split(',').map((m) => toId(m)).filter(Boolean),
                          },
                        },
                      })
                    }
                  />
                </div>
              )
            })}
            {!draft.theirBring?.length && (
              <span className="text-xs text-ink-500">Mark their brought four first.</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-ink-300">Result:</span>
          {(['win', 'loss'] as const).map((r) => (
            <button
              key={r}
              className={`btn ${draft.result === r ? (r === 'win' ? 'border-good-500 text-good-500' : 'border-bad-500 text-bad-500') : ''}`}
              onClick={() => setDraft({ ...draft, result: draft.result === r ? undefined : r })}
            >
              {r.toUpperCase()}
            </button>
          ))}
          <input
            className="input flex-1"
            placeholder="notes"
            value={draft.notes ?? ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onSave(draft)}>
            Save log
          </button>
        </div>
      </div>
    </Modal>
  )
}
