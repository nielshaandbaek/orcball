import { describe, expect, it } from 'vitest'
import { rulesV10, rulesV11, ruleConfigHash } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex } from '../hex'
import type { Command, GameState } from '../state'
import { RULE_MODULES } from '.'
import { reachableHexes } from './movement'
import { type Placement, run, scene } from './test-helpers'

// Rules v11: a Dodge on every step out of an enemy tackle zone (entering one
// is free and doesn't stop the player), the Strength Disengage, and no Shove
// for a weaker attacker.
//
//   row 4      (5,4) (6,4) (7,4)
//   row 5   (5,5) (6,5) (7,5) (8,5)
//   row 6      (5,6) (6,6) (7,6)

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })

const BLITZER = 'home-blitzer-1'
const ORC = 'home-lineman-1'
const ELF = 'away-lineman-1'
const ELF2 = 'away-lineman-2'
const CATCHER = 'away-catcher-1'

function v11(placements: Record<string, Placement>, faces: number[] = []): GameState {
  const state = scene(placements, faces)
  state.config = rulesV11
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  return state
}

const activate = (playerId = BLITZER, action: 'move' | 'block' = 'move'): Command => ({ type: 'activate', playerId, action })
const step = (col: number, row: number): Command => ({ type: 'move', to: h(col, row) })
const dodge = (col: number, row: number): Command => ({ type: 'move', to: h(col, row), dodge: true })
const disengage = (col: number, row: number): Command => ({ type: 'move', to: h(col, row), disengage: true })
const moves = (state: GameState) => engine.legalCommands(state).filter((c) => c.type === 'move')

describe('rules v11 config', () => {
  it('loads, and leaves the v10 config (and its hash) as it was', () => {
    expect(rulesV11.movement).toMatchObject({ tackleZones: 'dodgeOnLeaving', strengthDisengage: true, disengageCost: 0 })
    expect(rulesV10.movement.tackleZones).toBeUndefined()
    expect(ruleConfigHash(rulesV11)).not.toBe(ruleConfigHash(rulesV10))
  })
})

describe('entering a tackle zone (v11)', () => {
  it("doesn't stop the player or roll", () => {
    const state = v11({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 7, row: 5 } })
    const active = run(engine, state, activate()).state
    expect(moves(active)).toContainEqual(step(6, 5))
    expect(moves(active)).not.toContainEqual(dodge(6, 5))
    const after = run(engine, active, step(6, 5))
    expect(after.events.some((e) => e.type === 'rolled')).toBe(false)
    expect(after.state.activation).toMatchObject({ stopped: false, maUsed: 1 })
  })
})

describe('leaving a tackle zone (v11)', () => {
  // The Blitzer (AG 6+) has walked up next to the Elf at (7,5).
  const marked = (faces: number[]) =>
    run(engine, v11({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 7, row: 5 } }, faces), activate(), step(6, 5)).state

  it('is always a Dodge, with no Disengage cost', () => {
    const state = marked([6])
    expect(moves(state)).toContainEqual(dodge(5, 5))
    expect(moves(state)).not.toContainEqual(step(5, 5))
    const after = run(engine, state, dodge(5, 5))
    expect(after.events).toContainEqual(expect.objectContaining({ type: 'rolled', test: 'Dodge', success: true }))
    expect(after.state.activation).toMatchObject({ maUsed: 2, stopped: false })
    expect(moves(after.state)).toContainEqual(step(4, 5))
  })

  it('counts −1 for each enemy tackle zone on the hex dodged into', () => {
    const state = marked([])
    expect(engine.previewRoll(state, dodge(5, 5))).toMatchObject({ target: 6, modifiers: [], chance: 0.5 })
    // (6,4) is next to the Elf too.
    expect(engine.previewRoll(state, dodge(6, 4))).toMatchObject({
      modifiers: [{ name: '1 tackle zone', value: -1 }],
      chance: 0.4,
    })
  })

  it('leaves the player Knocked Down in the hex dodged into on a failure', () => {
    const after = run(engine, marked([3, 2, 1]), dodge(5, 5))
    expect(after.state.players[BLITZER]).toMatchObject({ hex: h(5, 5), status: 'prone' })
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: BLITZER, failed: true })
    expect(after.state.doubleActivation).toEqual({ team: 'away', left: 2 })
  })

  it('offers no Strength Disengage once the player has stepped', () => {
    expect(moves(marked([]))).not.toContainEqual(disengage(5, 5))
  })
})

