import { availableCommands, createMatch, engine, fromColRow, type Command, type GameState, hexEquals, reachableHexes, rulesV10, rulesV19, stepKinds } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { canStep, nextStep, routeFrom, routeTo, setupSelection, targetHexes, tapHex } from './interaction'

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

describe('the setup selection (#151)', () => {
  const bench = (state: GameState) => Object.values(state.players).filter((p) => p.team === state.turnOwner && p.hex === null).map((p) => p.id)
  const place = (state: GameState, playerId: string, col: number, row: number) => engine.apply(state, { type: 'place', playerId, hex: h(col, row) }).state

  it('is the first player on the bench when a team starts its setup', () => {
    const state = setupState()
    expect(setupSelection(state, availableCommands(state), null)).toBe(bench(state)[0])
  })

  it('moves on to the next player on the bench after a placement, whoever was placed', () => {
    let state = setupState()
    const [first, second, third] = bench(state)
    state = place(state, first!, 12, 5)
    expect(setupSelection(state, availableCommands(state), null)).toBe(second)
    // Picked by hand out of order: the selection goes back to the first still on the bench.
    state = place(state, third!, 12, 3)
    expect(setupSelection(state, availableCommands(state), null)).toBe(second)
  })

  it('is nobody once the team is full', () => {
    let state = setupState()
    const ids = bench(state)
    const hexes = [[12, 1], [12, 3], [12, 5], [12, 7], [12, 9], [14, 3], [14, 5]]
    for (const [i, [col, row]] of hexes.entries()) state = place(state, ids[i]!, col!, row!)
    expect(setupSelection(state, availableCommands(state), null)).toBeNull()
  })

  it("is nobody during the computer's setup, or outside setup", () => {
    const state = setupState()
    expect(setupSelection(state, availableCommands(state), state.turnOwner)).toBeNull()
    const start = createMatch(rulesV10, [orcs, elves], 1)
    expect(setupSelection(start, availableCommands(start), null)).toBeNull()
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

  it('on touch, shows the path on the first tap and moves on the second (#113)', () => {
    const state = moving()
    const options = availableCommands(state)
    const first = tapHex(state, options, 'home-blitzer-1', h(6, 4), null, { touch: true, previewed: null })
    expect(first).toEqual({ preview: h(6, 4), message: 'Tap the hex again to move there' })
    // Another hex shows that hex's path instead.
    expect(tapHex(state, options, 'home-blitzer-1', h(4, 5), null, { touch: true, previewed: h(6, 4) }).preview).toEqual(h(4, 5))
    const second = tapHex(state, options, 'home-blitzer-1', h(6, 4), null, { touch: true, previewed: h(6, 4) })
    expect(second.path!.at(-1)).toEqual(h(6, 4))
    // A mouse click moves at once.
    expect(tapHex(state, options, 'home-blitzer-1', h(6, 4)).path).toEqual(second.path)
  })

  it("draws the route along the engine's path, from where the player stands (#113)", () => {
    const state = moving()
    const route = routeTo(state, h(9, 3))!
    const reach = reachableHexes(state, 'home-blitzer-1').find((r) => hexEquals(r.hex, h(9, 3)))!
    expect(route.hexes).toEqual([h(5, 5), ...reach.path])
    expect(route.steps).toEqual(stepKinds(reach))
    // Part-way along, only the rest is shown; at the end, nothing.
    expect(routeFrom(route, reach.path[0]!)!.hexes).toEqual(reach.path)
    expect(routeFrom(route, h(9, 3))).toBeNull()
    expect(routeTo(state, h(16, 1))).toBeNull()
  })

  it('neither moves nor shows a path on an action that doesn’t move, such as Block', () => {
    let state = moving()
    state = { ...state, activation: { ...state.activation!, action: 'block' } }
    const options = availableCommands(state)
    expect(canStep(options)).toBe(false)
    expect(tapHex(state, options, 'home-blitzer-1', h(6, 4), null, { touch: true, previewed: null })).toEqual({
      message: 'This action doesn’t move the player',
    })
    expect(canStep(availableCommands(moving()))).toBe(true)
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

describe('stepping with the Strength Disengage (v11)', () => {
  const to = h(5, 5)
  const opts = [
    { command: { type: 'move', to, dodge: true }, available: true },
    { command: { type: 'move', to, disengage: true }, available: true },
  ] as const satisfies readonly { command: Command; available: true }[]

  it('takes the Disengage, with no roll, when the path ends there', () => {
    expect(nextStep([...opts], to, false)).toEqual({ command: { type: 'move', to, disengage: true }, stopInstead: null })
  })

  it('Dodges to go further, with the Disengage as the way to stop', () => {
    expect(nextStep([...opts], to, true)).toEqual({
      command: { type: 'move', to, dodge: true },
      stopInstead: { type: 'move', to, disengage: true },
    })
  })
})

// #154: with the Leap button on, a tap on a hex 2 away in a straight line leaps there; nothing else does.
describe('tapping with the Leap button on (v19)', () => {
  function dancerActivated(): GameState {
    const state = createMatch(rulesV19, [rulesV19.rosters.orcs!, rulesV19.rosters.elves!], 1)
    for (const p of Object.values(state.players)) p.hex = null
    state.players['away-dancer-1']!.hex = h(10, 5)
    state.players['home-lineman-1']!.hex = h(9, 5)
    for (const id of ['away-dancer-1', 'home-lineman-1']) state.players[id]!.status = 'standing'
    Object.assign(state, { pending: null, phase: 'Round', round: 1, kickingTeam: 'home', openingKicker: 'home', firstGo: 'away', turnOwner: 'away' })
    return engine.apply(state, { type: 'activate', playerId: 'away-dancer-1', action: 'move' }).state
  }

  it('leaps over the Orc to the hex past him', () => {
    const state = dancerActivated()
    expect(tapHex(state, availableCommands(state), 'away-dancer-1', h(8, 5), 'leap')).toEqual({ command: { type: 'leap', to: h(8, 5) } })
  })

  it('says where he can leap on any other hex, and walks as usual with the button off', () => {
    const state = dancerActivated()
    expect(tapHex(state, availableCommands(state), 'away-dancer-1', h(11, 5), 'leap').message).toMatch(/2 away in a straight line/)
    expect(tapHex(state, availableCommands(state), 'away-dancer-1', h(11, 5))).toMatchObject({ path: [h(11, 5)] })
  })
})
