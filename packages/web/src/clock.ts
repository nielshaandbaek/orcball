import { useSyncExternalStore } from 'react'
import { FRAME_MS } from './sprites'

// One clock for every sprite (#208): a frame count that ticks SPRITE_FPS times
// a second while anything is listening. Only the sprites re-render on a tick,
// not the board around them.

let frame = 0
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  timer ??= setInterval(() => {
    frame++
    for (const l of listeners) l()
  }, FRAME_MS)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** The sprite clock's frame count: the component re-renders on every tick. */
export function useSpriteClock(): number {
  return useSyncExternalStore(subscribe, () => frame)
}

const REDUCED = '(prefers-reduced-motion: reduce)'

function subscribeMotion(listener: () => void): () => void {
  const query = window.matchMedia?.(REDUCED)
  query?.addEventListener('change', listener)
  return () => query?.removeEventListener('change', listener)
}

/** Whether the system asks for less motion: then sprites don't loop. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia?.(REDUCED).matches ?? false)
}
