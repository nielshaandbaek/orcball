import { describe, expect, it } from 'vitest'
import { createEngine } from '../engine'
import { fromColRow, type Hex } from '../hex'
import type { Command, GameEvent, GameState } from '../state'
import { RULE_MODULES } from '.'
import { foulModifiers, injuryResult, knockDown, pushedIntoCrowd } from './injury'
import { run, runRule, scene } from './test-helpers'

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })

const ORC = 'home-lineman-1' // TO 9
const ORC2 = 'home-lineman-2'
const ORC3 = 'home-blitzer-1'
const ELF = 'away-lineman-1' // TO 7
const ELF2 = 'away-lineman-2'
const FAR_ELF = 'away-thrower-1'

const none = { kind: 'none' } as const
const armour = (events: GameEvent[]) => events.find((e) => e.type === 'armourRolled')
const injuries = (events: GameEvent[]) => events.filter((e) => e.type === 'injured')

function downed(faces: number[], placements: Parameters<typeof scene>[0] = {}): { state: GameState; events: GameEvent[] } {
  const state = scene({ [ORC]: { col: 5, row: 5 }, ...placements }, faces)
  return runRule(state, (ctx) => knockDown(ctx, ORC, none))
}

describe('knock-downs', () => {
  it('leave the player prone when the armour holds', () => {
    // Red 8 against TO 9: holds; the white die doesn't count.
    const { state, events } = downed([8, 10])
    expect(events).toEqual([
      { type: 'knockedDown', playerId: ORC },
      { type: 'armourRolled', playerId: ORC, red: 8, white: 10, modifiers: [], broken: false },
    ])
    expect(state.players[ORC]).toMatchObject({ status: 'prone', hex: h(5, 5) })
  })

  it.each([
    [1, 'stunned'],
    [7, 'stunned'],
    [8, 'out'],
    [9, 'out'],
    [10, 'casualty'],
  ] as const)('read the white die when red ≥ TO: %i is %s', (white, result) => {
    const { state, events } = downed([9, white])
    expect(armour(events)).toMatchObject({ red: 9, broken: true })
    expect(injuries(events)).toEqual([{ type: 'injured', playerId: ORC, result }])
    const player = state.players[ORC]!
    expect(player.status).toBe(result)
    // Stunned players stay where they lie, face down; Out and Casualties leave.
    expect(player.hex).toEqual(result === 'stunned' ? h(5, 5) : null)
  })

  it('make the ball bounce from where the carrier went down', () => {
    // Red 2 holds; the ball bounces E from (5,5) to (6,5).
    const state = scene({ [ORC]: { col: 5, row: 5 } }, [2, 3, 1])
    state.ball = { hex: h(5, 5), carrier: ORC }
    const { state: after } = runRule(state, (ctx) => knockDown(ctx, ORC, none))
    expect(after.ball).toEqual({ hex: h(6, 5), carrier: null })
  })

  it('bounce the ball from the hex even when the carrier is taken off', () => {
    const state = scene({ [ORC]: { col: 5, row: 5 } }, [10, 8, 4])
    state.ball = { hex: h(5, 5), carrier: ORC }
    const { state: after } = runRule(state, (ctx) => knockDown(ctx, ORC, none))
    expect(after.players[ORC]!.hex).toBeNull()
    expect(after.ball).toEqual({ hex: h(4, 5), carrier: null })
  })

  it('match the injury table in RULES.md §6', () => {
    // Over every pair of dice: just prone / Stunned / Out / Casualty for TO 7, 8 and 9.
    for (const [to, expected] of [
      [7, [60, 28, 8, 4]],
      [8, [70, 21, 6, 3]],
      [9, [80, 14, 4, 2]],
    ] as const) {
      const counts = { prone: 0, stunned: 0, out: 0, casualty: 0 }
      for (let red = 1; red <= 10; red++) {
        for (let white = 1; white <= 10; white++) {
          const state = scene({ [ORC]: { col: 5, row: 5 } }, [red, white])
          state.players[ORC]!.to = to
          const status = runRule(state, (ctx) => knockDown(ctx, ORC, none)).state.players[ORC]!.status
          counts[status as keyof typeof counts]++
        }
      }
      expect(Object.values(counts)).toEqual([...expected])
    }
  })
})

