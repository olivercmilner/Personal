import { useState } from 'react'
import { TeamsPage } from './pages/TeamsPage'
import { MatchupPage } from './pages/MatchupPage'
import { LogPage } from './pages/LogPage'
import { BUNDLED_META } from './engine/predict'

type Tab = 'teams' | 'matchup' | 'log'

export default function App() {
  const [tab, setTab] = useState<Tab>('teams')
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null)

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16">
      <header className="sticky top-0 z-40 -mx-4 mb-6 border-b border-ink-700/50 bg-ink-950/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚔️</span>
            <span className="bg-gradient-to-r from-accent-400 to-fuchsia-400 bg-clip-text text-lg font-black tracking-tight text-transparent">
              Champ Call
            </span>
          </div>
          <nav className="flex gap-1">
            {(
              [
                ['teams', 'Teams'],
                ['matchup', 'Matchup'],
                ['log', 'Log'],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  tab === t ? 'bg-accent-500/20 text-accent-400' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
                }`}
                onClick={() => setTab(t)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="flex-1" />
          <span className="hidden text-xs text-ink-500 sm:block">
            {BUNDLED_META.regulation} · dataset {BUNDLED_META.updated}
          </span>
        </div>
      </header>

      {tab === 'teams' && (
        <TeamsPage
          onPrepare={(teamId) => {
            setActiveTeamId(teamId)
            setTab('matchup')
          }}
        />
      )}
      {tab === 'matchup' && <MatchupPage teamId={activeTeamId} onTeamChange={setActiveTeamId} />}
      {tab === 'log' && <LogPage />}
    </div>
  )
}
