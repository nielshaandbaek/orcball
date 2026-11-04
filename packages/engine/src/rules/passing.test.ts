import { describe, expect, it } from 'vitest'
import { createEngine } from '../engine'
import { fromColRow, type Hex } from '../hex'
import type { Command, GameEvent, GameState } from '../state'
import { RULE_MODULES } from '.'
import { reachableHexes } from './movement'
import { possibleInterceptors } from './passing'
import { run, scene } from './test-helpers'

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })

const THROWER = 'home-thrower-1' // AG 6+
const BLITZER = 'home-blitzer-1' // AG 6+, MA 6
const ORC = 'home-lineman-1'
const ELF = 'away-lineman-1' // AG 4+
const ELF2 = 'away-lineman-2'
const FAR_ELF = 'away-thrower-1'

type Placements = Parameters<typeof scene>[0]
type Action = 'move' | 'pass' | 'handOff'

/** Home's player activated with this action; the ball where given; no Momentum unless set. */
function active(placements: Placements, playerId: string, action: Action, ball: { at: [number, number]; carrier?: string }, faces: number[] = []): GameState {
  const state = scene({ [FAR_ELF]: { col: 16, row: 8 }, ...placements }, faces)
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  state.ball = { hex: h(...ball.at), carrier: ball.carrier ?? null }
  return run(engine, state, { type: 'activate', playerId, action }).state
}

const step = (col: number, row: number, dodge = false): Command =>
  dodge ? { type: 'move', to: h(col, row), dodge: true } : { type: 'move', to: h(col, row) }
const pass = (col: number, row: number): Command => ({ type: 'pass', target: h(col, row) })
const decide = (choice: string): Command => ({ type: 'decide', choice })
const rolls = (events: GameEvent[]) => events.flatMap((e) => (e.type === 'rolled' ? [[e.test, e.natural, e.success]] : []))
const ended = (events: GameEvent[]) => events.find((e) => e.type === 'activationEnded')

describe('pick-up', () => {
  it('is automatic when unmarked, and costs 1 extra MA', () => {
    const state = active({ [BLITZER]: { col: 5, row: 5 } }, BLITZER, 'move', { at: [6, 5] })
    const after = run(engine, state, step(6, 5))
    expect(rolls(after.events)).toEqual([])
    expect(after.events).toContainEqual({ type: 'pickedUp', playerId: BLITZER })
    expect(after.state.ball).toEqual({ hex: h(6, 5), carrier: BLITZER })
    expect(after.state.activation!.maUsed).toBe(2)
  })

  it('counts in the reachable cost', () => {
    const state = active({ [BLITZER]: { col: 5, row: 5 } }, BLITZER, 'move', { at: [6, 5] })
    expect(reachableHexes(state, BLITZER).find((r) => r.hex.q === h(6, 5).q && r.hex.r === h(6, 5).r)?.cost).toBe(2)
  })

  it("can't be stepped onto without the MA for it", () => {
    const state = active({ [BLITZER]: { col: 5, row: 5 } }, BLITZER, 'move', { at: [6, 5] })
    state.activation!.maUsed = 7
    expect(engine.legalCommands(state)).not.toContainEqual(step(6, 5))
    expect(engine.legalCommands(state)).toContainEqual(step(5, 4))
  })

  it('needs an AG roll at −1 per tackle zone when marked, and works even if the move stops there', () => {
    // An Elf at (7,5) marks (6,5). Stepping in stops the move; 7 − 1 = 6 picks up.
    const state = active({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 7, row: 5 } }, BLITZER, 'move', { at: [6, 5] }, [7])
    const after = run(engine, state, step(6, 5))
    expect(after.events).toContainEqual({
      type: 'rolled',
      test: 'Pick-up',
      target: 6,
      modifiers: [{ name: '1 tackle zone', value: -1 }],
      natural: 7,
      success: true,
    })
    expect(after.state.ball.carrier).toBe(BLITZER)
    expect(after.state.activation!.stopped).toBe(true)
  })

  it('bounces the ball and ends the activation on a failure', () => {
    // 6 − 1 = 5 fails; the ball bounces SE from (6,5) to (6,6).
    const state = active({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 7, row: 5 } }, BLITZER, 'move', { at: [6, 5] }, [6, 2])
    const after = run(engine, state, step(6, 5))
    expect(after.state.ball).toEqual({ hex: h(6, 6), carrier: null })
    expect(ended(after.events)).toEqual({ type: 'activationEnded', playerId: BLITZER, failed: true })
    expect(after.state.doubleActivation).toEqual({ team: 'away', left: 2 })
  })

  it('comes after a Dodge', () => {
    // Dodge 6 succeeds; pick-up 7 − 1 succeeds, and the Blitzer can move on.
    const state = active({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 7, row: 5 } }, BLITZER, 'move', { at: [6, 5] }, [6, 7])
    const after = run(engine, state, step(6, 5, true))
    expect(rolls(after.events)).toEqual([
      ['Dodge', 6, true],
      ['Pick-up', 7, true],
    ])
    expect(after.state.activation!.stopped).toBe(false)
  })

  it('makes the ball bounce if the player falls Dodging onto it', () => {
    // Dodge 2 fails; red 2 holds; the ball bounces W from (6,5) to (5,5), now empty.
    const state = active({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 7, row: 5 } }, BLITZER, 'move', { at: [6, 5] }, [2, 2, 5, 4])
    const after = run(engine, state, step(6, 5, true)).state
    expect(after.players[BLITZER]!.status).toBe('prone')
    expect(after.ball).toEqual({ hex: h(5, 5), carrier: null })
  })
})

