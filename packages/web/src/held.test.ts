import { apply, type Command, createMatch, fromColRow, type GameState, rulesV23 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { scoredPosition } from './held'

const BLITZER = 'home-blitzer-1'
const ELF = 'away-lineman-1'
const h = (col: number, row: number) => fromColRow({ col, row })

/** Round 2 of a v23 drive: the Orc Blitzer carries the ball two hexes from the Elves' end zone. */
function nearlyThere(): GameState {
  const state = createMatch(rulesV23, [rulesV23.rosters.orcs!, rulesV23.rosters.elves!], 1)
  state.players[BLITZER]!.hex = h(16, 5)
  state.players[ELF]!.hex = h(12, 9)
  for (const id of [BLITZER, ELF]) state.players[id]!.status = 'standing'
  Object.assign(state, { pending: null, phase: 'Round', round: 2, kickingTeam: 'away', openingKicker: 'away', firstGo: 'home', turnOwner: 'home' })
  state.ball = { hex: h(16, 5), carrier: BLITZER }
  return state
}

function run(state: GameState, commands: Command[]) {
  let before = state
  let result = apply(state, commands[0]!)
  for (const command of commands.slice(1)) {
    before = result.state
    result = apply(before, command)
  }
  return { before, ...result }
}

describe('scoredPosition: the moment of a touchdown, before the pitch is cleared', () => {
  it('shows the scorer in the end zone with the ball', () => {
    const { before, state, events } = run(nearlyThere(), [
      { type: 'activate', playerId: BLITZER, action: 'move' },
      { type: 'move', to: h(17, 5) },
      { type: 'move', to: h(18, 5) },
    ])
    // The engine has already cleared the pitch for the next drive.
    expect(events.map((e) => e.type)).toContain('touchdown')
    expect(state.players[BLITZER]!.hex).toBeNull()
    const held = scoredPosition(before, events)!
    expect(held.players[BLITZER]!.hex).toEqual(h(18, 5))
    expect(held.ball).toEqual({ hex: h(18, 5), carrier: BLITZER })
    expect(held.players[ELF]!.hex).toEqual(h(12, 9))
    // The position before is left alone.
    expect(before.players[BLITZER]!.hex).toEqual(h(17, 5))
  })

  it('is null for a command that scores nothing', () => {
    const state = nearlyThere()
    const { events } = apply(state, { type: 'activate', playerId: BLITZER, action: 'move' })
    expect(scoredPosition(state, events)).toBeNull()
  })
})
