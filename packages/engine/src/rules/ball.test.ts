import { describe, expect, it } from 'vitest'
import { createEngine } from '../engine'
import { fromColRow, type Hex, toColRow } from '../hex'
import type { GameEvent, GameState } from '../state'
import { RULE_MODULES } from '.'
import { ballArrives, bounceBall, scatterBall, throwIn } from './ball'
import { run, runRule, scene } from './test-helpers'

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })
const cr = (hex: Hex | null) => (hex ? Object.values(toColRow(hex)) : null)

// D6 directions: 1 E, 2 SE, 3 SW, 4 W, 5 NW, 6 NE. South is towards row 9.
// Odd rows have 18 hexes; even rows have 17 and sit half a hex in, so from an
// odd-row hex SE keeps the column, and from an even-row hex it adds one.

const ELF = 'away-lineman-1' // AG 4+
const ELF2 = 'away-lineman-2'
const ORC = 'home-lineman-1' // AG 6+
const ORC2 = 'home-lineman-2'

/** Ball path as [col,row] pairs, from the ballMoved events. */
const path = (events: GameEvent[]) =>
  events.flatMap((e) => (e.type === 'ballMoved' ? [[...cr(e.to)!, e.how]] : []))
const rolls = (events: GameEvent[]) =>
  events.flatMap((e) => (e.type === 'rolled' ? [[e.test, e.natural, e.success]] : []))

const noMomentum = (state: GameState) => {
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  return state
}

describe('scatter', () => {
  it('moves the ball one random hex per scatter, then it lands and bounces once', () => {
    const state = scene({}, [1, 1, 2, 4])
    const { state: after, events } = runRule(state, (ctx) => scatterBall(ctx, h(9, 5), 3, { kind: 'none' }))
    expect(path(events)).toEqual([
      [10, 5, 'scatter'],
      [11, 5, 'scatter'],
      [11, 6, 'scatter'],
      [10, 6, 'bounce'],
    ])
    expect(events.at(-1)).toEqual({ type: 'ballSettled', hex: h(10, 6) })
    expect(after.ball).toEqual({ hex: h(10, 6), carrier: null })
    expect(rolls(events)).toEqual([])
  })

  it('goes straight to a throw-in if it leaves the pitch', () => {
    // From (18,5) east is off the pitch: back in from (18,5), W, 1+1 hexes, then a bounce W.
    const state = scene({}, [1, 4, 1, 1, 4])
    const { events } = runRule(state, (ctx) => scatterBall(ctx, h(18, 5), 3, { kind: 'none' }))
    expect(events[0]).toEqual({ type: 'ballOut', lastHex: h(18, 5) })
    expect(path(events)).toEqual([
      [17, 5, 'throwIn'],
      [16, 5, 'throwIn'],
      [15, 5, 'bounce'],
    ])
  })
})

