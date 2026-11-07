import { apply, createMatch, legalCommands, rulesV12, seededRng } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { chooseCommand, generatePlans, planReason, Search, viewOf } from '.'
import { elves, orcs, scene } from './test-helpers'

// The computer's reasons in plain words (#61): what it does, what for, and the
// odds of the rolls it needs.

const BLITZER = 'home-blitzer-1'
const THROWER = 'home-thrower-1'
const ELF = 'away-lineman-1'
const options = { level: 'novice' as const, budgetMs: 10_000, seed: 1 }
const reasonOf = (state: ReturnType<typeof scene>, team: 'home' | 'away' = 'home') => chooseCommand(viewOf(state), team, options)

describe('reasons', () => {
  it('for a move that scores', () => {
    const state = scene({ [BLITZER]: { col: 17, row: 5 }, [ELF]: { col: 3, row: 3 } }, { carrier: BLITZER })
    expect(reasonOf(state).reason).toBe('Blitzer 1 moves to (18, 5) to score')
  })

  it('for a move to pick up the ball', () => {
    // An unmarked pick-up shows no odds on the board, so the reason doesn't either.
    const state = scene({ [BLITZER]: { col: 8, row: 5 }, [ELF]: { col: 15, row: 3 } }, { ball: { col: 11, row: 5 } })
    expect(reasonOf(state).reason).toMatch(/^Blitzer 1 moves to \(\d+, \d+\) to get the ball( and open a way to the end zone)?$/)
  })

  it('for a move with Dodges and a marked pick-up, with their odds', () => {
    const state = scene({ [BLITZER]: { col: 8, row: 5 }, [ELF]: { col: 12, row: 5 }, 'away-lineman-2': { col: 3, row: 2 } }, { ball: { col: 11, row: 5 } })
    expect(reasonOf(state).reason).toMatch(/to get the ball( and open a way to the end zone)? \((Dodge \d+%, )*Pick-up \d+%\)$/)
  })

  it('for a Blitz on the ball carrier, naming him by team and position, with the Tackle’s odds', () => {
    const state = scene({ [BLITZER]: { col: 8, row: 5 }, [ELF]: { col: 11, row: 5 } }, { carrier: ELF })
    expect(reasonOf(state).reason).toMatch(/^Blitzer 1 Blitzes Elves Lineman 1 from \(10, 5\) to win the ball.* \(Tackle \d+%\)$/)
  })

  it('for a pass', () => {
    const state = scene({ [THROWER]: { col: 5, row: 5 }, [BLITZER]: { col: 10, row: 5 }, [ELF]: { col: 15, row: 2 } }, { carrier: THROWER })
    const view = viewOf(state)
    const pass = generatePlans(view).find((p) => p.final?.type === 'pass')!
    expect(planReason(view, pass, 'home', new Search('home'))).toMatch(/^Thrower 1 passes to Blitzer 1 to .+ \(Pass \d+%\)$/)
  })

  it('for a Wait', () => {
    // Every Orc has gone this round and the Elves haven't: waiting is all that's left.
    const state = scene({ [BLITZER]: { col: 8, row: 5 }, [ELF]: { col: 14, row: 5 } })
    state.players[BLITZER]!.activatedThisRound = true
    expect(legalCommands(state).map((c) => c.type)).toContain('wait')
    const choice = reasonOf(state)
    expect(choice.command.type).toBe('wait')
    expect(choice.reason).toBe('Waits, keeping its players for later in the round')
  })

  it('for setup and the kick-off, and a coin toss', () => {
    let state = createMatch(rulesV12, [orcs, elves], 3)
    const toss = chooseCommand(viewOf(state), state.pending!.team, options)
    expect(toss.reason).toMatch(/^Chooses to (kick off|receive)$/)
    state = apply(state, { type: 'decide', choice: 'kick' }).state
    const kicker = state.turnOwner
    const setup = chooseCommand(viewOf(state), kicker, options)
    expect(setup.reason).toMatch(/^Sets up to kick in the \w+ formation$/)
    expect(setup.plan).toMatch(/^setup: /)
  })

  it('for a decision', () => {
    const state = scene({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, 'away-lineman-2': { col: 14, row: 5 } })
    state.players[ELF]!.activatedThisRound = true // no Brace
    let current = apply(state, { type: 'activate', playerId: BLITZER, action: 'block' }).state
    current = apply(current, { type: 'block', targetId: ELF }).state
    expect(current.pending?.kind).toBe('blocking.shoveOrTackle')
    expect(reasonOf(current).reason).toMatch(/^(Tackles \(\d+%\)|Shoves)$/)
  })

  it('give each command of a plan the same plan key, so the log shows its reason once', () => {
    const state = scene({ [BLITZER]: { col: 8, row: 5 }, [ELF]: { col: 11, row: 5 } }, { carrier: ELF })
    const first = reasonOf(state)
    const second = reasonOf(apply(state, first.command).state)
    expect(second.plan).toBe(first.plan)
  })

  it('never depend on the dice to come', () => {
    const state = scene({ [BLITZER]: { col: 8, row: 5 }, [ELF]: { col: 11, row: 5 } }, { carrier: ELF })
    const other = { ...state, rng: seededRng(999) }
    expect(reasonOf(other)).toEqual(reasonOf(state))
  })
})
