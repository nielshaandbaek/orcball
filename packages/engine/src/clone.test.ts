import { describe, expect, it } from 'vitest'
import { cloneState } from './clone'
import { rulesV12 } from './config'
import { apply, legalCommands } from './index'
import { createMatch } from './match'
import type { GameState } from './state'

/** Every object reachable from `value`, with its path. */
function objects(value: unknown, path = 'state', found = new Map<object, string>()): Map<object, string> {
  if (value === null || typeof value !== 'object') return found
  found.set(value, path)
  for (const [k, v] of Object.entries(value)) objects(v, `${path}.${k}`, found)
  return found
}

/** States from a match played with seeded random legal commands. */
function states(seed: number, count: number): GameState[] {
  let state = createMatch(rulesV12, [rulesV12.rosters.orcs!, rulesV12.rosters.elves!], seed)
  let pick = seed
  const result: GameState[] = []
  for (let i = 0; i < count && state.phase !== 'FullTime'; i++) {
    result.push(state)
    const legal = legalCommands(state)
    pick = (Math.imul(pick, 1_103_515_245) + 12_345) >>> 0
    state = apply(state, legal[pick % legal.length]!).state
  }
  return result
}

describe('cloneState', () => {
  it('copies everything but the config, sharing no object with the original', () => {
    for (const state of states(5, 3000)) {
      const copy = cloneState(state)
      expect(copy).toEqual(state)
      expect(copy.config).toBe(state.config)
      const original = objects({ ...state, config: null })
      for (const [object, path] of objects({ ...copy, config: null })) {
        if (original.has(object)) throw new Error(`the copy shares ${path} with the original`)
      }
    }
  })
})