describe('bounce', () => {
  it('settles when it lands on an empty hex', () => {
    const { state, events } = runRule(scene({}, [6]), (ctx) => bounceBall(ctx, h(5, 5), { kind: 'none' }))
    expect(path(events)).toEqual([[5, 4, 'bounce']])
    expect(state.ball).toEqual({ hex: h(5, 4), carrier: null })
  })

  it('gives a standing player a catch roll: AG, −1 per enemy tackle zone', () => {
    // Bounce E from (9,5) onto an Elf (AG 4+) at (10,5), marked by an Orc at (11,5): needs 5.
    const marked = scene({ [ELF]: { col: 10, row: 5 }, [ORC]: { col: 11, row: 5 } }, [1, 5])
    const { state, events } = runRule(marked, (ctx) => bounceBall(ctx, h(9, 5), { kind: 'none' }))
    expect(events).toContainEqual({
      type: 'rolled',
      test: 'Catch',
      target: 4,
      modifiers: [{ name: '1 tackle zone', value: -1 }],
      natural: 5,
      success: true,
    })
    expect(events.at(-1)).toEqual({ type: 'ballCaught', playerId: ELF })
    expect(state.ball).toEqual({ hex: h(10, 5), carrier: ELF })
  })

  it('always needs the roll, even unmarked', () => {
    const { events } = runRule(scene({ [ELF]: { col: 10, row: 5 } }, [1, 4]), (ctx) =>
      bounceBall(ctx, h(9, 5), { kind: 'none' }),
    )
    expect(rolls(events)).toEqual([['Catch', 4, true]])
  })

  it('chains: a dropped catch bounces from the catcher, and so on until it settles', () => {
    // E onto Elf at (10,5): rolls 3, drops. Bounces SE to (10,6) onto Orc: rolls 2, drops.
    // Bounces E to (11,6): empty, settles.
    const state = noMomentum(scene({ [ELF]: { col: 10, row: 5 }, [ORC]: { col: 10, row: 6 } }, [1, 3, 2, 2, 1]))
    const { state: after, events } = runRule(state, (ctx) => bounceBall(ctx, h(9, 5), { kind: 'none' }))
    expect(path(events)).toEqual([
      [10, 5, 'bounce'],
      [10, 6, 'bounce'],
      [11, 6, 'bounce'],
    ])
    expect(rolls(events)).toEqual([
      ['Catch', 3, false],
      ['Catch', 2, false],
    ])
    expect(after.ball).toEqual({ hex: h(11, 6), carrier: null })
  })

  it('bounces on past a prone or stunned player', () => {
    const state = scene({ [ELF]: { col: 10, row: 5, status: 'prone' }, [ELF2]: { col: 11, row: 5, status: 'stunned' } }, [1, 1, 1])
    const { state: after, events } = runRule(state, (ctx) => bounceBall(ctx, h(9, 5), { kind: 'none' }))
    expect(rolls(events)).toEqual([])
    expect(after.ball.hex).toEqual(h(12, 5))
  })
})

describe('landing from a kick or pass', () => {
  it('is caught without a roll for an accurate pass to an unmarked player', () => {
    const { state, events } = runRule(scene({ [ORC]: { col: 6, row: 5 } }), (ctx) =>
      ballArrives(ctx, h(6, 5), { kind: 'none' }, { accurate: true }),
    )
    expect(rolls(events)).toEqual([])
    expect(state.ball.carrier).toBe(ORC)
  })

  it('needs a roll for an accurate pass to a marked player', () => {
    const state = scene({ [ORC]: { col: 6, row: 5 }, [ELF]: { col: 7, row: 5 } }, [7])
    const { events } = runRule(state, (ctx) => ballArrives(ctx, h(6, 5), { kind: 'none' }, { accurate: true }))
    expect(rolls(events)).toEqual([['Catch', 7, true]])
  })

  it('always needs a roll from a kick', () => {
    const { events } = runRule(scene({ [ORC]: { col: 6, row: 5 } }, [6]), (ctx) =>
      ballArrives(ctx, h(6, 5), { kind: 'none' }, { accurate: false }),
    )
    expect(rolls(events)).toEqual([['Catch', 6, true]])
  })

  it('bounces once from an empty hex', () => {
    const { events } = runRule(scene({}, [3]), (ctx) => ballArrives(ctx, h(6, 5), { kind: 'none' }, { accurate: false }))
    expect(path(events)).toEqual([[5, 6, 'bounce']])
  })
})

describe('throw-in', () => {
  it('comes back from the last hex, re-rolling directions that point off the pitch', () => {
    // Bounce W off the corner (1,1). Throw-in: W and NW point off, re-rolled; E for 3+2.
    // Lands on (6,1), empty, bounces SE to (6,2).
    const state = scene({}, [4, 4, 5, 1, 3, 2, 2])
    const { state: after, events } = runRule(state, (ctx) => bounceBall(ctx, h(1, 1), { kind: 'none' }))
    expect(events[0]).toEqual({ type: 'ballOut', lastHex: h(1, 1) })
    expect(path(events)).toEqual([
      [2, 1, 'throwIn'],
      [3, 1, 'throwIn'],
      [4, 1, 'throwIn'],
      [5, 1, 'throwIn'],
      [6, 1, 'throwIn'],
      [6, 2, 'bounce'],
    ])
    expect(after.ball).toEqual({ hex: h(6, 2), carrier: null })
  })

  it('goes out again if it travels off the pitch, and comes back from there', () => {
    // From the corner SE for 6+6: down the diagonal to (5,9), then off. Back in
    // from (5,9): E for 1+1 to (7,9), then a bounce W to (6,9).
    const state = scene({}, [2, 6, 6, 1, 1, 1, 4])
    const { events } = runRule(state, (ctx) => throwIn(ctx, h(1, 1), { kind: 'none' }))
    expect(events.filter((e) => e.type === 'ballOut')).toEqual([{ type: 'ballOut', lastHex: h(5, 9) }])
    expect(path(events).at(-1)).toEqual([6, 9, 'bounce'])
  })

  it('can be caught where it lands, always with a roll', () => {
    const state = scene({ [ELF]: { col: 3, row: 1 } }, [1, 1, 1, 4])
    const { state: after, events } = runRule(state, (ctx) => throwIn(ctx, h(1, 1), { kind: 'none' }))
    expect(rolls(events)).toEqual([['Catch', 4, true]])
    expect(after.ball.carrier).toBe(ELF)
  })
})

