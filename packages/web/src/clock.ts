import { useSyncExternalStore } from 'react'
import { FRAME_MS } from './sprites'

// One clock for every sprite (#208): it ticks four times a frame while
// anything is listening, so each sprite can change frame at its own moment
// (players are out of step, see phaseOf). Only the sprites re-render on a
// tick, not the board around them.

/** Ticks per animation frame: enough that players out of step change frames at different moments. */
const TICKS_PER_FRAME = 4

let frame = 0
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  timer ??= setInterval(() => {
    frame++
    for (const l of listeners) l()
  }, FRAME_MS / TICKS_PER_FRAME)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** The sprite clock's tick count: the component re-renders on every tick. */
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
