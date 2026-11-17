import { describe, expect, it } from 'vitest'
import { rulesV24, rulesV25 } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex } from '../hex'
import type { Command, GameState } from '../state'
import { RULE_MODULES } from '.'
import { run, scene } from './test-helpers'

// Rules v25: v24 with slower Orcs (#196), and the Orc Thrower a Runner with
// Sure Hands (+1 on pick-ups) in place of Pass.

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })

const RUNNER = 'home-thrower-1' // the position keeps its id, so its icons and formation slots too
const ELF = 'away-lineman-1'

describe('rules v25 config', () => {
  it('is v24 with the revised Orcs', () => {
    const { id: _a, rosters: r25, ...rest25 } = rulesV25
    const { id: _b, rosters: r24, ...rest24 } = rulesV24
    expect(rulesV25.id).toBe('rules-v25')
    expect(rest25).toEqual(rest24)
    const { orcs: o25, ...others25 } = r25
    const { orcs: o24, ...others24 } = r24
    expect(others25).toEqual(others24)
    const stats = Object.fromEntries(Object.entries(o25!.positions).map(([id, p]) => [id, [p.name, p.max, p.ma, p.st, p.ag, p.to, ...p.skills]]))
    expect(stats).toEqual({
      brute: ['Brute', 2, 3, 4, 7, 9, 'Crushing Blow'],
      blitzer: ['Blitzer', 2, 5, 3, 6, 9, 'Block'],
      thrower: ['Runner', 1, 5, 3, 6, 8, 'Sure Hands'],
      lineman: ['Lineman', 2, 4, 3, 6, 9, 'Brace'],
    })
    expect(o24!.positions.thrower!.skills).toEqual(['Pass'])
  })
})

describe('Sure Hands (#196)', () => {
  /** The Runner next to a loose ball an Elf marks, his Move started. */
  function nextToBall(faces: number[] = []): GameState {
    const state = scene({ [RUNNER]: { col: 5, row: 5 }, [ELF]: { col: 7, row: 5 } }, faces)
    state.config = rulesV25
    state.players[RUNNER]!.skills = ['Sure Hands']
    state.teams.home.momentum = 0
    state.ball = { hex: h(6, 5), carrier: null }
    return run(engine, state, { type: 'activate', playerId: RUNNER, action: 'move' }).state
  }
  const step: Command = { type: 'move', to: h(6, 5) }

  it('gives +1 on a marked pick-up, in the preview and the roll', () => {
    const state = nextToBall([5])
    expect(engine.previewRoll(state, step)?.modifiers).toEqual([
      { name: '1 tackle zone', value: -1 },
      { name: 'Sure Hands', value: 1 },
    ])
    // AG 6+: a 6, −1 for the tackle zone, +1 for Sure Hands, picks up.
    expect(run(engine, nextToBall([6]), step).state.ball.carrier).toBe(RUNNER)
  })

  it('without it, the same 6 fails', () => {
    const without = nextToBall([6, 2])
    without.players[RUNNER]!.skills = []
    expect(run(engine, without, step).state.ball.carrier).toBeNull()
  })

  it('changes nothing unmarked: the pick-up needs no roll', () => {
    const state = nextToBall()
    state.players[ELF]!.hex = h(12, 9)
    expect(engine.previewRoll(state, step)).toBeNull()
    expect(run(engine, state, step).state.ball.carrier).toBe(RUNNER)
  })
})
