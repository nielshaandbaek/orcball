import { describe, expect, it } from 'vitest'
import { rulesV25, rulesV26 } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex } from '../hex'
import { createMatch } from '../match'
import type { Command, GameEvent, GameState } from '../state'
import { RULE_MODULES } from '.'
import { knockDown, pushedIntoCrowd } from './injury'
import { run, runRule, scene } from './test-helpers'

// Rules v26 (in progress: the Dwarves, #211, and their skills): v25 where a
// team must field 7 players at setup, or every player it has available (#200).

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })
const { orcs, elves } = rulesV26.rosters as Record<'orcs' | 'elves', (typeof rulesV26.rosters)[string]>

/** Hexes in the Elves' (away, right) half, clear of the halfway line and the wide zones. */
const SPOTS: [number, number][] = [
  [12, 3],
  [12, 4],
  [12, 5],
  [12, 6],
  [12, 7],
  [14, 4],
  [14, 6],
]

const endSetup = (state: GameState) => engine.availableCommands(state).find((o) => o.command.type === 'endSetup')!

/** A new match (the away Elves set up first, v23 on) with `count` of them placed. */
function placed(config = rulesV26, count: number, unavailable: string[] = []): GameState {
  const state = createMatch(config, [orcs!, elves!], 1)
  for (const id of unavailable) state.players[id]!.status = 'out'
  const ids = Object.keys(state.players).filter((id) => id.startsWith('away-') && !unavailable.includes(id))
  const commands: Command[] = ids.slice(0, count).map((playerId, i) => ({ type: 'place', playerId, hex: h(...SPOTS[i]!) }))
  return run(engine, state, ...commands).state
}

describe('rules v26 config', () => {
  it('is v25 with setup.fieldAllAvailable', () => {
    const { id: _a, setup: s26, ...rest26 } = rulesV26
    const { id: _b, setup: s25, ...rest25 } = rulesV25
    expect(rulesV26.id).toBe('rules-v26')
    expect(rest26).toEqual(rest25)
    expect(s26).toEqual({ ...s25, fieldAllAvailable: true })
  })
})

describe('setup: field 7, or every player available (#200)', () => {
  it('refuses End setup with 6 of 7 on the pitch, saying how many more', () => {
    expect(endSetup(placed(rulesV26, 6))).toEqual({ command: { type: 'endSetup' }, available: false, reason: 'Set up 1 more player' })
    expect(endSetup(placed(rulesV26, 4))).toMatchObject({ available: false, reason: 'Set up 3 more players' })
  })

  it('allows it with 7', () => {
    const state = placed(rulesV26, 7)
    expect(endSetup(state).available).toBe(true)
    expect(run(engine, state, { type: 'endSetup' }).state.turnOwner).toBe('home')
  })

  it('allows it with 5 when only 5 are available (the others Out)', () => {
    const state = placed(rulesV26, 5, ['away-lineman-1', 'away-lineman-2'])
    expect(endSetup(state).available).toBe(true)
    expect(endSetup(placed(rulesV26, 4, ['away-lineman-1', 'away-lineman-2']))).toMatchObject({ available: false, reason: 'Set up 1 more player' })
  })

  it('refuses the command itself, not just the button', () => {
    expect(() => run(engine, placed(rulesV26, 6), { type: 'endSetup' })).toThrow(/Illegal command/)
  })

  it('in v25 one player is still enough', () => {
    expect(endSetup(placed(rulesV25, 1)).available).toBe(true)
    expect(endSetup(placed(rulesV25, 0))).toMatchObject({ available: false, reason: 'Set up at least one player' })
  })
})

describe('Thick Skull (#212): Out on its lowest value is Stunned instead', () => {
  const ORC = 'home-lineman-1' // TO 9
  const ATTACKER = 'away-lineman-1'
  const none = { kind: 'none' } as const

  /** The Orc at (5,5), given Thick Skull (or not), knocked down with these dice: red then white. */
  function downed(red: number, white: number, { thickSkull = true, crushingBlow = false } = {}) {
    const state = scene({ [ORC]: { col: 5, row: 5 }, [ATTACKER]: { col: 6, row: 5 } }, [red, white])
    state.config = rulesV26
    state.players[ORC]!.skills = thickSkull ? ['Thick Skull'] : []
    state.players[ATTACKER]!.skills = crushingBlow ? ['Crushing Blow'] : []
    return runRule(state, (ctx) => knockDown(ctx, ORC, none, crushingBlow ? state.players[ATTACKER]! : null))
  }
  const injury = (events: GameEvent[]) => events.find((e) => e.type === 'injured')

  it('an 8 (the lowest Out in v26: Stunned 1–7, Out 8–9) leaves him Stunned, and says why', () => {
    const { state, events } = downed(10, 8)
    expect(injury(events)).toEqual({ type: 'injured', playerId: ORC, result: 'stunned', thickSkull: true })
    expect(state.players[ORC]).toMatchObject({ status: 'stunned', hex: h(5, 5) })
  })

  it('without Thick Skull an 8 is Out, and the event is as before', () => {
    expect(injury(downed(10, 8, { thickSkull: false }).events)).toEqual({ type: 'injured', playerId: ORC, result: 'out' })
  })

  it('a 9 is still Out, a 10 still a Casualty, a 7 Stunned as always', () => {
    expect(injury(downed(10, 9).events)).toEqual({ type: 'injured', playerId: ORC, result: 'out' })
    expect(injury(downed(10, 10).events)).toEqual({ type: 'injured', playerId: ORC, result: 'casualty' })
    expect(injury(downed(10, 7).events)).toEqual({ type: 'injured', playerId: ORC, result: 'stunned' })
  })

  it('after Crushing Blow: a natural 7 made 8 is Stunned again; a natural 8 made 9 is Out', () => {
    expect(injury(downed(10, 7, { crushingBlow: true }).events)).toEqual({ type: 'injured', playerId: ORC, result: 'stunned', thickSkull: true })
    expect(injury(downed(10, 8, { crushingBlow: true }).events)).toEqual({ type: 'injured', playerId: ORC, result: 'out' })
  })

  it('pushed into the crowd on an 8: to the reserves, not Out', () => {
    const state = scene({ [ORC]: { col: 5, row: 1 } }, [8])
    state.config = rulesV26
    state.players[ORC]!.skills = ['Thick Skull']
    const { state: after, events } = runRule(state, (ctx) => pushedIntoCrowd(ctx, ORC, h(5, 1), none))
    expect(events).toContainEqual({ type: 'toReserves', playerId: ORC, thickSkull: true })
    expect(after.players[ORC]).toMatchObject({ status: 'standing', hex: null })
  })

  it('on a foul too', () => {
    const state = scene({ [ATTACKER]: { col: 6, row: 5 }, [ORC]: { col: 5, row: 5, status: 'prone' } }, [10, 8])
    state.config = rulesV26
    state.players[ORC]!.skills = ['Thick Skull']
    Object.assign(state, { turnOwner: 'away', firstGo: 'away' })
    const { events } = run(engine, state, { type: 'activate', playerId: ATTACKER, action: 'foul' }, { type: 'foul', targetId: ORC })
    expect(injury(events)).toEqual({ type: 'injured', playerId: ORC, result: 'stunned', thickSkull: true })
  })
})
