import { describe, expect, it } from 'vitest'
import { type RuleConfig, rulesV18, rulesV19 } from '../config'
import { successChance } from '../dice'
import { createEngine } from '../engine'
import { allPitchHexes, distance, fromColRow, type Hex, hexEquals } from '../hex'
import { createMatch } from '../match'
import { forcedRng } from '../rng'
import type { ActionType, Command, GameState, TeamId } from '../state'
import { RULE_MODULES } from '.'
import { reachableHexes } from './movement'
import { run } from './test-helpers'

// Rules v19: one skill per position. The Brute gets Guard (#153); the Dancer
// gets Leap in place of Block, and the Catchers keep Catch only (#154).

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })

const BLITZER = 'home-blitzer-1'
const BRUTE = 'home-brute-1'
const ORC = 'home-lineman-1'
const DANCER = 'away-dancer-1' // MA 7, AG 4+
const ELF = 'away-lineman-1'
const ELF2 = 'away-lineman-2'

/** Round 1 under `config`, these players only, standing; no Momentum, so misses aren't re-rolled. */
function v19(placements: Record<string, [number, number]>, faces: number[] = [], { config = rulesV19 as RuleConfig, turn = 'home' as TeamId } = {}): GameState {
  const state = createMatch(config, [config.rosters.orcs!, config.rosters.elves!], 1)
  for (const p of Object.values(state.players)) p.hex = null
  for (const [id, [col, row]] of Object.entries(placements)) {
    state.players[id]!.hex = h(col, row)
    state.players[id]!.status = 'standing'
  }
  Object.assign(state, { pending: null, phase: 'Round', round: 1, kickingTeam: 'away', openingKicker: 'away', firstGo: turn, turnOwner: turn })
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  state.rng = forcedRng(faces)
  return state
}

const activate = (playerId: string, action: ActionType = 'move'): Command => ({ type: 'activate', playerId, action })
const leapsIn = (state: GameState) => engine.availableCommands(state).flatMap((o) => (o.command.type === 'leap' ? [o.command.to] : []))

describe('rules v19 config', () => {
  it('is v18 with Guard for the Brute, Leap for the Dancer and Catch only for the Catchers', () => {
    const { id: _a, rosters: r19, ...rest19 } = rulesV19
    const { id: _b, rosters: r18, ...rest18 } = rulesV18
    expect(rulesV19.id).toBe('rules-v19')
    expect(rest19).toEqual(rest18)
    const orcs = r18.orcs!.positions
    expect(r19.orcs!.positions).toEqual({ ...orcs, brute: { ...orcs.brute!, skills: ['Guard'] } })
    const elves = r18.elves!.positions
    expect(r19.elves!.positions).toEqual({ ...elves, dancer: { ...elves.dancer!, skills: ['Leap'] }, catcher: { ...elves.catcher!, skills: ['Catch'] } })
  })

  it('gives every position exactly one skill', () => {
    for (const roster of Object.values(rulesV19.rosters)) for (const p of Object.values(roster.positions)) expect(p.skills, p.name).toHaveLength(1)
  })
})

describe('Guard for the Brute (#153)', () => {
  // The Blitzer at (5,5) blocks the Elf at (6,5); the Brute at (6,4) is next to the Elf, and marked by a second Elf at (6,3).
  const declared = (config: RuleConfig) =>
    run(engine, v19({ [BLITZER]: [5, 5], [ELF]: [6, 5], [BRUTE]: [6, 4], [ELF2]: [6, 3] }, [], { config }), activate(BLITZER, 'block'), { type: 'block', targetId: ELF }).events.find(
      (e) => e.type === 'blockDeclared',
    )

  it('assists the attacker while marked in v19, not in v18', () => {
    expect(declared(rulesV19)).toMatchObject({ attack: 4, defence: 3 })
    expect(declared(rulesV18)).toMatchObject({ attack: 3, defence: 3 })
  })

  it('assists the defender while marked in v19, not in v18', () => {
    // The Elf blocks the Orc Lineman at (5,5); the Brute at (5,4), marked by the second Elf at (5,3), guards him.
    const block = (config: RuleConfig) =>
      run(engine, v19({ [ELF]: [6, 5], [ORC]: [5, 5], [BRUTE]: [5, 4], [ELF2]: [5, 3] }, [], { config, turn: 'away' }), activate(ELF, 'block'), { type: 'block', targetId: ORC }).events.find(
        (e) => e.type === 'blockDeclared',
      )
    expect(block(rulesV19)).toMatchObject({ attack: 3, defence: 4 })
    expect(block(rulesV18)).toMatchObject({ attack: 3, defence: 3 })
  })
})

