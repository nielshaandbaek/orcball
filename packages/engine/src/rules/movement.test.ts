import { describe, expect, it } from 'vitest'
import { createEngine } from '../engine'
import { fromColRow, type Hex, toColRow } from '../hex'
import type { Command, GameState, PlayerStatus } from '../state'
import { RULE_MODULES } from '.'
import { enemyTackleZones, reachableHexes, standUpCost } from './movement'
import { roundState, run } from './test-helpers'

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })
const cr = (hex: Hex) => {
  const { col, row } = toColRow(hex)
  return [col, row]
}

// Board sketch around the action (odd rows have 18 hexes, even rows 17 sitting
// half a hex in):
//
//   row 4      (5,4) (6,4) (7,4) (8,4)
//   row 5   (5,5) (6,5) (7,5) (8,5) (9,5)
//   row 6      (5,6) (6,6) (7,6) (8,6)
//
// The Orc Blitzer (MA 6, AG 6+) moves for home; Elves stand in the way.
const BLITZER = 'home-blitzer-1'

type Placement = { col: number; row: number; status?: PlayerStatus; winded?: boolean }

function scene(placements: Record<string, Placement>, faces: number[] = []): GameState {
  const state = roundState({ home: 0, away: 0, faces })
  for (const [id, p] of Object.entries(placements)) {
    const player = state.players[id]!
    player.hex = h(p.col, p.row)
    player.status = p.status ?? 'standing'
    player.winded = p.winded ?? false
  }
  return state
}

const activate = (action: 'move' | 'blitz' | 'block' = 'move', playerId = BLITZER): Command => ({
  type: 'activate',
  playerId,
  action,
})
const step = (col: number, row: number, dodge = false): Command =>
  dodge ? { type: 'move', to: h(col, row), dodge: true } : { type: 'move', to: h(col, row) }
const reach = (state: GameState, col: number, row: number, playerId = BLITZER) =>
  reachableHexes(state, playerId).find((r) => cr(r.hex).join() === `${col},${row}`)
const moves = (state: GameState) =>
  engine
    .legalCommands(state)
    .filter((c) => c.type === 'move')
    .map((c) => (c.type === 'move' ? [...cr(c.to), c.dodge ? 'dodge' : 'step'] : []))

describe('moving', () => {
  it('moves one hex per MA point, in any of the 6 directions', () => {
    const state = run(engine, scene({ [BLITZER]: { col: 5, row: 5 } }), activate()).state
    expect(moves(state)).toEqual([
      [6, 5, 'step'],
      [5, 6, 'step'],
      [4, 6, 'step'],
      [4, 5, 'step'],
      [4, 4, 'step'],
      [5, 4, 'step'],
    ])
    const after = run(engine, state, step(6, 5), step(7, 5))
    expect(after.state.players[BLITZER]!.hex).toEqual(h(7, 5))
    expect(after.state.activation!.maUsed).toBe(2)
    expect(after.events).toContainEqual({ type: 'moved', playerId: BLITZER, path: [h(6, 5), h(7, 5)] })
  })

  it('carries the ball along with the player', () => {
    const state = scene({ [BLITZER]: { col: 5, row: 5 } })
    state.ball = { hex: h(5, 5), carrier: BLITZER }
    const after = run(engine, run(engine, state, activate()).state, step(6, 5)).state
    expect(after.ball).toEqual({ hex: h(6, 5), carrier: BLITZER })
  })

  it('reaches as far as MA plus Sprint along a row', () => {
    const state = scene({ [BLITZER]: { col: 5, row: 5 } })
    expect(reach(state, 11, 5)).toMatchObject({ cost: 6, sprint: false })
    expect(reach(state, 13, 5)).toMatchObject({ cost: 8, sprint: true })
    expect(reach(state, 14, 5)).toBeUndefined()
  })

  it("can't enter occupied hexes or leave the pitch", () => {
    const state = run(
      engine,
      scene({ [BLITZER]: { col: 1, row: 1 }, 'home-lineman-1': { col: 2, row: 1 } }),
      activate(),
    ).state
    expect(moves(state)).toEqual([[1, 2, 'step']])
    expect(reach(state, 2, 1)).toBeUndefined()
  })

  it("doesn't move on a Block action", () => {
    const state = run(engine, scene({ [BLITZER]: { col: 5, row: 5 } }), activate('block')).state
    expect(moves(state)).toEqual([])
  })
})

