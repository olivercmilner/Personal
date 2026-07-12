import type { PokemonBuild, StatName } from '../types'
import { MAX_POINTS_PER_STAT, TOTAL_POINTS } from '../types'
import { getMove, getSpecies, searchItems, searchMoves, searchSpecies } from '../data'
import { NATURES, getNature } from '../data/natures'
import { championStats, totalPoints } from '../engine/stats'
import { Combobox, Sprite, SpeciesRow, TypeBadge } from './shared'

const STAT_LABELS: Record<StatName, string> = {
  hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
}
const STATS = Object.keys(STAT_LABELS) as StatName[]

export function BuildEditor({
  build,
  onChange,
  onRemove,
}: {
  build: PokemonBuild
  onChange: (b: PokemonBuild) => void
  onRemove: () => void
}) {
  const species = getSpecies(build.speciesId)
  const spent = totalPoints(build.points)
  const remaining = TOTAL_POINTS - spent
  const finalStats = species ? championStats(species.baseStats, build.points, build.nature) : null
  const nature = getNature(build.nature)

  const setPoints = (stat: StatName, raw: number) => {
    const v = Math.max(0, Math.min(MAX_POINTS_PER_STAT, Math.floor(raw) || 0))
    const others = spent - (build.points[stat] ?? 0)
    const capped = Math.min(v, TOTAL_POINTS - others)
    onChange({ ...build, points: { ...build.points, [stat]: capped } })
  }

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center gap-3">
        {species ? <Sprite species={species} size={56} kind="art" /> : <div className="h-14 w-14 rounded-full bg-ink-800" />}
        <div className="min-w-0 flex-1">
          <Combobox
            value={species?.name ?? ''}
            placeholder="Search Pokemon…"
            search={(q) => searchSpecies(q)}
            onSelect={(s) =>
              onChange({
                ...build,
                speciesId: s.id,
                ability: s.abilities.includes(build.ability) ? build.ability : s.abilities[0] ?? '',
              })
            }
            renderItem={(s) => <SpeciesRow species={s} />}
          />
          {species && (
            <div className="mt-1 flex gap-1">
              {species.types.map((t) => (
                <TypeBadge key={t} type={t} />
              ))}
            </div>
          )}
        </div>
        <button className="btn px-2 py-1 text-bad-500" title="Remove" onClick={onRemove}>
          ✕
        </button>
      </div>

      {species && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-ink-300">
              Ability
              <select
                className="input mt-1"
                value={build.ability}
                onChange={(e) => onChange({ ...build, ability: e.target.value })}
              >
                {species.abilities.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-300">
              Held item
              <div className="mt-1">
                <Combobox
                  value={build.item}
                  placeholder="Item…"
                  search={(q) => searchItems(q)}
                  onSelect={(i) => onChange({ ...build, item: i.name })}
                  onClear={() => onChange({ ...build, item: '' })}
                />
              </div>
            </label>
          </div>

          <div>
            <div className="mb-1 text-xs text-ink-300">Moves</div>
            <div className="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => {
                const moveId = build.moves[i]
                const move = moveId ? getMove(moveId) : undefined
                return (
                  <div key={i} className="flex items-center gap-1">
                    {move && <TypeBadge type={move.type} small />}
                    <div className="flex-1">
                      <Combobox
                        value={move?.name ?? ''}
                        placeholder={`Move ${i + 1}`}
                        search={(q) => searchMoves(q)}
                        onSelect={(m) => {
                          const moves = [...build.moves]
                          moves[i] = m.id
                          onChange({ ...build, moves: moves.filter(Boolean) })
                        }}
                        onClear={() => {
                          const moves = [...build.moves]
                          moves.splice(i, 1)
                          onChange({ ...build, moves })
                        }}
                        renderItem={(m) => (
                          <>
                            <TypeBadge type={m.type} small />
                            <span className="flex-1">{m.name}</span>
                            <span className="text-xs text-ink-500">
                              {m.category === 'Status' ? '—' : m.basePower || '?'}
                            </span>
                          </>
                        )}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-ink-300">
              <span>
                Stat points · <span className={remaining < 0 ? 'text-bad-500' : remaining === 0 ? 'text-good-500' : 'text-accent-400'}>{remaining} left</span> of {TOTAL_POINTS}
              </span>
              <label className="flex items-center gap-1">
                Alignment
                <select
                  className="input !w-auto px-2 py-1"
                  value={build.nature}
                  onChange={(e) => onChange({ ...build, nature: e.target.value })}
                >
                  {NATURES.map((n) => (
                    <option key={n.name} value={n.name}>
                      {n.name}
                      {n.plus ? ` (+${STAT_LABELS[n.plus]}/−${STAT_LABELS[n.minus!]})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="space-y-1">
              {STATS.map((stat) => (
                <div key={stat} className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-8 font-semibold ${
                      nature.plus === stat ? 'text-good-500' : nature.minus === stat ? 'text-bad-500' : 'text-ink-300'
                    }`}
                  >
                    {STAT_LABELS[stat]}
                  </span>
                  <span className="w-7 text-right text-ink-500">{species.baseStats[stat]}</span>
                  <input
                    type="range"
                    min={0}
                    max={MAX_POINTS_PER_STAT}
                    value={build.points[stat] ?? 0}
                    onChange={(e) => setPoints(stat, +e.target.value)}
                    className="flex-1 accent-indigo-400"
                  />
                  <input
                    type="number"
                    min={0}
                    max={MAX_POINTS_PER_STAT}
                    value={build.points[stat] ?? 0}
                    onChange={(e) => setPoints(stat, +e.target.value)}
                    className="input !w-14 px-1 py-0.5 text-center"
                  />
                  <span className="w-9 text-right font-mono font-semibold text-ink-100">
                    {finalStats?.[stat]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
