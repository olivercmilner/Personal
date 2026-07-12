import type { PokemonBuild, StatName, Team } from '../types'
import { MAX_POINTS_PER_STAT, TOTAL_POINTS } from '../types'
import { getSpecies, getMove, searchSpecies, toId } from '../data'
import { EMPTY_POINTS, totalPoints } from '../engine/stats'
import { emptyBuild } from './teams'

/**
 * Showdown-style paste, with a Champions "Points:" line in place of EVs.
 * "EVs:" lines are also accepted and converted (EV/8, capped at 32,
 * trimmed to the 66-point budget) so existing VGC pastes import cleanly.
 */

const STAT_ALIASES: Record<string, StatName> = {
  hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe',
  attack: 'atk', defense: 'def', spatk: 'spa', spdef: 'spd', speed: 'spe',
  spc: 'spa',
}

function parseStatLine(line: string, divisor: 1 | 8): Partial<Record<StatName, number>> {
  const out: Partial<Record<StatName, number>> = {}
  for (const part of line.split('/')) {
    const m = part.trim().match(/^(\d+)\s*([A-Za-z.]+)$/)
    if (!m) continue
    const stat = STAT_ALIASES[m[2].toLowerCase().replace(/\./g, '')]
    if (!stat) continue
    const raw = parseInt(m[1], 10)
    out[stat] = divisor === 1 ? raw : Math.min(MAX_POINTS_PER_STAT, Math.round(raw / 8))
  }
  return out
}

function trimToBudget(points: Record<StatName, number>): void {
  let excess = totalPoints(points) - TOTAL_POINTS
  while (excess > 0) {
    // Trim from the smallest non-zero allocation (usually the dump stat).
    const entries = (Object.entries(points) as [StatName, number][])
      .filter(([, v]) => v > 0)
      .sort((a, b) => a[1] - b[1])
    if (!entries.length) break
    points[entries[0][0]]--
    excess--
  }
}

export function parseBuild(block: string): PokemonBuild | null {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return null
  const build = emptyBuild()

  // Header: "Name @ Item" (nickname "(Species)" supported)
  const header = lines[0]
  const [namePart, itemPart] = header.split('@').map((s) => s.trim())
  const nickMatch = namePart.match(/\(([^)]+)\)/)
  const speciesName = (nickMatch ? nickMatch[1] : namePart).replace(/\s*\((M|F)\)\s*$/i, '')
  const species = getSpecies(toId(speciesName)) ?? searchSpecies(speciesName, 1)[0]
  if (!species) return null
  build.speciesId = species.id
  if (itemPart) build.item = itemPart

  for (const line of lines.slice(1)) {
    if (line.startsWith('-')) {
      const moveName = line.slice(1).trim()
      const move = getMove(toId(moveName))
      if (move && build.moves.length < 4) build.moves.push(move.id)
      continue
    }
    const [key, ...rest] = line.split(':')
    const value = rest.join(':').trim()
    switch (key.toLowerCase()) {
      case 'ability':
        build.ability = value
        break
      case 'points':
        build.points = { ...EMPTY_POINTS, ...parseStatLine(value, 1) }
        break
      case 'evs':
        build.points = { ...EMPTY_POINTS, ...parseStatLine(value, 8) }
        trimToBudget(build.points)
        break
      default:
        if (line.toLowerCase().endsWith('nature'))
          build.nature = line.slice(0, -'nature'.length).trim()
    }
  }
  if (!build.ability) build.ability = species.abilities[0] ?? ''
  return build
}

export function parseTeamPaste(text: string): PokemonBuild[] {
  return text
    .split(/\n\s*\n/)
    .map(parseBuild)
    .filter((b): b is PokemonBuild => b !== null)
    .slice(0, 6)
}

export function exportBuild(build: PokemonBuild): string {
  const species = getSpecies(build.speciesId)
  const lines: string[] = []
  lines.push(`${species?.name ?? build.speciesId}${build.item ? ` @ ${build.item}` : ''}`)
  if (build.ability) lines.push(`Ability: ${build.ability}`)
  lines.push('Level: 50')
  const pts = (Object.entries(build.points) as [StatName, number][])
    .filter(([, v]) => v > 0)
    .map(([s, v]) => `${v} ${{ hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' }[s]}`)
    .join(' / ')
  if (pts) lines.push(`Points: ${pts}`)
  lines.push(`${build.nature} Nature`)
  for (const m of build.moves) lines.push(`- ${getMove(m)?.name ?? m}`)
  return lines.join('\n')
}

export function exportTeamPaste(team: Team): string {
  return team.pokemon.map(exportBuild).join('\n\n')
}
