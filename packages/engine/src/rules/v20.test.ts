import { describe, expect, it } from 'vitest'
import { type RuleConfig, rulesV19, rulesV20 } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex } from '../hex'
import { createMatch } from '../match'
import { forcedRng } from '../rng'
import type { GameEvent, GameState } from '../state'
import { RULE_MODULES } from '.'
import { bounceBall } from './ball'
import { run, runRule, scene } from './test-helpers'

// Rules v20: v19 played as one run of 8 rounds with 3 Momentum for the match
// (#135), and a dropped catch forgiven when the active team ends up holding the
// ball (#162).

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })

const ORC = 'home-lineman-1' // AG 6+
const ORC2 = 'home-lineman-2'
const ELF = 'away-lineman-1'
const catchIt = { type: 'decide', choice: 'catch' } as const

describe('rules v20 config', () => {
  it('is v19 with one half of 8 rounds, 3 Momentum and forgiven drops', () => {
    const { id: _a, match: m20, momentum: mo20, ball: b20, ...rest20 } = rulesV20
    const { id: _b, match: m19, momentum: mo19, ball: b19, ...rest19 } = rulesV19
    expect(rulesV20.id).toBe('rules-v20')
    expect(rest20).toEqual(rest19)
    expect(m20).toEqual({ ...m19, halves: 1, roundsPerHalf: 8 })
    expect(mo20).toEqual({ ...mo19, perHalf: 3 })
    expect(b20).toEqual({ ...b19, dropForgivenIfCaught: true })
  })
})

describe('one run of rounds (#135)', () => {
  it('plays 8 rounds straight through, with 3 Momentum a team and no half time', () => {
    const config = rulesV20
    let state = createMatch(config, [config.rosters.orcs!, config.rosters.elves!], 5)
    expect(state.teams.home.momentum).toBe(3)
    expect(state.teams.away.momentum).toBe(3)
    const events: GameEvent[] = []
    // Seeded random legal commands, preferring to end activations and Wait so the match moves on.
    let pick = 12_345
    for (let n = 0; state.phase !== 'FullTime' && n < 20_000; n++) {
      const legal = engine.legalCommands(state)
      const quick = legal.filter((c) => c.type === 'endActivation' || c.type === 'wait')
      const from = quick.length > 0 && pick % 3 !== 0 ? quick : legal
      pick = (Math.imul(pick, 1_103_515_245) + 12_345) >>> 0
      const result = engine.apply(state, from[pick % from.length]!)
      events.push(...result.events)
      state = result.state
    }
    expect(state.phase).toBe('FullTime')
    const rounds = events.flatMap((e) => (e.type === 'roundStarted' ? [`${e.half}.${e.round}`] : []))
    expect(new Set(rounds)).toEqual(new Set(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8']))
    expect(events.filter((e) => e.type === 'halfEnded').map((e) => (e as { half: number }).half)).toEqual([1])
    expect(events.some((e) => e.type === 'matchEnded')).toBe(true)
  })
})

describe('a dropped catch, then caught by the active team (#162)', () => {
  // Home's Blitzer at (5,5) is active; an Elf Thrower waits far off so away has
  // someone to activate. The ball bounces from (9,5), E onto the Orc at (10,5).
  function active(config: RuleConfig, placements: Parameters<typeof scene>[0], faces: number[]): GameState {
    const state = scene({ 'home-blitzer-1': { col: 5, row: 5 }, 'away-thrower-1': { col: 16, row: 8 }, ...placements }, faces)
    state.config = config
    state.teams.home.momentum = 0
    state.teams.away.momentum = 0
    return run(engine, state, { type: 'activate', playerId: 'home-blitzer-1', action: 'move' }).state
  }
  /** Bounce from (9,5), the activation carrying on unless a drop ends it; each catch is tried. */
  function bounce(state: GameState): { state: GameState; events: GameEvent[] } {
    let { state: current, events } = runRule(state, (ctx) => bounceBall(ctx, h(9, 5), { kind: 'endActivationIfDropped' }))
    while (current.pending?.kind === 'ball.catchOrLeave') {
      const step = run(engine, current, catchIt)
      current = step.state
      events = [...events, ...step.events]
    }
    return { state: current, events }
  }
  // E onto the Orc (10,5), who drops it (2); E again onto his team-mate at (11,5), who catches it (9).
  const teamMateCatches = (config: RuleConfig) => active(config, { [ORC]: { col: 10, row: 5 }, [ORC2]: { col: 11, row: 5 } }, [1, 2, 1, 9])

  it('is not a failure in v20: the activation carries on and the opponent gets no double', () => {
    const { state, events } = bounce(teamMateCatches(rulesV20))
    expect(state.ball.carrier).toBe(ORC2)
    expect(events.some((e) => e.type === 'activationEnded')).toBe(false)
    expect(state.activation?.playerId).toBe('home-blitzer-1')
    expect(state.doubleActivation).toBeNull()
  })

  it('is still a failure in v19', () => {
    const { state, events } = bounce(teamMateCatches(rulesV19))
    expect(state.ball.carrier).toBe(ORC2)
    expect(events).toContainEqual({ type: 'activationEnded', playerId: 'home-blitzer-1', failed: true })
    expect(state.doubleActivation).toEqual({ team: 'away', left: 2 })
  })

  it('is still a failure in v20 when the opponent ends up with it', () => {
    const state = active(rulesV20, { [ORC]: { col: 10, row: 5 }, [ELF]: { col: 11, row: 5 } }, [1, 2, 1, 9])
    const { state: after, events } = bounce(state)
    expect(after.ball.carrier).toBe(ELF)
    expect(events).toContainEqual({ type: 'activationEnded', playerId: 'home-blitzer-1', failed: true })
  })

  it('is still a failure in v20 when the ball ends on the ground', () => {
    // The Orc drops it (2); it bounces E to (11,5), empty, and settles.
    const { state, events } = bounce(active(rulesV20, { [ORC]: { col: 10, row: 5 } }, [1, 2, 1]))
    expect(state.ball).toEqual({ hex: h(11, 5), carrier: null })
    expect(events).toContainEqual({ type: 'activationEnded', playerId: 'home-blitzer-1', failed: true })
  })
})

describe('a failed pick-up, then caught by the active team (#162)', () => {
  it('is still a failure in v20', () => {
    // The Blitzer steps from (5,5) onto the ball at (6,5), marked by the Elf at (7,5): the pick-up rolls 2 and fails.
    // The ball bounces SE to (6,6), onto the Orc there, who catches it (9).
    const state = scene({ 'home-blitzer-1': { col: 5, row: 5 }, [ELF]: { col: 7, row: 5 }, [ORC]: { col: 6, row: 6 } }, [2, 2, 9])
    state.config = rulesV20
    state.teams.home.momentum = 0
    state.teams.away.momentum = 0
    state.ball = { hex: h(6, 5), carrier: null }
    state.rng = forcedRng([2, 2, 9])
    let { state: current, events } = run(engine, state, { type: 'activate', playerId: 'home-blitzer-1', action: 'move' }, { type: 'move', to: h(6, 5) })
    while (current.pending?.kind === 'ball.catchOrLeave') {
      const step = run(engine, current, catchIt)
      current = step.state
      events = [...events, ...step.events]
    }
    expect(events).toContainEqual(expect.objectContaining({ type: 'rolled', test: 'Pick-up', success: false }))
    expect(current.ball.carrier).toBe(ORC)
    expect(events).toContainEqual({ type: 'activationEnded', playerId: 'home-blitzer-1', failed: true })
    expect(current.doubleActivation).toEqual({ team: 'away', left: 2 })
  })
})
