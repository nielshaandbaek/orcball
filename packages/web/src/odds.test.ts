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
      lines: ['Block: ST 3 against 3', 'With Brace: Shove (N/A), Tackle (50%)'],
      previews: [expect.objectContaining({ test: 'Tackle', chance: 0.6 }), expect.objectContaining({ test: 'Tackle if he Braces', chance: 0.5 })],
      choices: [
        { id: 'shove', label: 'Shove (100%)' },
        { id: 'tackle', label: 'Tackle (60%)' },
      ],
    })
  })

  it('says a Frenzied attacker blocks again if the defender stays up (#213)', () => {
    const state = round()
    state.players[BLITZER]!.skills = ['Frenzy']
    state.players[ELF]!.activatedThisRound = true
    const active = apply(state, { type: 'activate', playerId: BLITZER, action: 'block' }).state
    expect(declaredOdds(active, { type: 'block', targetId: ELF })?.lines).toEqual(['Block: ST 3 against 3', 'Frenzy: blocks again if he stays up'])
  })

  it('says a carrier with Dump-Off may pass the ball first (#225)', () => {
    const state = round()
    state.players[ELF]!.skills = ['Dump-Off']
    state.players[ELF]!.activatedThisRound = true
    state.players['away-catcher-1']!.hex = fromColRow({ col: 8, row: 5 })
    state.ball = { hex: state.players[ELF]!.hex, carrier: ELF }
    const active = apply(state, { type: 'activate', playerId: BLITZER, action: 'block' }).state
    expect(declaredOdds(active, { type: 'block', targetId: ELF })?.lines).toEqual(['Block: ST 3 against 3', 'Dump-Off: he may pass the ball first'])
    // Nobody within 3 hexes: nothing to say.
    active.players['away-catcher-1']!.hex = fromColRow({ col: 12, row: 5 })
    expect(declaredOdds(active, { type: 'block', targetId: ELF })?.lines).toEqual(['Block: ST 3 against 3'])
  })

  it('leaves out the Brace line when the defender can no longer Brace', () => {
    const state = activated(BLITZER, 'block')
    state.players[ELF]!.activatedThisRound = true
    expect(declaredOdds(state, { type: 'block', targetId: ELF })?.lines).toEqual(['Block: ST 3 against 3'])
  })

  it('gives a foul the chance of the fouler being ejected, and the armour chance on its button', () => {
    expect(declaredOdds(activated(ORC, 'foul'), { type: 'foul', targetId: ELF2 })).toEqual({
      label: 'Foul',
      lines: ['Foul: Ejected (20%)'],
      previews: [{ test: 'Armour', target: 7, modifiers: [], chance: 0.4 }],
      button: 'Foul (40%)',
    })
  })

  it('has nothing for other commands, or a block he can’t make', () => {
    const state = activated(BLITZER, 'block')
    expect(declaredOdds(state, { type: 'block', targetId: ELF2 })).toBeNull()
    expect(declaredOdds(activated(BLITZER, 'move'), { type: 'move', to: fromColRow({ col: 4, row: 5 }) })).toBeNull()
  })
})
