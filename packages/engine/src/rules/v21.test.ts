import { describe, expect, it } from 'vitest'
import { type RuleConfig, rulesV20, rulesV21 } from '../config'
import { createEngine } from '../engine'
import { endZoneOf, fromColRow, type Hex } from '../hex'
import { type ActionType, type Command, type GameState, TEAM_SIDES } from '../state'
import { RULE_MODULES } from '.'
import { type Placement, run, scene } from './test-helpers'

// Rules v21: v20 with a Strength Disengage only in a Move action (#181), and
// Out players back after two rounds, placed in their own end zone (#177).

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })

const BLITZER = 'home-blitzer-1'
const ORC = 'home-lineman-1'
const ELF = 'away-lineman-1'
const wait: Command = { type: 'wait' }

function at(config: RuleConfig, placements: Record<string, Placement>, faces: number[] = []): GameState {
  const state = scene(placements, faces)
  state.config = config
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  return state
}

describe('rules v21 config', () => {
  it('is v20 with the two switches', () => {
    const { id: _a, movement: m21, injury: i21, ...rest21 } = rulesV21
    const { id: _b, movement: m20, injury: i20, ...rest20 } = rulesV20
    expect(rulesV21.id).toBe('rules-v21')
    expect(rest21).toEqual(rest20)
    expect(m21).toEqual({ ...m20, strengthDisengageMoveOnly: true })
    expect(i21).toEqual({ ...i20, outReturnsAfterRounds: 2 })
  })
})

describe('Strength Disengage only in a Move (#181)', () => {
  // The Blitzer (ST 3) marked by an Elf Lineman (ST 3): as strong, so he may Disengage to (5,5).
  const marked = (config: RuleConfig, action: ActionType) =>
    run(engine, at(config, { [BLITZER]: { col: 6, row: 5 }, [ELF]: { col: 7, row: 5 }, [ORC]: { col: 2, row: 9 } }), { type: 'activate', playerId: BLITZER, action }).state
  const disengage: Command = { type: 'move', to: h(5, 5), disengage: true }

  it('is allowed in a Move', () => {
    expect(engine.legalCommands(marked(rulesV21, 'move'))).toContainEqual(disengage)
  })

  it('is not allowed in a Blitz, Pass or Foul in v21: only the Dodge', () => {
    for (const action of ['blitz', 'pass', 'foul'] as const) {
      const legal = engine.legalCommands(marked(rulesV21, action))
      expect(legal).not.toContainEqual(disengage)
      expect(legal).toContainEqual({ type: 'move', to: h(5, 5), dodge: true })
    }
  })

  it('is still allowed in a Blitz in v20', () => {
    expect(engine.legalCommands(marked(rulesV20, 'blitz'))).toContainEqual(disengage)
  })
})

describe('Out players back after two rounds (#177)', () => {
  /** Round `round`, with the Elf Lineman off the pitch since round `off`. */
  function withOut(config: RuleConfig, round: number, off: number, status: 'out' | 'standing' = 'out'): GameState {
    const state = at(config, { [BLITZER]: { col: 6, row: 5 }, 'away-lineman-2': { col: 12, row: 5 } })
    state.round = round
    const elf = state.players[ELF]!
    elf.hex = null
    elf.status = status
    elf.offInRound = off
    return state
  }
  const endRound = (state: GameState) => run(engine, state, wait, wait)

  it('comes back at the start of the second round after he went Out, placed in his own end zone', () => {
    const { state, events } = endRound(withOut(rulesV21, 2, 1))
    expect(events).toContainEqual({ type: 'roundStarted', half: 1, round: 3, firstGo: 'away' })
    expect(state.pending?.kind).toBe('round.returnPlayer')
    expect(state.pending?.team).toBe('away')
    const choices = state.pending!.choices
    expect(choices.length).toBeGreaterThan(0)
    for (const c of choices) expect(endZoneOf(c.hex!)).toBe(TEAM_SIDES.away)

    const back = run(engine, state, { type: 'decide', choice: choices[0]!.id })
    expect(back.events).toContainEqual({ type: 'playerReturned', playerId: ELF, hex: choices[0]!.hex })
    expect(back.state.players[ELF]).toMatchObject({ hex: choices[0]!.hex, status: 'standing', activatedThisRound: false })
    expect(back.state.players[ELF]!.offInRound).toBeUndefined()
    expect(back.state.pending).toBeNull()
    expect(back.state.turnOwner).toBe('away')
    // He can be activated that round.
    expect(engine.legalCommands(back.state)).toContainEqual({ type: 'activate', playerId: ELF, action: 'move' })
  })

  it('is not back after one round', () => {
    const { state } = endRound(withOut(rulesV21, 2, 2))
    expect(state.pending).toBeNull()
    expect(state.players[ELF]!.hex).toBeNull()
  })

  it('brings a player Stunned in the crowd back too', () => {
    const { state } = endRound(withOut(rulesV21, 3, 1, 'standing'))
    expect(state.pending?.kind).toBe('round.returnPlayer')
  })

  it('waits in v20, for the next kick-off', () => {
    const { state } = endRound(withOut(rulesV20, 2, 1))
    expect(state.pending).toBeNull()
    expect(state.players[ELF]!.hex).toBeNull()
  })

  it('records the round a player goes Out in', () => {
    // A Tackle on the Elf, then armour broken (red 10) and Out (white 8).
    const state = at(rulesV21, { [BLITZER]: { col: 6, row: 5 }, [ELF]: { col: 7, row: 5 } }, [9, 10, 8])
    state.round = 4
    const { state: after, events } = run(engine, state, { type: 'activate', playerId: BLITZER, action: 'block' }, { type: 'block', targetId: ELF })
    let current = after
    const all = [...events]
    while (current.pending) {
      const choice = current.pending.choices.find((c) => c.id === 'tackle' || c.id === 'noBrace' || c.id === 'stay') ?? current.pending.choices.at(-1)!
      const step = run(engine, current, { type: 'decide', choice: choice.id })
      current = step.state
      all.push(...step.events)
    }
    expect(all).toContainEqual({ type: 'injured', playerId: ELF, result: 'out' })
    expect(current.players[ELF]!.offInRound).toBe(4)
  })
})

