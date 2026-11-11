import { describe, expect, it } from 'vitest'
import { rulesV16, rulesV17 } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex } from '../hex'
import type { Command, GameState, TeamId } from '../state'
import { RULE_MODULES } from '.'
import { type Placement, run, scene } from './test-helpers'

// Rules v17: v16 with the Pass skill, +1 on pass rolls, for both Throwers (#100).

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })

const THROWER = 'home-thrower-1' // AG 6+, Pass in v17
const BLITZER = 'home-blitzer-1'
const ELF = 'away-lineman-1'

/** A scene under v17 (or another config), each player with his skills there; no Momentum, so misses aren't re-rolled. */
function v17(placements: Record<string, Placement>, faces: number[] = [], { config = rulesV17, turn = 'home' as TeamId } = {}): GameState {
  const state = scene(placements, faces)
  state.config = config
  const rosters = { home: config.rosters.orcs!, away: config.rosters.elves! }
  for (const p of Object.values(state.players)) p.skills = [...(rosters[p.team].positions[p.position]?.skills ?? [])]
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  state.turnOwner = turn
  state.firstGo = turn
  return state
}

/** The Orc Thrower at (3,5) with the ball, activated to pass; the Blitzer at (8,5), a Short pass (−1) away. */
function passing(faces: number[] = [], config = rulesV17): GameState {
  const state = v17({ [THROWER]: { col: 3, row: 5 }, [BLITZER]: { col: 8, row: 5 } }, faces, { config })
  state.ball = { hex: h(3, 5), carrier: THROWER }
  return run(engine, state, { type: 'activate', playerId: THROWER, action: 'pass' }).state
}
const pass: Command = { type: 'pass', target: h(8, 5) }

describe('rules v17 config', () => {
  it('is v16 with Pass for both Throwers', () => {
    const { id: _a, rosters: r17, ...rest17 } = rulesV17
    const { id: _b, rosters: r16, ...rest16 } = rulesV16
    expect(rulesV17.id).toBe('rules-v17')
    expect(rest17).toEqual(rest16)
    for (const team of ['orcs', 'elves']) {
      const old = r16[team]!
      expect(r17[team]).toEqual({ ...old, positions: { ...old.positions, thrower: { ...old.positions.thrower!, skills: ['Pass'] } } })
    }
  })
})

describe('Pass (#100)', () => {
  it('is +1 on a pass roll, shown in the preview', () => {
    expect(engine.previewRoll(passing(), pass)).toMatchObject({
      test: 'Pass',
      target: 6,
      modifiers: [
        { name: 'Short', value: -1 },
        { name: 'Pass', value: 1 },
      ],
      chance: 0.5,
    })
    // A 6 is accurate: AG 6+ with −1 +1.
    const after = run(engine, passing([6]), pass)
    expect(after.events.find((e) => e.type === 'rolled')).toMatchObject({ test: 'Pass', natural: 6, success: true })
  })

  it('counts against a fumble too: a natural 2 at −1 +1 is inaccurate, not a fumble', () => {
    const after = run(engine, passing([2, 1, 1, 1, 1, 1]), pass)
    expect(after.events.some((e) => e.type === 'fumbled')).toBe(false)
    // In v16 the same roll is 2 − 1 = 1: a fumble.
    const before = run(engine, passing([2, 1, 1, 1, 1, 1], rulesV16), pass)
    expect(before.events.some((e) => e.type === 'fumbled')).toBe(true)
  })

  it('isn’t there for a v16 Thrower', () => {
    expect(engine.previewRoll(passing([], rulesV16), pass)).toMatchObject({ modifiers: [{ name: 'Short', value: -1 }], chance: 0.4 })
  })

  it('isn’t on a hand-off catch: Pass is the thrower’s, not the receiver’s', () => {
    const state = v17({ [THROWER]: { col: 7, row: 5 }, [BLITZER]: { col: 8, row: 5 }, [ELF]: { col: 9, row: 5 } })
    state.ball = { hex: h(7, 5), carrier: THROWER }
    const handing = run(engine, state, { type: 'activate', playerId: THROWER, action: 'handOff' }).state
    const preview = engine.previewRoll(handing, { type: 'handOff', targetId: BLITZER })
    expect(preview?.modifiers.map((m) => m.name)).not.toContain('Pass')
  })
})
