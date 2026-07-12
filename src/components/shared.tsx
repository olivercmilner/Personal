import { useEffect, useRef, useState } from 'react'
import type { SpeciesData } from '../types'
import { getSpecies, toId } from '../data'
import { TYPE_COLORS } from '../data/typechart'
import { artworkUrl, dexSpriteUrl, iconUrl } from '../data/sprites'

export function TypeBadge({ type, small }: { type: string; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded font-semibold uppercase tracking-wide text-white ${
        small ? 'px-1.5 py-px text-[9px]' : 'px-2 py-0.5 text-[10px]'
      }`}
      style={{ backgroundColor: TYPE_COLORS[type] ?? '#666' }}
    >
      {type}
    </span>
  )
}

/** Sprite with graceful source fallback: artwork -> dex sprite -> icon -> blank */
export function Sprite({
  species,
  size = 48,
  kind = 'icon',
  className = '',
}: {
  species: SpeciesData
  size?: number
  kind?: 'icon' | 'art'
  className?: string
}) {
  // Champions-exclusive formes have no public sprites yet — fall back to the
  // base species' image so the UI never shows a blank.
  const base = species.baseSpecies ? getSpecies(toId(species.baseSpecies)) : undefined
  const sources = (
    kind === 'art'
      ? [artworkUrl(species), dexSpriteUrl(species), iconUrl(species)]
      : [iconUrl(species), dexSpriteUrl(species)]
  ).concat(base ? [kind === 'art' ? artworkUrl(base) : iconUrl(base)] : [])
  const [idx, setIdx] = useState(0)
  useEffect(() => setIdx(0), [species.id])
  if (idx >= sources.length)
    return (
      <div
        className={`flex items-center justify-center rounded-full bg-ink-800 text-ink-500 ${className}`}
        style={{ width: size, height: size, fontSize: size / 3 }}
      >
        ?
      </div>
    )
  return (
    <img
      src={sources[idx]}
      alt={species.name}
      width={size}
      height={size}
      loading="lazy"
      className={`object-contain ${className}`}
      style={{ width: size, height: size, imageRendering: kind === 'icon' ? 'pixelated' : 'auto' }}
      onError={() => setIdx((i) => i + 1)}
    />
  )
}

export interface ComboItem {
  id: string
  name: string
}

/** Keyboard-first searchable dropdown used for species/move/item entry. */
export function Combobox<T extends ComboItem>({
  value,
  placeholder,
  search,
  onSelect,
  renderItem,
  autoFocus,
  onClear,
  inputClassName = '',
}: {
  value: string
  placeholder: string
  search: (q: string) => T[]
  onSelect: (item: T) => void
  renderItem?: (item: T) => React.ReactNode
  autoFocus?: boolean
  onClear?: () => void
  inputClassName?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const results = open ? search(query) : []

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (item: T) => {
    onSelect(item)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <input
        className={`input ${inputClassName}`}
        placeholder={placeholder}
        value={open ? query : value}
        autoFocus={autoFocus}
        onFocus={() => {
          setOpen(true)
          setQuery('')
          setHi(0)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setHi(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHi((h) => Math.min(h + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHi((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && results[hi]) {
            e.preventDefault()
            pick(results[hi])
          } else if (e.key === 'Escape') {
            setOpen(false)
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'Backspace' && !query && value && onClear) {
            onClear()
          }
        }}
      />
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full min-w-56 overflow-auto rounded-xl border border-ink-700 bg-ink-850 shadow-2xl shadow-black/50">
          {results.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                i === hi ? 'bg-accent-500/20 text-accent-400' : 'hover:bg-ink-800'
              }`}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(item)
              }}
            >
              {renderItem ? renderItem(item) : item.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function SpeciesRow({ species }: { species: SpeciesData }) {
  return (
    <>
      <Sprite species={species} size={28} />
      <span className="flex-1 truncate">{species.name}</span>
      <span className="flex gap-1">
        {species.types.map((t) => (
          <TypeBadge key={t} type={t} small />
        ))}
      </span>
    </>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`panel max-h-[90vh] w-full overflow-auto p-5 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="btn px-2 py-1" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
