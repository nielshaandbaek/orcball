import { describe, expect, it } from 'vitest'
import { rulesV10 } from './config'
import { createEngine, IllegalCommandError, type RuleModule } from './engine'
import { createMatch } from './match'
import { forcedRng } from './rng'
import type { GameState } from './state'

const { orcs, elves } = rulesV10.rosters as Record<'orcs' | 'elves', (typeof rulesV10.rosters)[string]>

// A dummy rule module to drive the engine without real rules:
// - Wait is legal; Activate is offered but greyed out with a reason.
// - Wait asks the turn owner a 'coinCall' decision.
// - Answering rolls a D10 'coin' test and scores a point on a success.
const dummy: RuleModule = {
  name: 'dummy',
  options: () => [
    { command: { type: 'wait' }, available: true },
    {
      command: { type: 'activate', playerId: 'home-thrower-1', action: 'pass' },
      available: false,
      reason: 'Dummy rules have no passing',
    },
  ],
  commands: {
    wait(ctx) {
      ctx.ask({
        kind: 'coinCall',
        team: ctx.state.turnOwner,
        prompt: 'Heads or tails?',
        choices: [
          { id: 'heads', label: 'Heads' },
          { id: 'tails', label: 'Tails' },
        ],
        data: { calls: 1 },
      })
    },
  },
  decisions: {
    coinCall(ctx, pending, choice) {
      const event = ctx.test(`coin-${choice.id}`, 6, [{ name: 'Lucky', value: 1 }])
      if (event.success) ctx.state.teams[pending.team].score++
    },
  },
  preview: (_state, command) =>
    command.type === 'wait' ? { test: 'coin', target: 6, modifiers: [{ name: 'Lucky', value: 1 }], chance: 0.6 } : null,
}

const engine = createEngine([dummy])
const start = (faces: number[] = [7]): GameState => ({
  ...createMatch(rulesV10, [orcs, elves], 1),
  rng: forcedRng(faces),
})

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}

describe('legal commands', () => {
  it('lists only the available commands', () => {
    expect(engine.legalCommands(start())).toEqual([{ type: 'wait' }])
  })

  it('keeps greyed-out commands with a one-line reason for the UI', () => {
    expect(engine.availableCommands(start())).toContainEqual({
      command: { type: 'activate', playerId: 'home-thrower-1', action: 'pass' },
      available: false,
      reason: 'Dummy rules have no passing',
    })
  })
})

describe('apply', () => {
  it('rejects a command that is not legal, with the reason', () => {
    expect(() => engine.apply(start(), { type: 'activate', playerId: 'home-thrower-1', action: 'pass' })).toThrow(
      /Dummy rules have no passing/,
    )
    expect(() => engine.apply(start(), { type: 'spendMomentum', use: 'reroll' })).toThrow(IllegalCommandError)
    expect(() => engine.apply(start(), { type: 'decide', choice: 'heads' })).toThrow(/not on offer/)
  })

  it('never mutates its input', () => {
    const state = deepFreeze(start())
    const before = JSON.stringify(state)
    const asked = engine.apply(state, { type: 'wait' })
    engine.apply(deepFreeze(asked.state), { type: 'decide', choice: 'heads' })
    expect(JSON.stringify(state)).toBe(before)
    expect(asked.state).not.toBe(state)
  })

  it('gives a deep-equal result for the same state and command', () => {
    const state = start()
    expect(engine.apply(state, { type: 'wait' })).toEqual(engine.apply(state, { type: 'wait' }))
    const asked = engine.apply(state, { type: 'wait' }).state
    expect(engine.apply(asked, { type: 'decide', choice: 'tails' })).toEqual(
      engine.apply(asked, { type: 'decide', choice: 'tails' }),
    )
  })

  it('keeps the state JSON-safe after commands', () => {
    const asked = engine.apply(start(), { type: 'wait' }).state
    const answered = engine.apply(asked, { type: 'decide', choice: 'heads' }).state
    expect(JSON.parse(JSON.stringify(answered))).toEqual(answered)
  })
})

describe('pending decisions', () => {
  it('pause the engine until the coach answers, then resume', () => {
    const asked = engine.apply(start([7]), { type: 'wait' })
    expect(asked.events).toEqual([])
    expect(asked.state.pending).toMatchObject({ kind: 'coinCall', team: 'away', data: { calls: 1 } })

    // Only the answers are legal while the decision is pending.
    expect(engine.legalCommands(asked.state)).toEqual([
      { type: 'decide', choice: 'heads' },
      { type: 'decide', choice: 'tails' },
    ])
    expect(() => engine.apply(asked.state, { type: 'wait' })).toThrow(/waiting for an answer to 'coinCall'/)
    expect(() => engine.apply(asked.state, { type: 'decide', choice: 'edge' })).toThrow(IllegalCommandError)

    // A natural 7 + 1 beats 6+: the away team scores.
    const answered = engine.apply(asked.state, { type: 'decide', choice: 'heads' })
    expect(answered.state.pending).toBeNull()
    expect(answered.state.teams.away.score).toBe(1)
    expect(answered.events).toEqual([
      { type: 'rolled', test: 'coin-heads', target: 6, modifiers: [{ name: 'Lucky', value: 1 }], natural: 7, success: true },
    ])
    expect(answered.state.rng).toEqual(forcedRng([]))
  })

  it('can be answered the other way', () => {
    const asked = engine.apply(start([2]), { type: 'wait' }).state
    const answered = engine.apply(asked, { type: 'decide', choice: 'tails' })
    expect(answered.state.teams.away.score).toBe(0)
    expect(answered.events[0]).toMatchObject({ test: 'coin-tails', natural: 2, success: false })
  })
})

describe('previewRoll', () => {
  it('asks the rule modules for the roll a command would make', () => {
    expect(engine.previewRoll(start(), { type: 'wait' })).toEqual({
      test: 'coin',
      target: 6,
      modifiers: [{ name: 'Lucky', value: 1 }],
      chance: 0.6,
    })
    expect(engine.previewRoll(start(), { type: 'spendMomentum', use: 'double' })).toBeNull()
  })
})

describe('createEngine', () => {
  it('refuses two modules handling the same command or decision', () => {
    expect(() => createEngine([dummy, { ...dummy, name: 'copy', decisions: {} }])).toThrow(/both handle 'wait'/)
    expect(() => createEngine([dummy, { ...dummy, name: 'copy', commands: {} }])).toThrow(/both answer 'coinCall'/)
  })

  it('refuses a module that tries to handle decide itself', () => {
    expect(() => createEngine([{ name: 'bad', commands: { decide: () => {} } }])).toThrow(/handled by the engine/)
  })
})
