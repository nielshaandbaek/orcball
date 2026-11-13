import { apply, createMatch, fromColRow, type GameState, rulesV18 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { blitzBadge } from './blitz'

const BLITZER = 'home-blitzer-1'

/** Round 1 of a v18 match, Orcs to go, the Blitzer on the pitch. */
function round(): GameState {
  const state = createMatch(rulesV18, [rulesV18.rosters.orcs!, rulesV18.rosters.elves!], 1)
  state.players[BLITZER]!.hex = fromColRow({ col: 5, row: 5 })
  state.players['away-lineman-1']!.hex = fromColRow({ col: 14, row: 5 })
  Object.assign(state, { pending: null, phase: 'Round', round: 1, kickingTeam: 'away', openingKicker: 'away', firstGo: 'home', turnOwner: 'home' })
  return state
}

describe('blitzBadge', () => {
  it('shows both teams can Blitz at the start of a round', () => {
    const state = round()
    expect(blitzBadge(state, 'home')).toEqual({ left: true, label: 'Orcs can still Blitz this round' })
    expect(blitzBadge(state, 'away')).toEqual({ left: true, label: 'Elves can still Blitz this round' })
  })

  it("greys a team's badge as soon as it declares its Blitz, not the other team's", () => {
    const { state } = apply(round(), { type: 'activate', playerId: BLITZER, action: 'blitz' })
    expect(blitzBadge(state, 'home')).toEqual({ left: false, label: 'Orcs have Blitzed this round' })
    expect(blitzBadge(state, 'away')?.left).toBe(true)
  })

  it('is hidden outside a round', () => {
    const state = createMatch(rulesV18, [rulesV18.rosters.orcs!, rulesV18.rosters.elves!], 1)
    expect(blitzBadge(state, 'home')).toBeNull()
  })
})
