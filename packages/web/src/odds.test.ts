import { apply, createMatch, fromColRow, type GameState, rulesV21 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { declaredOdds } from './odds'

const BLITZER = 'home-blitzer-1' // ST 3, Block
const ORC = 'home-lineman-1'
const ELF = 'away-lineman-1' // ST 3, TO 7, Brace
const ELF2 = 'away-lineman-2'

/** Round 1 of a v21 match, Orcs to go: the Blitzer next to an Elf Lineman, an Orc Lineman next to a prone Elf. */
function round(): GameState {
  const state = createMatch(rulesV21, [rulesV21.rosters.orcs!, rulesV21.rosters.elves!], 1)
  state.players[BLITZER]!.hex = fromColRow({ col: 5, row: 5 })
  state.players[ELF]!.hex = fromColRow({ col: 6, row: 5 })
  state.players[ORC]!.hex = fromColRow({ col: 5, row: 9 })
  state.players[ELF2]!.hex = fromColRow({ col: 6, row: 9 })
  state.players[ELF2]!.status = 'prone'
  Object.assign(state, { pending: null, phase: 'Round', round: 1, kickingTeam: 'away', openingKicker: 'away', firstGo: 'home', turnOwner: 'home' })
  return state
}

const activated = (playerId: string, action: 'block' | 'foul' | 'move') => apply(round(), { type: 'activate', playerId, action }).state

describe('declaredOdds (#180)', () => {
  it('gives a block its totals and Tackle chance, and the same if the defender Braces', () => {
    expect(declaredOdds(activated(BLITZER, 'block'), { type: 'block', targetId: ELF })).toEqual({
      label: 'Block',
      lines: ['3 against 3: Shove, or Tackle 60%', 'If he Braces, 3 against 4: too weak to Shove, Tackle 50%'],
      previews: [expect.objectContaining({ test: 'Tackle', chance: 0.6 }), expect.objectContaining({ test: 'Tackle if he Braces', chance: 0.5 })],
    })
  })

  it('leaves out the Brace line when the defender can no longer Brace', () => {
    const state = activated(BLITZER, 'block')
    state.players[ELF]!.activatedThisRound = true
    expect(declaredOdds(state, { type: 'block', targetId: ELF })?.lines).toEqual(['3 against 3: Shove, or Tackle 60%'])
  })

  it('gives a foul the armour chance and the chance of the fouler being ejected', () => {
    expect(declaredOdds(activated(ORC, 'foul'), { type: 'foul', targetId: ELF2 })).toEqual({
      label: 'Foul',
      lines: ['Armour 7+ · 40%', 'Fouler ejected 20%'],
      previews: [{ test: 'Armour', target: 7, modifiers: [], chance: 0.4 }],
    })
  })

  it('has nothing for other commands, or a block he can’t make', () => {
    const state = activated(BLITZER, 'block')
    expect(declaredOdds(state, { type: 'block', targetId: ELF2 })).toBeNull()
    expect(declaredOdds(activated(BLITZER, 'move'), { type: 'move', to: fromColRow({ col: 4, row: 5 }) })).toBeNull()
  })
})
