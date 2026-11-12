import { apply, type Command, createMatch, forcedRng, fromColRow, type GameState, rulesV16, seededRng } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { type EventIconAt, eventIconsOf } from './effects'

const BLITZER = 'home-blitzer-1'
const THROWER = 'home-thrower-1'
const ELF = 'away-thrower-1'
const CATCHER = 'away-catcher-1'

/** Round 1 of a v16 match, Orcs to go, no Momentum (so no re-roll offers), these players only, the dice forced. */
function scene(placements: Record<string, [number, number]>, faces: number[], carrier?: string): GameState {
  const state = createMatch(rulesV16, [rulesV16.rosters.orcs!, rulesV16.rosters.elves!], 1)
  for (const [id, [col, row]] of Object.entries(placements)) {
    state.players[id]!.hex = fromColRow({ col, row })
    state.players[id]!.status = 'standing'
  }
  Object.assign(state, { pending: null, phase: 'Round', round: 1, kickingTeam: 'away', openingKicker: 'away', firstGo: 'home', turnOwner: 'home' })
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  if (carrier) state.ball = { hex: state.players[carrier]!.hex, carrier }
  state.rng = forcedRng(faces, seededRng(7))
  return state
}

/** Send the commands, answering any other decision with its first choice, and collect every event icon on the way. */
function play(state: GameState, commands: Command[]): EventIconAt[] {
  const icons: EventIconAt[] = []
  const send = (command: Command) => {
    const { state: after, events } = apply(state, command)
    icons.push(...eventIconsOf(state, command, events, after))
    state = after
  }
  for (const command of commands) send(command)
  for (let n = 0; state.pending && n < 10; n++) send({ type: 'decide', choice: state.pending.choices[0]!.id })
  return icons
}

const iconsOf = (icons: EventIconAt[]) => icons.map(({ playerId, icon }) => `${playerId}:${icon}`)

describe('eventIconsOf', () => {
  // The Blitzer (ST 3, Block) next to the Elf Thrower (ST 3, no skills): a Tackle needs 6+, +1 for Block.
  const block = (faces: number[]) => scene({ [BLITZER]: [8, 5], [ELF]: [9, 5] }, faces)
  const blocking: Command[] = [
    { type: 'activate', playerId: BLITZER, action: 'block' },
    { type: 'block', targetId: ELF },
  ]

  it('puts POW! over a defender a Tackle knocks down', () => {
    const icons = play(block([9, 1, 1]), [...blocking, { type: 'decide', choice: 'tackle' }])
    expect(iconsOf(icons)).toEqual([`${ELF}:pow`])
  })

  it('puts a skull over an attacker who rolls a natural 1 on a Tackle', () => {
    const icons = play(block([1, 1, 1]), [...blocking, { type: 'decide', choice: 'tackle' }])
    expect(iconsOf(icons)).toEqual([`${BLITZER}:skull`])
  })

  it('puts both-down over both players when a missed Tackle brings both down', () => {
    // The Elf coach's choice on a missed Tackle comes first: both down.
    const icons = play(block([3, 1, 1, 1, 1]), [...blocking, { type: 'decide', choice: 'tackle' }, { type: 'decide', choice: 'bothDown' }])
    expect(iconsOf(icons).sort()).toEqual([`${ELF}:both-down`, `${BLITZER}:both-down`])
  })

  it('shows the Shove over the defender pushed', () => {
    const icons = play(block([]), [...blocking, { type: 'decide', choice: 'shove' }])
    expect(iconsOf(icons)).toEqual([`${ELF}:shove`])
    expect(icons[0]!.hex).toEqual(fromColRow({ col: 9, row: 5 }))
  })

  it('shows fumble over a thrower who fumbles', () => {
    const state = scene({ [THROWER]: [5, 5], [BLITZER]: [9, 5] }, [1, 1, 1, 1], THROWER)
    const icons = play(state, [
      { type: 'activate', playerId: THROWER, action: 'pass' },
      { type: 'pass', target: fromColRow({ col: 9, row: 5 }) },
    ])
    expect(iconsOf(icons)).toContain(`${THROWER}:fumble`)
  })

  it('shows fumble over a player who drops a hand-off', () => {
    // The Elf next to the receiver makes the catch a roll; a 1 drops it.
    const state = scene({ [THROWER]: [5, 5], [BLITZER]: [6, 5], [ELF]: [7, 5] }, [1, 1, 1, 1], THROWER)
    const icons = play(state, [
      { type: 'activate', playerId: THROWER, action: 'handOff' },
      { type: 'handOff', targetId: BLITZER },
    ])
    expect(iconsOf(icons)).toContain(`${BLITZER}:fumble`)
  })

  it('shows stumble over a player who fails a Dodge', () => {
    // The Catcher, Elves to go, steps out of the Blitzer's tackle zone and rolls a 1.
    const state = scene({ [BLITZER]: [8, 5], [CATCHER]: [9, 5] }, [1, 1, 1, 1])
    state.turnOwner = 'away'
    state.firstGo = 'away'
    const icons = play(state, [
      { type: 'activate', playerId: CATCHER, action: 'move' },
      { type: 'move', to: fromColRow({ col: 10, row: 5 }), dodge: true },
    ])
    expect(iconsOf(icons)).toEqual([`${CATCHER}:stumble`])
  })

  it('waits while a failed roll can still be re-rolled with Momentum', () => {
    let state = block([3])
    state.teams.home.momentum = 2
    for (const command of blocking) state = apply(state, command).state
    const tackle: Command = { type: 'decide', choice: 'tackle' }
    const { state: after, events } = apply(state, tackle)
    expect(after.pending?.choices.map((c) => c.id)).toContain('reroll')
    expect(eventIconsOf(state, tackle, events, after)).toEqual([])
  })

  // #140: with Momentum the natural 1 waits on the re-roll offer, so the knock-down comes with the answer.
  describe('a natural 1 on a Tackle, with Momentum to re-roll', () => {
    const withMomentum = (faces: number[]) => {
      const state = block(faces)
      state.teams.home.momentum = 2
      return state
    }
    const tackle: Command = { type: 'decide', choice: 'tackle' }

    it('puts a skull over the attacker when the coach accepts it', () => {
      const icons = play(withMomentum([1, 1, 1]), [...blocking, tackle, { type: 'decide', choice: 'accept' }])
      expect(iconsOf(icons)).toEqual([`${BLITZER}:skull`])
    })

    it('puts a skull over the attacker when the re-roll is a natural 1 too', () => {
      const icons = play(withMomentum([3, 1, 1, 1]), [...blocking, tackle, { type: 'decide', choice: 'reroll' }])
      expect(iconsOf(icons)).toEqual([`${BLITZER}:skull`])
    })

    it('puts no skull when the natural 1 is re-rolled into a miss and both go down', () => {
      const icons = play(withMomentum([1, 3, 1, 1, 1, 1]), [...blocking, tackle, { type: 'decide', choice: 'reroll' }, { type: 'decide', choice: 'bothDown' }])
      expect(iconsOf(icons)).toEqual([`${BLITZER}:both-down`, `${ELF}:both-down`])
    })
  })
})