describe('tackle zones', () => {
  it('come from standing enemies on all 6 adjacent hexes', () => {
    const state = scene({ [BLITZER]: { col: 5, row: 5 }, 'away-lineman-1': { col: 8, row: 5 } })
    for (const [c, r] of [[9, 5], [8, 6], [7, 6], [7, 5], [7, 4], [8, 4]]) {
      expect(enemyTackleZones(state, h(c!, r!), 'home')).toBe(1)
    }
    expect(enemyTackleZones(state, h(6, 5), 'home')).toBe(0)
    // A team's own players don't count against it.
    expect(enemyTackleZones(state, h(7, 5), 'away')).toBe(0)
  })

  it.each<PlayerStatus>(['prone', 'stunned'])("don't come from %s players", (status) => {
    const state = scene({ [BLITZER]: { col: 5, row: 5 }, 'away-lineman-1': { col: 8, row: 5, status } })
    expect(enemyTackleZones(state, h(7, 5), 'home')).toBe(0)
  })

  it("don't come from Winded players", () => {
    const state = scene({ [BLITZER]: { col: 5, row: 5 }, 'away-lineman-1': { col: 8, row: 5, winded: true } })
    expect(enemyTackleZones(state, h(7, 5), 'home')).toBe(0)
    expect(reach(state, 9, 4)).toMatchObject({ stops: false, dodges: 0 })
  })

  it('end the move when the player steps in without dodging, with no roll', () => {
    const state = run(engine, scene({ [BLITZER]: { col: 5, row: 5 }, 'away-lineman-1': { col: 8, row: 5 } }), activate()).state
    const after = run(engine, state, step(6, 5), step(7, 5))
    expect(after.events.filter((e) => e.type === 'rolled')).toEqual([])
    expect(after.state.activation!.stopped).toBe(true)
    expect(moves(after.state)).toEqual([])
    expect(engine.legalCommands(after.state)).toContainEqual({ type: 'endActivation' })
  })

  it('cost +1 MA to leave (Disengage), with no roll', () => {
    const state = run(engine, scene({ [BLITZER]: { col: 7, row: 5 }, 'away-lineman-1': { col: 8, row: 5 } }), activate()).state
    expect(reach(state, 6, 5)).toMatchObject({ cost: 2, disengages: 1 })
    expect(reach(state, 5, 5)).toMatchObject({ cost: 3, disengages: 1 })
    const after = run(engine, state, step(6, 5))
    expect(after.state.activation!.maUsed).toBe(2)
    expect(after.events.filter((e) => e.type === 'rolled')).toEqual([])
  })
})