describe('pass', () => {
  // The Orc Thrower (AG 6+) at (3,5) holds the ball; the Blitzer waits at (8,5), 5 hexes away (Short, −1).
  const throwing = (extra: Placements = {}, faces: number[] = []) =>
    active({ [THROWER]: { col: 3, row: 5 }, [BLITZER]: { col: 8, row: 5 }, ...extra }, THROWER, 'pass', { at: [3, 5], carrier: THROWER }, faces)

  it('is offered to any hex in range, only to the carrier on a Pass action', () => {
    const passes = engine.legalCommands(throwing()).filter((c) => c.type === 'pass')
    expect(passes.length).toBeGreaterThan(50)
    expect(passes).toContainEqual(pass(15, 5))
    expect(passes).not.toContainEqual(pass(16, 5))
    const noBall = active({ [THROWER]: { col: 3, row: 5 } }, THROWER, 'pass', { at: [10, 5] })
    expect(engine.legalCommands(noBall).some((c) => c.type === 'pass')).toBe(false)
  })

  it('previews the throw with the range band and tackle zones', () => {
    const state = throwing({ [ELF]: { col: 2, row: 5 } })
    expect(engine.previewRoll(state, pass(8, 5))).toEqual({
      test: 'Pass',
      target: 6,
      modifiers: [
        { name: 'Short', value: -1 },
        { name: '1 tackle zone', value: -1 },
      ],
      chance: 0.3,
    })
    expect(engine.previewRoll(state, pass(5, 5))).toMatchObject({ modifiers: [{ name: '1 tackle zone', value: -1 }] })
  })

  it('lands on target on a success: an accurate pass to an unmarked teammate is caught', () => {
    const after = run(engine, throwing({}, [7]), pass(8, 5))
    expect(after.events).toContainEqual({ type: 'passed', playerId: THROWER, target: h(8, 5) })
    expect(rolls(after.events)).toEqual([['Pass', 7, true]])
    expect(after.state.ball).toEqual({ hex: h(8, 5), carrier: BLITZER })
    expect(ended(after.events)).toEqual({ type: 'activationEnded', playerId: THROWER, failed: false })
  })

  it('bounces once on an accurate pass to an empty hex, which is not a failure', () => {
    const after = run(engine, throwing({}, [8, 1]), pass(6, 5))
    expect(after.state.ball).toEqual({ hex: h(7, 5), carrier: null })
    expect(ended(after.events)).toMatchObject({ failed: false })
  })

  it('scatters 3 times from the target on a failure', () => {
    // 3 − 1 = 2 fails without fumbling. Scatter E, E, NE from (8,5) to (10,4), then a bounce W to (9,4).
    const after = run(engine, throwing({}, [3, 1, 1, 6, 4]), pass(8, 5))
    expect(after.events.filter((e) => e.type === 'ballMoved' && e.how === 'scatter')).toHaveLength(3)
    expect(after.state.ball).toEqual({ hex: h(9, 4), carrier: null })
    expect(ended(after.events)).toMatchObject({ failed: true })
    expect(after.state.doubleActivation).toEqual({ team: 'away', left: 2 })
  })

  it('is a fumble on a natural 1: the ball bounces from the thrower', () => {
    const after = run(engine, throwing({}, [1, 1]), pass(8, 5))
    expect(after.events).toContainEqual({ type: 'fumbled', playerId: THROWER })
    expect(after.state.ball).toEqual({ hex: h(4, 5), carrier: null })
    expect(ended(after.events)).toMatchObject({ failed: true })
  })

  it('is a fumble when the modified result is 1 or less', () => {
    // 2 − 1 (Short) = 1.
    const after = run(engine, throwing({}, [2, 4]), pass(8, 5))
    expect(after.events).toContainEqual({ type: 'fumbled', playerId: THROWER })
    expect(after.state.ball).toEqual({ hex: h(2, 5), carrier: null })
  })

  it('can be re-rolled with Momentum', () => {
    const state = throwing({}, [3, 9])
    state.teams.home.momentum = 1
    const failed = run(engine, state, pass(8, 5)).state
    expect(failed.pending).toMatchObject({ kind: 'passing.throw', team: 'home' })
    const after = run(engine, failed, decide('reroll')).state
    expect(after.ball.carrier).toBe(BLITZER)
  })

  it('offers a re-roll of a fumble even on a natural 10', () => {
    // A natural 10 always passes, but with enough against it the modified result is still a fumble.
    const state = throwing({}, [10, 4])
    state.config = { ...state.config, ball: { ...state.config.ball, fumbleAtOrBelow: 10 } }
    state.teams.home.momentum = 1
    const fumbled = run(engine, state, pass(8, 5)).state
    expect(fumbled.pending).toMatchObject({ kind: 'passing.throw', team: 'home' })
    const accepted = run(engine, fumbled, decide('accept'))
    expect(accepted.events).toContainEqual({ type: 'fumbled', playerId: THROWER })
  })

  it('ends as failed if the receiver drops it', () => {
    // An Elf at (9,5) marks the Blitzer: pass 7 is accurate, catch 5 − 1 fails, the ball bounces SE to (8,6).
    const after = run(engine, throwing({ [ELF]: { col: 9, row: 5 } }, [7, 5, 2]), pass(8, 5))
    expect(rolls(after.events)).toEqual([
      ['Pass', 7, true],
      ['Catch', 5, false],
    ])
    expect(after.state.ball).toEqual({ hex: h(8, 6), carrier: null })
    expect(ended(after.events)).toMatchObject({ failed: true })
  })
})

