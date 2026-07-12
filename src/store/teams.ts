import type { PokemonBuild, Team } from '../types'
import { EMPTY_POINTS } from '../engine/stats'
import { useStored } from './storage'

export const emptyBuild = (): PokemonBuild => ({
  speciesId: '',
  moves: [],
  ability: '',
  item: '',
  nature: 'Serious',
  points: { ...EMPTY_POINTS },
})

export function newTeam(name = 'New Team'): Team {
  return {
    id: crypto.randomUUID(),
    name,
    pokemon: [],
    updatedAt: Date.now(),
  }
}

export function useTeams() {
  const [teams, setTeams] = useStored<Team[]>('teams', [])
  const upsert = (team: Team) =>
    setTeams((prev) => {
      const next = prev.filter((t) => t.id !== team.id)
      next.unshift({ ...team, updatedAt: Date.now() })
      return next
    })
  const remove = (id: string) => setTeams((prev) => prev.filter((t) => t.id !== id))
  return { teams, upsert, remove }
}