describe('injury results', () => {
  it('always make a natural 1 Stunned and a natural 10 a Casualty', () => {
    const state = scene({})
    expect(injuryResult(state, 1)).toBe('stunned')
    expect(injuryResult(state, 10)).toBe('casualty')
  })
})

describe('stunned players', () => {
  const stunned = () =>
    scene({ [ORC]: { col: 5, row: 5, status: 'stunned' }, [ORC2]: { col: 3, row: 3 }, [ELF]: { col: 14, row: 5 } })

  it('can only be activated to turn face up, which is the whole activation', () => {
    const state = stunned()
    const forStunned = engine.legalCommands(state).filter((c) => c.type === 'activate' && c.playerId === ORC)
    expect(forStunned).toEqual([{ type: 'activate', playerId: ORC, action: 'move' }])
    const { state: after, events } = run(engine, state, { type: 'activate', playerId: ORC, action: 'move' })
    expect(events).toContainEqual({ type: 'turnedFaceUp', playerId: ORC })
    expect(events).toContainEqual({ type: 'activationEnded', playerId: ORC, failed: false })
    expect(after.players[ORC]).toMatchObject({ status: 'prone', activatedThisRound: true })
    expect(after.turnOwner).toBe('away')
  })

  it('stand up on the activation after that', () => {
    const state = stunned()
    state.players[ORC]!.status = 'prone'
    const active = run(engine, state, { type: 'activate', playerId: ORC, action: 'move' }).state
    expect(engine.legalCommands(active)).toContainEqual({ type: 'standUp' })
  })

  it('stay face down if the round ends before they activate', () => {
    const after = run(engine, stunned(), { type: 'wait' }, { type: 'wait' }).state
    expect(after.round).toBe(2)
    expect(after.players[ORC]!.status).toBe('stunned')
  })
})

describe('pushed into the crowd', () => {
  const pushed = (white: number, extra: number[] = []) => {
    const state = scene({ [ORC]: { col: 18, row: 5 } }, [white, ...extra])
    return { state, run: () => runRule(state, (ctx) => pushedIntoCrowd(ctx, ORC, none)) }
  }

  it('rolls only the white die', () => {
    const { events } = pushed(8).run()
    expect(events).toEqual([
      { type: 'injuryRolled', playerId: ORC, white: 8 },
      { type: 'injured', playerId: ORC, result: 'out' },
    ])
  })

  it('sends a player who would be Stunned to the reserves', () => {
    const { state, events } = pushed(4).run()
    expect(events).toContainEqual({ type: 'toReserves', playerId: ORC })
    expect(state.players[ORC]).toMatchObject({ hex: null, status: 'standing' })
  })

  it('can be a Casualty', () => {
    expect(pushed(10).run().state.players[ORC]!.status).toBe('casualty')
  })

  it('throws the ball in from the edge if the carrier goes into the crowd', () => {
    // From (18,5): W for 1+1 to (16,5), then a bounce W to (15,5).
    const p = pushed(4, [4, 1, 1, 4])
    p.state.ball = { hex: h(18, 5), carrier: ORC }
    const { state, events } = p.run()
    expect(events).toContainEqual(expect.objectContaining({ type: 'ballMoved', to: h(17, 5), how: 'throwIn' }))
    expect(state.ball).toEqual({ hex: h(15, 5), carrier: null })
  })
})

