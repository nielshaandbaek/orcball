import { availableCommands, createMatch, engine, fromColRow, type GameState, rulesV10 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { nextStep, targetHexes, tapHex } from './interaction'

const { orcs, elves } = rulesV10.rosters as Record<'orcs' | 'elves', (typeof rulesV10.rosters)[string]>
const h = (col: number, row: number) => fromColRow({ col, row })

/** A match past the coin toss with away kicking, so away sets up first in the right half. */
function setupState(): GameState {
  const state = createMatch(rulesV10, [orcs, elves], 1)
  const choice = state.pending!.team === 'away' ? 'kick' : 'receive'
  return engine.apply(state, { type: 'decide', choice }).state
}

describe('tapping during setup', () => {
  it('asks for a player first', () => {
    const state = setupState()
    expect(tapHex(state, availableCommands(state), null, h(12, 5))).toEqual({ message: 'Pick one of your players first' })
  })

  it('places the selected player on a legal hex', () => {
    const state = setupState()
    expect(tapHex(state, availableCommands(state), 'away-lineman-1', h(12, 5))).toEqual({
      command: { type: 'place', playerId: 'away-lineman-1', hex: h(12, 5) },
      select: null,
    })
  })

  it("shows the engine's reason for an illegal hex", () => {
    const state = setupState()
    expect(tapHex(state, availableCommands(state), 'away-lineman-1', h(5, 5))).toEqual({ message: 'Set up in your own half' })
    expect(tapHex(state, availableCommands(state), 'away-lineman-1', h(9, 4))).toEqual({ message: "Halfway hexes can't be used at setup" })
  })

  it('selects one of your players already on the pitch when tapped', () => {
    const state = engine.apply(setupState(), { type: 'place', playerId: 'away-lineman-1', hex: h(12, 5) }).state
    expect(tapHex(state, availableCommands(state), null, h(12, 5))).toEqual({ select: 'away-lineman-1' })
  })

  it('highlights exactly the hexes the engine allows for the selected player', () => {
    const state = setupState()
    const targets = targetHexes(state, availableCommands(state), 'away-lineman-1')
    expect(targets).toHaveLength(77)
    expect(targets).toContainEqual(h(10, 4))
    expect(targets).not.toContainEqual(h(9, 4))
  })
})

describe('tapping at kick-off and on decisions', () => {
  it('kicks at a hex in the receiving half, and explains anything else', () => {
    let state = setupState()
    for (const command of [
      { type: 'place', playerId: 'away-lineman-1', hex: h(12, 5) },
      { type: 'endSetup' },
      { type: 'place', playerId: 'home-lineman-1', hex: h(5, 5) },
      { type: 'endSetup' },
    ] as const) {
      state = engine.apply(state, command).state
    }
    const options = availableCommands(state)
    expect(tapHex(state, options, null, h(5, 3))).toEqual({ command: { type: 'kick', hex: h(5, 3) } })
    expect(tapHex(state, options, null, h(14, 3))).toEqual({ message: "Kick into the receiving team's half" })
    expect(targetHexes(state, options, null)).toHaveLength(77)
  })

  it('answers a pending decision whose choice is on the tapped hex', () => {
    const state = setupState()
    state.pending = {
      kind: 'kickOff.touchback',
      team: 'home',
      prompt: 'Touchback',
      choices: [{ id: 'home-lineman-1', label: 'Lineman', hex: h(5, 5) }],
      data: null,
    }
    expect(tapHex(state, [], null, h(5, 5))).toEqual({ command: { type: 'decide', choice: 'home-lineman-1' } })
    expect(tapHex(state, [], null, h(6, 5))).toEqual({ message: 'Touchback' })
  })
})

describe('tapping during play', () => {
  /** Round 1: an Orc Blitzer at (5,5) on the move, an Elf at (8,5). */
  function moving(): GameState {
    let state = setupState()
    for (const command of [
      { type: 'place', playerId: 'away-lineman-1', hex: h(10, 5) },
      { type: 'endSetup' },
      { type: 'place', playerId: 'home-blitzer-1', hex: h(5, 5) },
      { type: 'endSetup' },
    ] as const) {
      state = engine.apply(state, command).state
    }
    state = { ...state, phase: 'Round', round: 1, turnOwner: 'home', pending: null, ball: { hex: h(2, 2), carrier: null } }
    state.players['away-lineman-1']!.hex = h(8, 5)
    return engine.apply(state, { type: 'activate', playerId: 'home-blitzer-1', action: 'blitz' }).state
  }

  it('selects whichever player is tapped between activations', () => {
    const state = { ...moving(), phase: 'Round' as const, activation: null }
    expect(tapHex(state, availableCommands(state), null, h(5, 5))).toEqual({ select: 'home-blitzer-1' })
    expect(tapHex(state, availableCommands(state), 'home-blitzer-1', h(3, 3))).toEqual({ select: null })
  })

  it('turns a tap on a reachable hex into the path to walk', () => {
    const state = moving()
    const { path } = tapHex(state, availableCommands(state), 'home-blitzer-1', h(6, 4))
    expect(path).toHaveLength(2)
    expect(path!.at(-1)).toEqual(h(6, 4))
  })

  it('blocks an adjacent opponent that is tapped', () => {
    const state = moving()
    state.players['home-blitzer-1']!.hex = h(7, 5)
    expect(tapHex(state, availableCommands(state), 'home-blitzer-1', h(8, 5))).toEqual({
      command: { type: 'block', targetId: 'away-lineman-1' },
    })
  })

  it('says so when a hex is out of reach', () => {
    const state = moving()
    expect(tapHex(state, availableCommands(state), 'home-blitzer-1', h(16, 1))).toEqual({
      message: "Can't reach that hex this activation",
    })
  })

  it('picks a Dodge to keep going through a tackle zone, with stopping as the alternative', () => {
    const state = moving()
    const options = availableCommands(state)
    // (7,5) is next to the Elf; with more path to go, the step is a Dodge.
    state.players['home-blitzer-1']!.hex = h(6, 5)
    const opts = availableCommands(state)
    expect(nextStep(opts, h(7, 5), true)).toEqual({
      command: { type: 'move', to: h(7, 5), dodge: true },
      stopInstead: { type: 'move', to: h(7, 5) },
    })
    expect(nextStep(opts, h(7, 5), false)).toEqual({ command: { type: 'move', to: h(7, 5) }, stopInstead: null })
    expect(nextStep(options, h(12, 5), false)).toBeNull()
  })
})