describe('interception', () => {
  const throwing = (extra: Placements, faces: number[] = []) =>
    active({ [THROWER]: { col: 3, row: 5 }, [BLITZER]: { col: 8, row: 5 }, ...extra }, THROWER, 'pass', { at: [3, 5], carrier: THROWER }, faces)

  it('lists the opponents standing on the line, not at either end', () => {
    const state = throwing({ [ELF]: { col: 5, row: 5 }, [ELF2]: { col: 5, row: 4 }, 'away-catcher-1': { col: 6, row: 5, status: 'prone' } })
    expect(possibleInterceptors(state, state.players[THROWER]!, h(8, 5)).map((p) => p.id)).toEqual([ELF])
  })

  it('counts both hexes where the line runs along an edge', () => {
    // Straight up from (5,5) to (5,3) runs between (4,4) and (5,4).
    const state = active(
      { [THROWER]: { col: 5, row: 5 }, [ELF]: { col: 4, row: 4 }, [ELF2]: { col: 5, row: 4 } },
      THROWER,
      'pass',
      { at: [5, 5], carrier: THROWER },
    )
    expect(possibleInterceptors(state, state.players[THROWER]!, h(5, 3)).map((p) => p.id)).toEqual([ELF, ELF2])
  })

  it('comes before the throw: AG at −3, and a success takes the ball', () => {
    // Elf AG 4+ at −3: a 7 intercepts.
    const after = run(engine, throwing({ [ELF]: { col: 5, row: 5 } }, [7]), pass(8, 5))
    expect(after.events).toContainEqual({
      type: 'rolled',
      test: 'Interception',
      target: 4,
      modifiers: [{ name: 'Interception', value: -3 }],
      natural: 7,
      success: true,
    })
    expect(after.events).toContainEqual({ type: 'intercepted', playerId: ELF })
    expect(after.state.ball).toEqual({ hex: h(5, 5), carrier: ELF })
    expect(ended(after.events)).toMatchObject({ failed: true })
    expect(after.state.doubleActivation).toEqual({ team: 'away', left: 2 })
  })

  it('lets the pass go on when it fails', () => {
    const after = run(engine, throwing({ [ELF]: { col: 5, row: 5 } }, [6, 7]), pass(8, 5))
    expect(rolls(after.events)).toEqual([
      ['Interception', 6, false],
      ['Pass', 7, true],
    ])
    expect(after.state.ball.carrier).toBe(BLITZER)
  })

  it('has −1 per tackle zone of the throwing team on the interceptor', () => {
    // An Orc at (5,4) marks the Elf at (5,5): a 7 is no longer enough.
    const after = run(engine, throwing({ [ELF]: { col: 5, row: 5 }, [ORC]: { col: 5, row: 4 } }, [7, 7]), pass(8, 5))
    expect(rolls(after.events)[0]).toEqual(['Interception', 7, false])
  })

  it('asks the defending coach to pick when several could try', () => {
    const asked = run(engine, throwing({ [ELF]: { col: 5, row: 5 }, [ELF2]: { col: 6, row: 5 } }, [8]), pass(8, 5)).state
    expect(asked.pending).toMatchObject({ kind: 'passing.chooseInterceptor', team: 'away' })
    expect(asked.pending?.choices.map((c) => c.id)).toEqual([ELF, ELF2])
    const after = run(engine, asked, decide(ELF2)).state
    expect(after.ball.carrier).toBe(ELF2)
  })
})

