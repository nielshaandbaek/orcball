import { describe, expect, it } from 'vitest'
import { chooseCommand } from './choose'
import { evaluate } from './evaluate'
import { scene } from './test-helpers'
import { viewOf } from './view'

// Momentum on double activations (#206), behind the momentumDoubles option.

const ORC = 'home-lineman-1'
const ORC2 = 'home-lineman-2'
const ELF = 'away-lineman-1'
const ELF2 = 'away-lineman-2'

/** Two Orcs, each next to an Elf it can knock down; the Orcs to go with a token, in `round`. */
function twoBlocks(round: number) {
  const state = scene({ [ORC]: { col: 6, row: 3 }, [ELF]: { col: 7, row: 3 }, [ORC2]: { col: 6, row: 7 }, [ELF2]: { col: 7, row: 7 } })
  state.round = round
  // The Elves have had their go this round, so they can't Brace: a block's worth shows one ply deep.
  state.players[ELF]!.activatedThisRound = true
  state.players[ELF2]!.activatedThisRound = true
  state.teams.home.momentum = 1
  state.teams.away.momentum = 0
  return viewOf(state)
}

describe('a token in the drive\'s last round (#206)', () => {
  it('is worth nothing with the option, as it\'s lost at the drive\'s end', () => {
    const last = twoBlocks(4)
    const withToken = evaluate(last, 'home', undefined, { tokensLapse: true }).contributions.momentum
    expect(withToken).toBe(0)
    // Before the last round, and without the option, a token counts as before.
    expect(evaluate(twoBlocks(2), 'home', undefined, { tokensLapse: true }).contributions.momentum).toBeGreaterThan(0)
    expect(evaluate(last, 'home').contributions.momentum).toBeGreaterThan(0)
  })
})

describe('Novice doubles when its two best plans both gain more than a token is worth (#206)', () => {
  it('two blocks to make in the last round: it spends the token', () => {
    const choice = chooseCommand(twoBlocks(4), 'home', { level: 'novice', budgetMs: 2_000, seed: 1, momentumDoubles: true })
    expect(choice.command).toEqual({ type: 'spendMomentum', use: 'double' })
    expect(choice.reason).toBe('Spends Momentum on a double activation')
  })

  it('one block worth making and nothing else: it keeps the token', () => {
    const view = twoBlocks(2)
    const state = { ...view, players: { ...view.players, [ELF2]: { ...view.players[ELF2]!, hex: null } } }
    const choice = chooseCommand(state, 'home', { level: 'novice', budgetMs: 2_000, seed: 1, momentumDoubles: true })
    expect(choice.command.type).not.toBe('spendMomentum')
  })

  it('never without the option', () => {
    const choice = chooseCommand(twoBlocks(4), 'home', { level: 'novice', budgetMs: 2_000, seed: 1 })
    expect(choice.command.type).not.toBe('spendMomentum')
  })
})

describe('Intermediate weighs a double as the token and the two activations it buys (#206)', () => {
  it('two blocks to make in the last round: it doubles', { timeout: 120_000 }, () => {
    const choice = chooseCommand(twoBlocks(4), 'home', { level: 'intermediate', lookahead: 'goes', budgetMs: 20_000, seed: 1, momentumDoubles: true })
    expect(choice.command).toEqual({ type: 'spendMomentum', use: 'double' })
  })

  it('never without the option', { timeout: 120_000 }, () => {
    const choice = chooseCommand(twoBlocks(4), 'home', { level: 'intermediate', lookahead: 'goes', budgetMs: 20_000, seed: 1 })
    expect(choice.command.type).not.toBe('spendMomentum')
  })
})