describe('Leap for the Dancer (#154)', () => {
  // The Dancer at (10,5), marked by the Orc Lineman at (9,5); (8,5) is 2 hexes on, past him.
  const marked = (faces: number[] = [], { config = rulesV19 as RuleConfig, action = 'move' as ActionType } = {}) =>
    run(engine, v19({ [DANCER]: [10, 5], [ORC]: [9, 5] }, faces, { config, turn: 'away' }), activate(DANCER, action)).state
  const leap: Command = { type: 'leap', to: h(8, 5) }

  it('is offered to every empty hex on the pitch 1 or 2 away, in any direction, over a player', () => {
    const tos = leapsIn(marked())
    const within2 = allPitchHexes().filter((x) => [1, 2].includes(distance(x, h(10, 5))) && !hexEquals(x, h(9, 5)))
    expect(tos).toHaveLength(17)
    expect(new Set(tos.map((x) => `${x.q},${x.r}`))).toEqual(new Set(within2.map((x) => `${x.q},${x.r}`)))
    expect(tos).toContainEqual(h(8, 5))
    // Not onto a player.
    const state = marked()
    state.players[ELF]!.hex = h(8, 5)
    expect(leapsIn(state)).not.toContainEqual(h(8, 5))
  })

  it('is offered in a Blitz too, but not in a Block, nor in v18', () => {
    expect(leapsIn(marked([], { action: 'blitz' }))).toContainEqual(h(8, 5))
    expect(leapsIn(marked([], { action: 'block' }))).toEqual([])
    expect(leapsIn(marked([], { config: rulesV18 }))).toEqual([])
  })

  it('previews an unmodified Agility roll', () => {
    expect(engine.previewRoll(marked(), leap)).toEqual({ test: 'Leap', target: 4, modifiers: [], chance: successChance(4, []) })
  })

  it('lands him there for 2 MA on a success, with no Dodge for leaving the tackle zone', () => {
    const { state, events } = run(engine, marked([4]), leap)
    expect(state.players[DANCER]!.hex).toEqual(h(8, 5))
    expect(state.activation).toMatchObject({ maUsed: 2, leapt: true })
    expect(events.filter((e) => e.type === 'rolled').map((e) => (e as { test: string }).test)).toEqual(['Leap'])
    expect(events).toContainEqual({ type: 'moved', playerId: DANCER, path: [h(10, 5), h(8, 5)] })
  })

  it('can land next to him: out of the tackle zone with the Leap roll, no Dodge', () => {
    const { state, events } = run(engine, marked([4]), { type: 'leap', to: h(11, 5) })
    expect(state.players[DANCER]!.hex).toEqual(h(11, 5))
    expect(state.activation!.maUsed).toBe(2)
    expect(events.filter((e) => e.type === 'rolled').map((e) => (e as { test: string }).test)).toEqual(['Leap'])
  })

  it('is once per activation: plain steps still, no second Leap', () => {
    const after = run(engine, marked([4]), leap).state
    expect(leapsIn(after)).toEqual([])
    expect(engine.availableCommands(after).some((o) => o.command.type === 'move')).toBe(true)
  })

  it('knocks him down where he lands on a failure, and ends the activation', () => {
    // Leap 3 fails; red 1 holds the armour.
    const { state, events } = run(engine, marked([3, 1, 1]), leap)
    expect(state.players[DANCER]).toMatchObject({ hex: h(8, 5), status: 'prone' })
    expect(events).toContainEqual({ type: 'knockedDown', playerId: DANCER })
    expect(events).toContainEqual({ type: 'activationEnded', playerId: DANCER, failed: true })
  })

  it('can be re-rolled with Momentum', () => {
    const state = marked([3, 4])
    state.teams.away.momentum = 1
    const failed = run(engine, state, leap).state
    expect(failed.pending).toMatchObject({ kind: 'movement.leap', team: 'away' })
    const after = run(engine, failed, { type: 'decide', choice: 'reroll' }).state
    expect(after.players[DANCER]).toMatchObject({ hex: h(8, 5), status: 'standing' })
    expect(after.activation?.playerId).toBe(DANCER)
  })

  it('can use Sprint MA, leaving him Winded, but not more', () => {
    // MA 7, Sprint +1: with 6 used, a Leap takes him to 8.
    const state = marked([4])
    state.activation!.maUsed = 6
    const after = run(engine, state, leap)
    expect(after.state.players[DANCER]!.winded).toBe(true)
    const tooFar = marked()
    tooFar.activation!.maUsed = 7
    expect(leapsIn(tooFar)).toEqual([])
  })

  it('is in the reach only when asked (the computer), as one step', () => {
    const state = marked()
    expect(reachableHexes(state, DANCER).some((r) => r.leapStep !== undefined)).toBe(false)
    const over = reachableHexes(state, DANCER, { leaps: true }).find((r) => r.hex.q === h(8, 5).q && r.hex.r === h(8, 5).r)
    expect(over).toMatchObject({ path: [h(8, 5)], leapStep: 0, cost: 2, dodges: 1 })
  })
})
