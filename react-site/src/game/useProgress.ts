import { useCallback, useEffect, useState } from 'react'
import { CHAI, PLACES, SCROLLS } from './data'

export type Progress = { visited: string[]; picked: string[]; beyond: boolean; finaleSeen: boolean }

const KEY = 'little-world-progress-v1'
const EMPTY: Progress = { visited: [], picked: [], beyond: false, finaleSeen: false }

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...EMPTY, ...JSON.parse(raw) }
  } catch {
    /* storage unavailable: play without saving */
  }
  return EMPTY
}

export function useProgress() {
  const [p, setP] = useState<Progress>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(p))
    } catch {
      /* ignore */
    }
  }, [p])

  const visit = useCallback((id: string) => setP(s => (s.visited.includes(id) ? s : { ...s, visited: [...s.visited, id] })), [])
  const pick = useCallback((id: string) => setP(s => (s.picked.includes(id) ? s : { ...s, picked: [...s.picked, id] })), [])
  const patch = useCallback((part: Partial<Progress>) => setP(s => ({ ...s, ...part })), [])
  const reset = useCallback(() => setP(EMPTY), [])

  const chai = p.picked.filter(id => id.startsWith('c')).length
  const scrolls = p.picked.filter(id => id.startsWith('s')).length
  const xp = p.visited.length * 100 + chai * 25 + scrolls * 50
  const maxXp = PLACES.length * 100 + CHAI.length * 25 + SCROLLS.length * 50

  return { p, visit, pick, patch, reset, chai, scrolls, xp, maxXp }
}