describe('hand-off', () => {
  const handing = (extra: Placements, faces: number[] = []) =>
    active({ [THROWER]: { col: 5, row: 5 }, [BLITZER]: { col: 6, row: 5 }, ...extra }, THROWER, 'handOff', { at: [5, 5], carrier: THROWER }, faces)

  it('is offered to adjacent standing teammates', () => {
    const state = handing({ [ORC]: { col: 4, row: 5, status: 'prone' } })
    expect(engine.legalCommands(state).filter((c) => c.type === 'handOff')).toEqual([{ type: 'handOff', targetId: BLITZER }])
  })

  it('needs no throw roll, and an unmarked teammate catches it', () => {
    const after = run(engine, handing({}), { type: 'handOff', targetId: BLITZER })
    expect(rolls(after.events)).toEqual([])
    expect(after.state.ball).toEqual({ hex: h(6, 5), carrier: BLITZER })
    expect(ended(after.events)).toMatchObject({ failed: false })
  })

  it('needs a catch roll for a marked teammate, and a drop is a failure', () => {
    // An Elf at (7,5) marks the Blitzer: 6 − 1 fails; bounce SE to (6,6).
    const after = run(engine, handing({ [ELF]: { col: 7, row: 5 } }, [6, 2]), { type: 'handOff', targetId: BLITZER })
    expect(rolls(after.events)).toEqual([['Catch', 6, false]])
    expect(ended(after.events)).toMatchObject({ failed: true })
  })
})

describe('roll previews', () => {
  it('show the pick-up when stepping onto a marked ball, after any Dodge', () => {
    const state = active({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 7, row: 5 } }, BLITZER, 'move', { at: [6, 5] })
    expect(engine.previewRolls(state, step(6, 5))).toEqual([
      { test: 'Pick-up', target: 6, modifiers: [{ name: '1 tackle zone', value: -1 }], chance: 0.4 },
    ])
    expect(engine.previewRolls(state, step(6, 5, true)).map((p) => p.test)).toEqual(['Dodge', 'Pick-up'])
  })

  it('have nothing for an unmarked pick-up', () => {
    const state = active({ [BLITZER]: { col: 5, row: 5 } }, BLITZER, 'move', { at: [6, 5] })
    expect(engine.previewRolls(state, step(6, 5))).toEqual([])
  })

  it('show the catch for a hand-off to a marked teammate', () => {
    const state = active(
      { [THROWER]: { col: 5, row: 5 }, [BLITZER]: { col: 6, row: 5 }, [ELF]: { col: 7, row: 5 } },
      THROWER,
      'handOff',
      { at: [5, 5], carrier: THROWER },
    )
    expect(engine.previewRolls(state, { type: 'handOff', targetId: BLITZER })).toEqual([
      { test: 'Catch', target: 6, modifiers: [{ name: '1 tackle zone', value: -1 }], chance: 0.4 },
    ])
  })
})