describe('Strength Disengage (v11)', () => {
  it('steps 1 hex out of the tackle zones with no roll, and ends the move', () => {
    // Blitzer ST 3 against the Elf's ST 3.
    const state = run(engine, v11({ [BLITZER]: { col: 6, row: 5 }, [ELF]: { col: 7, row: 5 } }), activate()).state
    expect(moves(state)).toContainEqual(disengage(5, 5))
    // (6,4) is still next to the Elf.
    expect(moves(state)).not.toContainEqual(disengage(6, 4))
    const after = run(engine, state, disengage(5, 5))
    expect(after.events.some((e) => e.type === 'rolled')).toBe(false)
    expect(after.events).toContainEqual({ type: 'disengaged', playerId: BLITZER, to: h(5, 5) })
    expect(after.state.activation).toMatchObject({ stopped: true, maUsed: 1 })
    expect(moves(after.state)).toEqual([])
  })

  it('needs the strength against each marker, assists included', () => {
    // A second Elf at (5,4) marks the Blitzer too and assists the first: 3 against 4.
    const state = run(
      engine,
      v11({ [BLITZER]: { col: 6, row: 5 }, [ELF]: { col: 7, row: 5 }, [ELF2]: { col: 5, row: 4 } }),
      activate(),
    ).state
    expect(moves(state).some((c) => c.type === 'move' && c.disengage)).toBe(false)
  })

  it('is not open to a weaker player', () => {
    // On the Elves' go, the Catcher (ST 2) is marked by an Orc Lineman (ST 3).
    const state = v11({ [CATCHER]: { col: 6, row: 5 }, [ORC]: { col: 5, row: 5 } })
    state.turnOwner = 'away'
    const active = run(engine, state, activate(CATCHER)).state
    expect(moves(active).some((c) => c.type === 'move' && c.disengage)).toBe(false)
    expect(moves(active)).toContainEqual(dodge(7, 5))
  })

  it('shows in reachableHexes as a 1-hex move with no Dodge, beside the dodging routes', () => {
    const state = v11({ [BLITZER]: { col: 6, row: 5 }, [ELF]: { col: 7, row: 5 } })
    const reach = reachableHexes(state, BLITZER)
    expect(reach.find((r) => r.hex.q === h(5, 5).q && r.hex.r === h(5, 5).r)).toMatchObject({
      cost: 1,
      dodges: 0,
      disengages: 1,
      stops: true,
    })
    expect(reach.find((r) => r.hex.q === h(4, 5).q && r.hex.r === h(4, 5).r)).toMatchObject({ cost: 2, dodges: 1 })
  })
})

describe('Shove (v11)', () => {
  it('is only offered when the attacker is at least as strong', () => {
    // The Catcher (ST 2) blocks an Orc Lineman (ST 3): Tackle only.
    const state = v11({ [CATCHER]: { col: 6, row: 5 }, [ORC]: { col: 5, row: 5 } })
    state.turnOwner = 'away'
    const asked = run(engine, state, activate(CATCHER, 'block'), { type: 'block', targetId: ORC }).state
    expect(asked.pending?.prompt).toBe('Your total 2 against 3: too weak to Shove. Tackle?')
    expect(asked.pending?.choices.map((c) => c.id)).toEqual(['tackle'])
  })

  it('is offered as before at equal strength', () => {
    const state = v11({ [BLITZER]: { col: 6, row: 5 }, [ELF]: { col: 7, row: 5 } })
    const asked = run(engine, state, activate(BLITZER, 'block'), { type: 'block', targetId: ELF }).state
    expect(asked.pending?.choices.map((c) => c.id)).toEqual(['shove', 'tackle'])
  })
})
