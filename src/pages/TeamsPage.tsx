import { useState } from 'react'
import type { Team } from '../types'
import { getSpecies } from '../data'
import { validateSpread } from '../engine/stats'
import { newTeam, emptyBuild, useTeams } from '../store/teams'
import { exportTeamPaste, parseTeamPaste } from '../store/paste'
import { BuildEditor } from '../components/BuildEditor'
import { Modal, Sprite } from '../components/shared'

export function TeamsPage({ onPrepare }: { onPrepare: (teamId: string) => void }) {
  const { teams, upsert, remove } = useTeams()
  const [editing, setEditing] = useState<Team | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  if (editing) {
    return (
      <TeamEditor
        team={editing}
        onSave={(t) => {
          upsert(t)
          setEditing(null)
        }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Your Teams</h1>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setPasteOpen(true)}>
            Import paste
          </button>
          <button className="btn btn-primary" onClick={() => setEditing(newTeam())}>
            + New team
          </button>
        </div>
      </div>

      {teams.length === 0 && (
        <div className="panel p-10 text-center text-ink-300">
          <p className="mb-2 text-lg">No teams yet.</p>
          <p className="text-sm">
            Build your six exactly as they're stored in-game — moves, ability, item, stat
            alignment and the 66-point spread — so match prep takes zero typing.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {teams.map((team) => (
          <div key={team.id} className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{team.name}</h2>
              <span className="text-xs text-ink-500">
                {new Date(team.updatedAt).toLocaleDateString()}
              </span>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              {team.pokemon.map((p, i) => {
                const s = getSpecies(p.speciesId)
                return s ? (
                  <div key={i} className="flex flex-col items-center" title={s.name}>
                    <Sprite species={s} size={44} />
                  </div>
                ) : null
              })}
              {team.pokemon.length === 0 && <span className="text-sm text-ink-500">Empty</span>}
            </div>
            <div className="flex gap-2">
              <button
                className="btn btn-primary flex-1 justify-center"
                disabled={team.pokemon.length < 1}
                onClick={() => onPrepare(team.id)}
              >
                Prepare ▸
              </button>
              <button className="btn" onClick={() => setEditing(structuredClone(team))}>
                Edit
              </button>
              <button
                className="btn"
                onClick={() => navigator.clipboard.writeText(exportTeamPaste(team))}
                title="Copy paste to clipboard"
              >
                Export
              </button>
              <button
                className="btn text-bad-500"
                onClick={() => confirm(`Delete "${team.name}"?`) && remove(team.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {pasteOpen && (
        <Modal title="Import team from paste" onClose={() => setPasteOpen(false)} wide>
          <p className="mb-2 text-sm text-ink-300">
            Showdown-style paste. Use a <code className="text-accent-400">Points:</code> line for
            Champions spreads — <code className="text-accent-400">EVs:</code> lines are converted
            automatically (÷8, trimmed to the 66 budget).
          </p>
          <textarea
            className="input h-64 font-mono text-xs"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Garchomp @ Life Orb\nAbility: Rough Skin\nPoints: 2 HP / 32 Atk / 32 Spe\nJolly Nature\n- Earthquake\n...'}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button className="btn" onClick={() => setPasteOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const builds = parseTeamPaste(pasteText)
                if (builds.length) {
                  setEditing({ ...newTeam('Imported team'), pokemon: builds })
                  setPasteOpen(false)
                  setPasteText('')
                }
              }}
            >
              Import
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function TeamEditor({
  team,
  onSave,
  onCancel,
}: {
  team: Team
  onSave: (t: Team) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(team)
  const issues = draft.pokemon
    .map((p, i) => {
      const err = validateSpread(p.points)
      return err ? `Slot ${i + 1}: ${err}` : null
    })
    .filter(Boolean) as string[]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button className="btn" onClick={onCancel}>
          ← Back
        </button>
        <input
          className="input max-w-xs text-lg font-semibold"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <div className="flex-1" />
        <span className="text-sm text-ink-300">{draft.pokemon.length}/6</span>
        <button className="btn btn-primary" disabled={issues.length > 0} onClick={() => onSave(draft)}>
          Save team
        </button>
      </div>

      {issues.length > 0 && (
        <div className="panel border-bad-500/40 p-3 text-sm text-bad-500">
          {issues.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {draft.pokemon.map((p, i) => (
          <BuildEditor
            key={i}
            build={p}
            onChange={(b) => {
              const pokemon = [...draft.pokemon]
              pokemon[i] = b
              setDraft({ ...draft, pokemon })
            }}
            onRemove={() =>
              setDraft({ ...draft, pokemon: draft.pokemon.filter((_, j) => j !== i) })
            }
          />
        ))}
        {draft.pokemon.length < 6 && (
          <button
            className="panel flex min-h-40 items-center justify-center text-4xl text-ink-500 transition hover:border-accent-500 hover:text-accent-400"
            onClick={() => setDraft({ ...draft, pokemon: [...draft.pokemon, emptyBuild()] })}
          >
            +
          </button>
        )}
      </div>
    </div>
  )
}