describe('Dodge', () => {
  // Two Elves mark (7, 5): dodging into it is AG 6+ at −1 for the second tackle zone.
  const twoMarkers = (faces: number[], momentum = 0) => {
    const state = scene(
      { [BLITZER]: { col: 6, row: 5 }, 'away-lineman-1': { col: 8, row: 5 }, 'away-lineman-2': { col: 7, row: 6 } },
      faces,
    )
    state.teams.home.momentum = momentum
    return run(engine, state, activate()).state
  }

  it('is offered as an alternative to stopping, with its odds', () => {
    const state = twoMarkers([])
    expect(moves(state)).toContainEqual([7, 5, 'step'])
    expect(moves(state)).toContainEqual([7, 5, 'dodge'])
    expect(engine.previewRoll(state, step(7, 5, true))).toEqual({
      test: 'Dodge',
      target: 6,
      modifiers: [{ name: '1 extra tackle zone', value: -1 }],
      chance: 0.4,
    })
    expect(engine.previewRoll(state, step(7, 5))).toBeNull()
  })

  it('has no modifier for a single tackle zone', () => {
    const state = run(
      engine,
      scene({ [BLITZER]: { col: 6, row: 5 }, 'away-lineman-1': { col: 8, row: 5 } }),
      activate(),
    ).state
    expect(engine.previewRoll(state, step(7, 5, true))).toMatchObject({ modifiers: [], chance: 0.5 })
  })

  it('keeps the player moving on a success, and leaving that hex costs nothing extra', () => {
    const after = run(engine, twoMarkers([7]), step(7, 5, true))
    expect(after.events).toContainEqual(expect.objectContaining({ type: 'rolled', test: 'Dodge', natural: 7, success: true }))
    expect(after.state.activation).toMatchObject({ stopped: false, maUsed: 1, freeLeave: h(7, 5) })
    const on = run(engine, after.state, step(6, 6))
    expect(on.state.activation!.maUsed).toBe(2)
  })

  it('knocks the player down on a failure and ends the activation', () => {
    // 6 fails the Dodge; red 2 doesn't break TO 9, so the Blitzer is just prone.
    const after = run(engine, twoMarkers([6, 2, 5]), step(7, 5, true))
    expect(after.events).toContainEqual(expect.objectContaining({ type: 'rolled', test: 'Dodge', natural: 6, success: false }))
    expect(after.events).toContainEqual({ type: 'knockedDown', playerId: BLITZER })
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: BLITZER, failed: true })
    expect(after.state.players[BLITZER]).toMatchObject({ hex: h(7, 5), status: 'prone' })
    expect(after.state.doubleActivation).toEqual({ team: 'away', left: 2 })
  })

  it('can be re-rolled with Momentum', () => {
    const failed = run(engine, twoMarkers([2, 9], 2), step(7, 5, true)).state
    expect(failed.pending).toMatchObject({ kind: 'movement.dodge', team: 'home' })
    const after = run(engine, failed, { type: 'decide', choice: 'reroll' })
    expect(after.state.players[BLITZER]!.status).toBe('standing')
    expect(after.state.activation).toMatchObject({ freeLeave: h(7, 5), stopped: false })
    expect(after.state.teams.home.momentum).toBe(1)
  })

  it('falls if the coach accepts the failure', () => {
    const failed = run(engine, twoMarkers([2, 2, 5], 2), step(7, 5, true)).state
    const after = run(engine, failed, { type: 'decide', choice: 'accept' })
    expect(after.state.players[BLITZER]!.status).toBe('prone')
    expect(after.state.activation).toBeNull()
  })

  it("isn't offered when there's no MA left to keep going", () => {
    const state = twoMarkers([])
    state.activation!.maUsed = 7
    expect(moves(state)).toContainEqual([7, 5, 'step'])
    expect(moves(state)).not.toContainEqual([7, 5, 'dodge'])
  })
})

describe('Sprint', () => {
  it('gives up to +2 MA with no roll, and leaves the player Winded', () => {
    let state = run(engine, scene({ [BLITZER]: { col: 1, row: 5 } }), activate()).state
    const path = [2, 3, 4, 5, 6, 7].map((c) => step(c, 5))
    state = run(engine, state, ...path).state
    expect(state.players[BLITZER]!.winded).toBe(false)
    const sprint = run(engine, state, step(8, 5))
    expect(sprint.events).toContainEqual({ type: 'winded', playerId: BLITZER })
    expect(sprint.events.filter((e) => e.type === 'rolled')).toEqual([])
    expect(sprint.state.players[BLITZER]!.winded).toBe(true)
    const last = run(engine, sprint.state, step(9, 5)).state
    expect(last.activation!.maUsed).toBe(8)
    expect(moves(last)).toEqual([])
  })

  it('is cleared at the start of the next activation', () => {
    const state = scene({ [BLITZER]: { col: 5, row: 5, winded: true } })
    expect(run(engine, state, activate()).state.players[BLITZER]!.winded).toBe(false)
  })
})

