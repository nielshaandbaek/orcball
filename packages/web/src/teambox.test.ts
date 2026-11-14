import { apply, createMatch, fromColRow, type GameState, rulesV20 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { teamBox } from './teambox'

const BLITZER = 'home-blitzer-1'
const ORC = 'home-lineman-1'

/** Round 1 of a v20 match, Orcs to go, two Orcs and an Elf on the pitch. */
function round(): GameState {
  const state = createMatch(rulesV20, [rulesV20.rosters.orcs!, rulesV20.rosters.elves!], 1)
  state.players[BLITZER]!.hex = fromColRow({ col: 5, row: 5 })
  state.players[ORC]!.hex = fromColRow({ col: 5, row: 7 })
  state.players['away-lineman-1']!.hex = fromColRow({ col: 14, row: 5 })
  Object.assign(state, { pending: null, phase: 'Round', round: 1, kickingTeam: 'away', openingKicker: 'away', firstGo: 'home', turnOwner: 'home' })
  return state
}

describe('teamBox (#178, #172)', () => {
  it('shows both teams at the start of a round: players left, the Blitz unused, whose go it is', () => {
    const state = round()
    expect(teamBox(state, 'home')).toEqual({ name: 'Orcs', onGo: true, left: 2, blitz: true, double: 0, label: 'Orcs’ go: 2 players left to activate, Blitz unused' })
    expect(teamBox(state, 'away')).toEqual({ name: 'Elves', onGo: false, left: 1, blitz: true, double: 0, label: 'Elves: 1 player left to activate, Blitz unused' })
  })

  it('takes the bolt away as soon as the team declares its Blitz, and counts the Blitzer until he is done', () => {
    const { state } = apply(round(), { type: 'activate', playerId: BLITZER, action: 'blitz' })
    expect(teamBox(state, 'home')).toMatchObject({ left: 2, blitz: false })
    expect(teamBox(state, 'away')).toMatchObject({ blitz: true })
  })

  it('shows a double activation in the box of the team that has it', () => {
    const state = round()
    state.doubleActivation = { team: 'away', left: 1 }
    expect(teamBox(state, 'away')).toMatchObject({ double: 1, label: 'Elves: 1 player left to activate, Blitz unused, double activation (one more)' })
    expect(teamBox(state, 'home')?.double).toBe(0)
  })

  it('shows no bolt with no players left', () => {
    const state = round()
    state.players['away-lineman-1']!.activatedThisRound = true
    expect(teamBox(state, 'away')).toMatchObject({ left: 0, blitz: false, label: 'Elves: 0 players left to activate' })
  })

  it('is hidden outside a round', () => {
    const state = createMatch(rulesV20, [rulesV20.rosters.orcs!, rulesV20.rosters.elves!], 1)
    expect(teamBox(state, 'home')).toBeNull()
  })
})
