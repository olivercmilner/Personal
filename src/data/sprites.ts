import type { SpeciesData } from '../types'

/**
 * Public sprite sources:
 * - PokeAPI official artwork (crisp, large) keyed by national dex number —
 *   only reliable for base formes.
 * - Pokemon Showdown dex sprites keyed by showdown id — covers every forme
 *   (megas, regionals) at 120px.
 * - Showdown gen5 pixel icons as the small/fallback tier.
 */
export function artworkUrl(species: SpeciesData): string {
  if (!species.forme) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${species.num}.png`
  }
  return dexSpriteUrl(species)
}

export function dexSpriteUrl(species: SpeciesData): string {
  return `https://play.pokemonshowdown.com/sprites/dex/${species.id}.png`
}

export function iconUrl(species: SpeciesData): string {
  return `https://play.pokemonshowdown.com/sprites/gen5/${species.id}.png`
}