describe('standing up', () => {
  it.each([
    ['home-blitzer-1', 6, 3],
    ['home-black-orc-1', 4, 2],
    ['home-lineman-1', 5, 3],
  ])('costs half MA rounded up for %s (MA %i → %i)', (id, _ma, cost) => {
    const state = scene({ [id]: { col: 5, row: 5, status: 'prone' } })
    expect(standUpCost(state, state.players[id]!)).toBe(cost)
  })

  it('comes first for a prone player, with no roll, then they can move on', () => {
    const state = run(engine, scene({ [BLITZER]: { col: 5, row: 5, status: 'prone' } }), activate()).state
    expect(engine.legalCommands(state)).toHaveLength(2)
    expect(engine.legalCommands(state)).toEqual(expect.arrayContaining([{ type: 'standUp' }, { type: 'endActivation' }]))
    const up = run(engine, state, { type: 'standUp' })
    expect(up.events).toEqual([{ type: 'stoodUp', playerId: BLITZER }])
    expect(up.state.players[BLITZER]!.status).toBe('standing')
    expect(up.state.activation!.maUsed).toBe(3)
    expect(moves(up.state)).toHaveLength(6)
  })

  it('is part of the reachable cost for a prone player', () => {
    const state = scene({ [BLITZER]: { col: 5, row: 5, status: 'prone' } })
    expect(reach(state, 8, 5)).toMatchObject({ cost: 6, standUp: true, sprint: false })
    expect(reach(state, 10, 5)).toMatchObject({ cost: 8, sprint: true })
    expect(reach(state, 11, 5)).toBeUndefined()
  })
})

describe('reachable hexes', () => {
  it('flag Disengage, Sprint and Dodge for the UI', () => {
    // Blitzer at (7,5) marked by an Elf at (8,5); another Elf at (11,5) further on.
    const state = scene({
      [BLITZER]: { col: 7, row: 5 },
      'away-lineman-1': { col: 8, row: 5 },
      'away-lineman-2': { col: 11, row: 5 },
    })
    // Next to the far Elf without a Dodge: Disengage, go all the way round the
    // first Elf's zone (7 MA, so a Sprint), and stop.
    expect(reach(state, 10, 5)).toMatchObject({ cost: 7, disengages: 1, dodges: 0, stops: true, sprint: true })
  })

  it('flag the Dodges a path needs', () => {
    // Along the top touchline from the corner, an Elf at (3,2) marks (3,1) and
    // (4,1). Straight along row 1 to (6,1) is 5 MA with two Dodges, each
    // dodged-into hex free to leave. Going round below avoids the Dodges but
    // costs 8: (1,2) (2,3) (2,4) (3,4) (4,4) (5,3) (5,2) (6,1).
    const placements = { 'away-lineman-1': { col: 3, row: 2 } }
    const blitzer = scene({ ...placements, [BLITZER]: { col: 1, row: 1 } })
    expect(reach(blitzer, 6, 1)).toMatchObject({ cost: 8, dodges: 0, sprint: true })

    // A Black Orc has only 6 with Sprint, so the Dodges are the only way.
    const orc = 'home-black-orc-1'
    const slow = scene({ ...placements, [orc]: { col: 1, row: 1 } })
    const target = reach(slow, 6, 1, orc)!
    expect(target).toMatchObject({ cost: 5, dodges: 2, disengages: 0, sprint: true, stops: false })
    expect(target.path.map(cr)).toEqual([
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
      [6, 1],
    ])
  })

  it('prefer fewer Dodges over a cheaper path', () => {
    // A wall of tackle zones straight ahead; going round costs more but needs no Dodge.
    const state = scene({ [BLITZER]: { col: 5, row: 5 }, 'away-lineman-1': { col: 7, row: 5 } })
    const target = reach(state, 9, 5)!
    expect(target.dodges).toBe(0)
    expect(target.cost).toBeGreaterThan(4)
  })

  it("give each step of the path, so the UI can send them one by one", () => {
    const state = scene({ [BLITZER]: { col: 5, row: 5 } })
    let current = run(engine, state, activate()).state
    for (const hex of reach(state, 8, 4)!.path) current = engine.apply(current, { type: 'move', to: hex }).state
    expect(current.players[BLITZER]!.hex).toEqual(h(8, 4))
  })
})
