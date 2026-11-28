import { describe, expect, it } from 'vitest'
import { rulesV32Opposed } from '../config'
import { createEngine } from '../engine'
import { previewBlock } from './blocking'
import type { Command, GameEvent, GameState } from '../state'
import { RULE_MODULES } from '.'
import { run, scene } from './test-helpers'

// TRIAL (#297): the Tackle as an opposed roll.

const engine = createEngine(RULE_MODULES)
const ORC = 'home-black-orc-1'
const ELF = 'away-lineman-1'
const FAR_ELF = 'away-thrower-1'

function opposed(faces: number[], { st = 3, elfSt = 3, skills = [] as string[], elfSkills = [] as string[], momentum = 0 } = {}): GameState {
  const state = scene({ [ORC]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, [FAR_ELF]: { col: 16, row: 8 } }, faces)
  state.config = rulesV32Opposed
  state.teams.home.momentum = momentum
  state.teams.away.momentum = 0
  Object.assign(state.players[ORC]!, { st, skills })
  Object.assign(state.players[ELF]!, { st: elfSt, skills: elfSkills })
  return run(engine, state, { type: 'activate', playerId: ORC, action: 'block' }).state
}
const decide = (choice: string): Command => ({ type: 'decide', choice })
const tackle = (state: GameState, ...more: Command[]) => run(engine, state, { type: 'block', targetId: ELF }, decide('tackle'), ...more)
const rolled = (list: GameEvent[]) => list.filter((e) => e.type === 'rolled')

describe('the opposed Tackle (#297)', () => {
  it('the attacker wins on a higher total, and on a tie', () => {
    for (const faces of [[7, 5], [5, 5]]) {
      const { events } = tackle(opposed(faces))
      expect(rolled(events)).toEqual([expect.objectContaining({ test: 'Tackle', success: true, opposed: { attacker: [faces[0]], defender: [faces[1]], outcome: 'success' } })])
    }
  })

  it("a natural 1 knocks the attacker down, whatever the defender rolls", () => {
    const { events } = tackle(opposed([1, 1, 2, 2]))
    expect(rolled(events)[0]).toMatchObject({ success: false, opposed: { outcome: 'attackerDown' } })
    expect(events).toContainEqual({ type: 'knockedDown', playerId: ORC })
  })

  it('a defender total of 10 knocks down an attacker under 10; Block on a 9 makes it 10 and a tie', () => {
    const plain = tackle(opposed([9, 10, 2, 2]))
    expect(plain.events).toContainEqual({ type: 'knockedDown', playerId: ORC })
    const block = tackle(opposed([9, 10], { skills: ['Block'] }))
    expect(rolled(block.events)[0]).toMatchObject({ success: true, opposed: { outcome: 'success' } })
  })

  it('Brace counts for the 10: a braced 9 knocks down an attacker under 10', () => {
    const { events } = run(engine, opposed([9, 9, 2, 2], { elfSkills: ['Brace'] }), { type: 'block', targetId: ELF }, decide('brace'), decide('tackle'))
    expect(rolled(events)[0]).toMatchObject({ target: 10, opposed: { outcome: 'attackerDown' } })
    expect(events).toContainEqual({ type: 'knockedDown', playerId: ORC })
  })

  it('when the defender wins he chooses both down or nothing; against Block nothing happens', () => {
    expect(tackle(opposed([4, 6])).state.pending?.kind).toBe('blocking.missChoice')
    const block = tackle(opposed([4, 6], { skills: ['Block'] }))
    expect(block.state.pending).toBeNull()
    expect(block.events.filter((e) => e.type === 'knockedDown')).toEqual([])
    expect(block.events).toContainEqual(expect.objectContaining({ type: 'activationEnded', failed: false }))
  })

  it('the stronger side rolls 2 dice, more than twice as strong 3, and keeps the highest', () => {
    const two = tackle(opposed([2, 8, 7], { st: 4 }))
    expect(rolled(two.events)[0]).toMatchObject({ natural: 8, opposed: { attacker: [2, 8], defender: [7], outcome: 'success' } })
    const three = tackle(opposed([2, 3, 4, 5], { st: 7 }))
    expect(rolled(three.events)[0]).toMatchObject({ opposed: { attacker: [2, 3, 4], defender: [5] } })
    const twiceIsNotMore = tackle(opposed([2, 3, 5], { st: 6 }))
    expect(rolled(twiceIsNotMore.events)[0]).toMatchObject({ opposed: { attacker: [2, 3], defender: [5] } })
    const defender = tackle(opposed([6, 2, 7], { elfSt: 4 }))
    expect(rolled(defender.events)[0]).toMatchObject({ opposed: { attacker: [6], defender: [2, 7], outcome: 'defenderWins' } })
  })

  it("Brace doesn't count as Strength for the dice", () => {
    const { events } = run(engine, opposed([5, 5, 3], { st: 4, elfSt: 3, elfSkills: ['Brace'] }), { type: 'block', targetId: ELF }, decide('brace'), decide('tackle'))
    expect(rolled(events)[0]).toMatchObject({ opposed: { attacker: [5, 5], defender: [3] } })
  })

  it('a Momentum re-roll rolls both sides again', () => {
    const missed = tackle(opposed([3, 6, 8, 2], { momentum: 1 }))
    expect(missed.state.pending?.kind).toBe('blocking.tackle')
    const again = run(engine, missed.state, decide('reroll'))
    expect(rolled(again.events)).toEqual([expect.objectContaining({ success: true, opposed: { attacker: [8], defender: [2], outcome: 'success' } })])
    expect(again.state.teams.home.momentum).toBe(0)
    const accepted = run(engine, missed.state, decide('accept'))
    expect(accepted.state.pending?.kind).toBe('blocking.missChoice')
  })

  it('previews the exact chances, with the outcomes for the search', () => {
    const chance = (opts: Parameters<typeof opposed>[1]) => previewBlock(opposed([], opts), ELF)!
    expect(chance({}).tackle.chance).toBeCloseTo(0.54)
    expect(chance({ skills: ['Block'] }).tackle.chance).toBeCloseTo(0.62)
    expect(chance({ elfSkills: ['Brace'] }).braced!.tackle.chance).toBeCloseTo(0.45)
    expect(chance({ st: 4 }).tackle.chance).toBeCloseTo(0.714)
    expect(chance({ elfSt: 7 }).tackle.chance).toBeCloseTo(0.302)
    const branches = chance({}).tackle.branches!
    expect(branches.reduce((s, b) => s + b.p, 0)).toBeCloseTo(1)
    expect(Object.fromEntries(branches.map((b) => [b.outcome, Number(b.p.toFixed(2))]))).toEqual({ attackerDown: 0.18, success: 0.54, defenderWins: 0.28 })
  })
})
