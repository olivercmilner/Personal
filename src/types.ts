export type StatName = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe'

export type StatTable = Record<StatName, number>

export interface SpeciesData {
  id: string
  name: string
  num: number
  types: string[]
  baseStats: StatTable
  abilities: string[]
  baseSpecies?: string
  forme?: string
  weightkg: number
}

export interface MoveData {
  id: string
  name: string
  type: string
  category: 'Physical' | 'Special' | 'Status'
  basePower: number
  /** 0 means the move never misses */
  accuracy: number
  priority: number
  target: string
  shortDesc?: string
}

export interface ItemData {
  id: string
  name: string
  shortDesc?: string
}

/** Champions stat allocation: 66 points total, max 32 per stat, +1 stat per point at Lv50 */
export type PointSpread = StatTable

export const TOTAL_POINTS = 66
export const MAX_POINTS_PER_STAT = 32
export const CHAMPIONS_LEVEL = 50

/** One Pokemon exactly as stored in-game */
export interface PokemonBuild {
  speciesId: string
  moves: string[] // move ids, up to 4
  ability: string
  item: string
  nature: string // "Stat Alignment" in Champions
  points: PointSpread
  teraType?: string // reserved; not used by current regulation
}

export interface Team {
  id: string
  name: string
  notes?: string
  pokemon: PokemonBuild[] // up to 6
  updatedAt: number
}

/** A predicted/curated competitive set for an opponent species */
export interface MetaSet {
  name: string // e.g. "Assault Vest pivot"
  moves: string[] // move ids
  ability: string
  item: string
  nature: string
  points: PointSpread
  /** relative usage weight among this species' sets (any positive scale) */
  weight: number
  roles: string[] // e.g. "speed-control", "fake-out", "setup", "redirection"
  /**
   * Species id to use for battle math when the set transforms the Pokemon —
   * e.g. a Mega set on the base species points at the Mega forme.
   */
  formeId?: string
}

export interface MetaEntry {
  speciesId: string
  usage: number // 0..1 ladder usage share, for bring-likelihood priors
  sets: MetaSet[]
  teammates?: string[] // species ids commonly paired
}

export interface PredictedSet extends MetaSet {
  probability: number // normalized 0..1 across the species' candidate sets
  source: 'meta' | 'user' | 'archetype'
}

// ---- Engine outputs ----

export interface DuelResult {
  /** damage % of defender max HP from attacker's best move: [min, max] */
  bestMove: string
  dmgPct: [number, number]
  koTurns: number // 1 = OHKO, 2 = 2HKO ... 9 = no meaningful damage
}

export interface MatchupCell {
  mine: string // my species id
  theirs: string // their species id
  offense: DuelResult // me attacking them
  defense: DuelResult // them attacking me
  speed: 'faster' | 'slower' | 'tie'
  /** -1..1, positive = favorable for me */
  score: number
}

export interface BringRecommendation {
  bring: number[] // indexes into my team (4)
  leads: number[] // indexes into `bring` order? no — indexes into my team (2, subset of bring)
  back: number[] // indexes into my team (2, subset of bring)
  bench: number[] // indexes into my team (2)
  score: number
  reasons: string[]
}

export interface OpponentBringEstimate {
  bring: number[] // indexes into opponent team
  leads: number[]
  probability: number
}

// ---- Calibration ----

export interface MatchLog {
  id: string
  date: number
  myTeamId: string
  opponent: string[] // 6 species ids
  theirBring?: string[] // species ids actually brought (up to 4)
  theirLeads?: string[] // species ids led (up to 2)
  revealed?: Record<string, { moves?: string[]; item?: string; ability?: string }>
  myBring?: string[]
  result?: 'win' | 'loss'
  notes?: string
}