describe('during an activation', () => {
  // Home's Blitzer at (5,5) is active; an Elf Thrower waits far off so away
  // has someone to activate. The ball bounces from (9,5).
  const active = (placements: Parameters<typeof scene>[0], faces: number[]) => {
    const state = noMomentum(
      scene({ 'home-blitzer-1': { col: 5, row: 5 }, 'away-thrower-1': { col: 16, row: 8 }, ...placements }, faces),
    )
    return run(engine, state, { type: 'activate', playerId: 'home-blitzer-1', action: 'move' }).state
  }

  it('ends the activation as failed when the active team drops a catch', () => {
    const state = active({ [ORC]: { col: 10, row: 5 } }, [1, 2, 1])
    const { state: after, events } = runRule(state, (ctx) =>
      bounceBall(ctx, h(9, 5), { kind: 'endActivationIfDropped' }),
    )
    expect(events).toContainEqual({ type: 'activationEnded', playerId: 'home-blitzer-1', failed: true })
    expect(after.doubleActivation).toEqual({ team: 'away', left: 2 })
    // The ball still finished bouncing first.
    expect(after.ball).toEqual({ hex: h(11, 5), carrier: null })
  })

  it("doesn't end it when the other team drops it", () => {
    const state = active({ [ELF]: { col: 10, row: 5 } }, [1, 2, 1])
    const { state: after } = runRule(state, (ctx) => bounceBall(ctx, h(9, 5), { kind: 'endActivationIfDropped' }))
    expect(after.activation).not.toBeNull()
  })

  it('ends it either way when the caller asks', () => {
    const state = active({}, [1])
    const { events } = runRule(state, (ctx) => bounceBall(ctx, h(9, 5), { kind: 'endActivation', failed: false }))
    expect(events).toContainEqual({ type: 'activationEnded', playerId: 'home-blitzer-1', failed: false })
  })

  it('offers a Momentum re-roll on a dropped catch, then carries on', () => {
    // Orc drops (2), coach re-rolls (1, drops again), ball bounces E to (11,5) and settles.
    const state = active({ [ORC]: { col: 10, row: 5 } }, [1, 2, 1, 1])
    state.teams.home.momentum = 1
    const asked = runRule(state, (ctx) => bounceBall(ctx, h(9, 5), { kind: 'endActivationIfDropped' })).state
    expect(asked.pending).toMatchObject({ kind: 'ball.catch', team: 'home' })
    const { state: after, events } = run(engine, asked, { type: 'decide', choice: 'reroll' })
    expect(rolls(events)).toEqual([['Catch', 1, false]])
    expect(after.ball).toEqual({ hex: h(11, 5), carrier: null })
    expect(events).toContainEqual({ type: 'activationEnded', playerId: 'home-blitzer-1', failed: true })
  })

  it('lets the other team re-roll its own catch too', () => {
    const state = active({ [ELF]: { col: 10, row: 5 } }, [1, 2, 6])
    state.teams.away.momentum = 1
    const asked = runRule(state, (ctx) => bounceBall(ctx, h(9, 5), { kind: 'endActivationIfDropped' })).state
    expect(asked.pending).toMatchObject({ kind: 'ball.catch', team: 'away' })
    const after = run(engine, asked, { type: 'decide', choice: 'reroll' }).state
    expect(after.ball.carrier).toBe(ELF)
    expect(after.activation).not.toBeNull()
  })
})
