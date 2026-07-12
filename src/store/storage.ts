import { useCallback, useSyncExternalStore } from 'react'

/**
 * Tiny typed localStorage store with cross-component reactivity via
 * useSyncExternalStore. All app state (teams, logs, dataset overrides)
 * lives under the "champ:" prefix so export/import can grab everything.
 */
const PREFIX = 'champ:'
const listeners = new Map<string, Set<() => void>>()
const cache = new Map<string, unknown>()

function emit(key: string) {
  listeners.get(key)?.forEach((fn) => fn())
}

export function loadValue<T>(key: string, fallback: T): T {
  const full = PREFIX + key
  if (cache.has(full)) return cache.get(full) as T
  try {
    const raw = localStorage.getItem(full)
    const value = raw ? (JSON.parse(raw) as T) : fallback
    cache.set(full, value)
    return value
  } catch {
    return fallback
  }
}

export function saveValue<T>(key: string, value: T): void {
  const full = PREFIX + key
  cache.set(full, value)
  try {
    localStorage.setItem(full, JSON.stringify(value))
  } catch {
    // Quota exceeded — keep the in-memory value so the session still works.
  }
  emit(key)
}

export function useStored<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const subscribe = useCallback(
    (fn: () => void) => {
      let set = listeners.get(key)
      if (!set) listeners.set(key, (set = new Set()))
      set.add(fn)
      return () => set.delete(fn)
    },
    [key],
  )
  const value = useSyncExternalStore(subscribe, () => loadValue(key, fallback))
  const setValue = useCallback(
    (v: T | ((prev: T) => T)) => {
      const next = typeof v === 'function' ? (v as (prev: T) => T)(loadValue(key, fallback)) : v
      saveValue(key, next)
    },
    [key, fallback],
  )
  return [value, setValue]
}

/** Everything under the app prefix, for backup export. */
export function exportAll(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(PREFIX)) {
      try {
        out[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k)!)
      } catch { /* skip corrupt entry */ }
    }
  }
  return out
}

export function importAll(data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) saveValue(k, v)
}
