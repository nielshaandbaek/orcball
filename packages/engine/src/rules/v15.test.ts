import { describe, expect, it } from 'vitest'
import { rulesV14, rulesV15, type RuleConfig } from '../config'
import { createEngine } from '../engine'
import { fromColRow, toColRow } from '../hex'
import { createMatch } from '../match'
import type { GameState } from '../state'
import { RULE_MODULES } from '.'
import { reachableHexes } from './movement'
import { run, scene } from './test-helpers'

// Rules v15: v14 with Sprint +1 MA instead of +2 (#106), every Elf 1 MA
// slower (#105), and a natural 10 on a pass always accurate (#104).

const engine = createEngine(RULE_MODULES)
const THROWER = 'home-thrower-1' // AG 6+
const BLITZER = 'home-blitzer-1' // MA 6

describe('rules v15 config', () => {
  it('is v14 with Sprint +1, a natural 10 always passing, and every Elf 1 MA slower', () => {
    const { id: _a, rosters: r15, movement: m15, ball: b15, ...rest15 } = rulesV15
    const { id: _b, rosters: r14, movement: m14, ball: b14, ...rest14 } = rulesV14
    expect(rulesV15.id).toBe('rules-v15')
    expect(rest15).toEqual(rest14)
    expect(m15).toEqual({ ...m14, sprintBonus: 1 })
    expect(b15).toEqual({ ...b14, naturalTenAlwaysPasses: true })
    expect(r15.orcs).toEqual(r14.orcs)
    const slower = Object.fromEntries(Object.entries(r14.elves!.positions).map(([id, p]) => [id, { ...p, ma: p.ma - 1 }]))
    expect(r15.elves).toEqual({ ...r14.elves, positions: slower })
  })

  it('fields Elves at MA 7 (Wardancer, Catcher) and 6 (Thrower, Lineman)', () => {
    const state = createMatch(rulesV15, [rulesV15.rosters.orcs!, rulesV15.rosters.elves!], 1)
    const ma = Object.fromEntries(Object.values(state.players).filter((p) => p.team === 'away').map((p) => [p.position, p.ma]))
    expect(ma).toEqual({ wardancer: 7, catcher: 7, thrower: 6, lineman: 6 })
  })
})

describe('Sprint under v15', () => {
  const reach = (config: RuleConfig, col: number) => {
    const state = scene({ [BLITZER]: { col: 5, row: 5 } })
    state.config = config
    return reachableHexes(state, BLITZER).find((r) => toColRow(r.hex).col === col && toColRow(r.hex).row === 5)
  }

  it('takes a player 1 hex past his MA, not 2', () => {
    expect(reach(rulesV15, 11)).toMatchObject({ cost: 6, sprint: false })
    expect(reach(rulesV15, 12)).toMatchObject({ cost: 7, sprint: true })
    expect(reach(rulesV15, 13)).toBeUndefined()
    // v14 still Sprints 2.
    expect(reach(rulesV14, 13)).toMatchObject({ cost: 8, sprint: true })
  })
})

describe('a natural 10 on a pass under v15', () => {
  /**
   * The Orc Thrower at (3,5) passes to the Blitzer at (8,5) (Short) with 9 against him in all,
   * so only a natural 10 can succeed, and it comes out at 1: a fumble before v15.
   */
  function throwing(config: RuleConfig, face: number): GameState {
    const state = scene({ [THROWER]: { col: 3, row: 5 }, [BLITZER]: { col: 8, row: 5 } }, [face, 1, 1, 1, 1, 1, 1, 1, 1])
    state.config = { ...config, ball: { ...config.ball, passBands: config.ball.passBands.map((b) => ({ ...b, modifier: b.modifier - 8 })) } }
    state.teams.home.momentum = 0
    state.teams.away.momentum = 0
    state.ball = { hex: fromColRow({ col: 3, row: 5 }), carrier: THROWER }
    return run(engine, state, { type: 'activate', playerId: THROWER, action: 'pass' }).state
  }
  const pass = { type: 'pass' as const, target: fromColRow({ col: 8, row: 5 }) }

  it('is accurate however much is against it', () => {
    const after = run(engine, throwing(rulesV15, 10), pass)
    expect(after.events.some((e) => e.type === 'fumbled')).toBe(false)
    expect(after.state.ball.carrier).toBe(BLITZER)
  })

  it('can still be a fumble under v14', () => {
    const after = run(engine, throwing(rulesV14, 10), pass)
    expect(after.events).toContainEqual({ type: 'fumbled', playerId: THROWER })
  })

  it('is what the preview counts on: its chance is the share of faces that pass accurately', () => {
    const [preview] = engine.previewRolls(throwing(rulesV15, 10), pass)
    let accurate = 0
    for (let face = 1; face <= 10; face++) {
      const { events } = run(engine, throwing(rulesV15, face), pass)
      const roll = events.find((e) => e.type === 'rolled' && e.test === 'Pass')
      if (roll?.type === 'rolled' && roll.success && !events.some((e) => e.type === 'fumbled')) accurate++
    }
    expect(preview!.chance).toBeCloseTo(accurate / 10)
    expect(accurate).toBe(1)
  })
})