describe('fouls', () => {
  // The Orc lineman at (5,5) fouls an Elf (TO 7) lying at (6,5).
  const foulScene = (placements: Parameters<typeof scene>[0], faces: number[]) => {
    const state = scene(
      { [ORC]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5, status: 'prone' }, [FAR_ELF]: { col: 16, row: 8 }, ...placements },
      faces,
    )
    return run(engine, state, { type: 'activate', playerId: ORC, action: 'foul' }).state
  }
  const foul: Command = { type: 'foul', targetId: ELF }

  it('are offered against prone or stunned opponents next to the fouler', () => {
    const state = foulScene({ [ELF2]: { col: 5, row: 4, status: 'stunned' }, 'away-catcher-1': { col: 4, row: 5 } }, [])
    const fouls = engine.legalCommands(state).filter((c) => c.type === 'foul')
    expect(fouls).toEqual([
      { type: 'foul', targetId: ELF },
      { type: 'foul', targetId: ELF2 },
    ])
  })

  it("aren't offered on other actions", () => {
    const state = scene({ [ORC]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5, status: 'prone' } })
    const moving = run(engine, state, { type: 'activate', playerId: ORC, action: 'move' }).state
    expect(engine.legalCommands(moving).some((c) => c.type === 'foul')).toBe(false)
  })

  it('roll armour and injury on the victim, and end the activation', () => {
    // Red 7 ≥ TO 7 breaks; white 8: Out.
    const { state, events } = run(engine, foulScene({}, [7, 8]), foul)
    expect(events).toContainEqual({ type: 'fouled', playerId: ORC, targetId: ELF })
    expect(injuries(events)).toEqual([{ type: 'injured', playerId: ELF, result: 'out' }])
    expect(events).toContainEqual({ type: 'activationEnded', playerId: ORC, failed: false })
    expect(state.players[ELF]!.hex).toBeNull()
    expect(state.teams.home.usedThisRound.foul).toBe(1)
  })

  it('add +1 per assist on the red die', () => {
    // A second Orc next to the victim assists: red 6 + 1 breaks TO 7.
    const state = foulScene({ [ORC2]: { col: 7, row: 5 } }, [6, 3])
    expect(foulModifiers(state, state.players[ORC]!, state.players[ELF]!)).toEqual([{ name: '+1 net assist', value: 1 }])
    const { events } = run(engine, state, foul)
    expect(armour(events)).toMatchObject({ red: 6, broken: true, modifiers: [{ name: '+1 net assist', value: 1 }] })
  })

  it("subtract the defender's assists", () => {
    // An Elf next to the fouler cancels the Orc assist.
    const state = foulScene({ [ORC2]: { col: 7, row: 5 }, [ELF2]: { col: 4, row: 5 } }, [])
    expect(foulModifiers(state, state.players[ORC]!, state.players[ELF]!)).toEqual([])
  })

  it("don't count an assister who is in another enemy's tackle zone", () => {
    // The Elf at (4,5) is marked by an Orc at (3,5), so it can't assist the defence.
    const state = foulScene({ [ORC2]: { col: 7, row: 5 }, [ELF2]: { col: 4, row: 5 }, [ORC3]: { col: 3, row: 5 } }, [])
    expect(foulModifiers(state, state.players[ORC]!, state.players[ELF]!)).toEqual([{ name: '+1 net assist', value: 1 }])
  })

  it('get the fouler ejected on a natural 1, and the armour holds', () => {
    const { state, events } = run(engine, foulScene({ [ORC2]: { col: 7, row: 5 } }, [1, 9]), foul)
    expect(armour(events)).toMatchObject({ red: 1, broken: false })
    expect(events).toContainEqual({ type: 'ejected', playerId: ORC })
    expect(state.players[ORC]).toMatchObject({ status: 'ejected', hex: null })
  })

  it('get the fouler ejected on a natural 10, after the armour breaks', () => {
    // An Elf assist on defence makes it 10 − 1 = 9 against TO 10, which would hold; a natural 10 breaks anyway.
    const state = foulScene({ [ELF2]: { col: 4, row: 5 } }, [10, 2])
    state.players[ELF]!.to = 10
    const { events } = run(engine, state, foul)
    expect(armour(events)).toMatchObject({ red: 10, broken: true, modifiers: [{ name: '-1 net assist', value: -1 }] })
    expect(injuries(events)).toEqual([{ type: 'injured', playerId: ELF, result: 'stunned' }])
    expect(events.findIndex((e) => e.type === 'injured')).toBeLessThan(events.findIndex((e) => e.type === 'ejected'))
  })

  it("never break armour on a natural 1, whatever the assists", () => {
    // With TO 2 and +1, a modified 2 would break; the natural 1 holds.
    const state = foulScene({ [ORC2]: { col: 7, row: 5 } }, [1, 9])
    state.players[ELF]!.to = 2
    expect(armour(run(engine, state, foul).events)).toMatchObject({ broken: false })
  })

  it('make an ejected fouler drop the ball', () => {
    // Ejected on a 1; the ball bounces from (5,5) W to (4,5).
    const state = foulScene({}, [1, 5, 4])
    state.ball = { hex: h(5, 5), carrier: ORC }
    expect(run(engine, state, foul).state.ball).toEqual({ hex: h(4, 5), carrier: null })
  })
})
