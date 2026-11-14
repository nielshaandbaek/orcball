import { describe, expect, it } from 'vitest'
import { currentPositionId, loadRuleConfig, type RuleConfig, rulesV21, rulesV22 } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex, hexKey } from '../hex'
import type { Command, GameEvent, GameState } from '../state'
import { RULE_MODULES } from '.'
import { type Placement, run, scene } from './test-helpers'

// Rules v22: v21 with Crushing Blow for the Orc Brute in place of Guard
// (#184). +1 on the armour or injury die of a player his block knocks down,
// wherever it helps; natural 1s and 10s stand.
//
//   row 4      (5,4) (6,4) (7,4)
//   row 5   (5,5) (6,5) (7,5) (8,5)
//   row 6      (5,6) (6,6) (7,6)

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })
const decide = (choice: string): Command => ({ type: 'decide', choice })

const BRUTE = 'home-black-orc-1' // the scene's v10 id for the Brute: ST 4, TO 9, Crushing Blow
const BLITZER = 'home-blitzer-1' // ST 3, Block
const ORC = 'home-lineman-1' // ST 3, Brace
const ELF = 'away-lineman-1' // ST 3, TO 7, Brace

/** A scene with the config's skills on every player, Momentum off, and the Elf already activated so he can't Brace. */
function at(config: RuleConfig, placements: Record<string, Placement>, faces: number[] = []): GameState {
  const state = scene(placements, faces)
  state.config = config
  const rosters = { home: config.rosters.orcs!, away: config.rosters.elves! }
  for (const p of Object.values(state.players)) {
    // The scene has v10 ids: its Black Orc is the Brute.
    const position = rosters[p.team].positions[currentPositionId(p.position)]
    if (!position) continue
    p.skills = [...position.skills]
    p.st = position.st
    p.to = position.to
  }
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  state.players[ELF]!.activatedThisRound = true
  return state
}

const armour = (events: GameEvent[]) => events.filter((e) => e.type === 'armourRolled')
const injured = (events: GameEvent[]) => events.filter((e) => e.type === 'injured')

/** The attacker Tackles the Elf (a 6 succeeds), pushes him to (7,5) and stays: then red and white. */
function tackled(attacker: string, red: number, white: number, config: RuleConfig = rulesV22) {
  const state = at(config, { [attacker]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } }, [6, red, white])
  return run(engine, state, { type: 'activate', playerId: attacker, action: 'block' }, { type: 'block', targetId: ELF }, decide('tackle'), decide(hexKey(h(7, 5))), decide('stay'))
}

describe('rules v22 config', () => {
  it('is v21 with Crushing Blow in place of Guard for the Orc Brute', () => {
    const { id: _a, rosters: r22, ...rest22 } = rulesV22
    const { id: _b, rosters: r21, ...rest21 } = rulesV21
    expect(rulesV22.id).toBe('rules-v22')
    expect(rest22).toEqual(rest21)
    expect(r22.orcs!.positions.brute!.skills).toEqual(['Crushing Blow'])
    const brute = { ...r22.orcs!.positions.brute!, skills: ['Guard'] }
    expect({ ...r22, orcs: { ...r22.orcs!, positions: { ...r22.orcs!.positions, brute } } }).toEqual(r21)
  })

  it('knows Crushing Blow as a skill', () => {
    expect(() => loadRuleConfig(rulesV22)).not.toThrow()
  })
})

describe('Crushing Blow (#184)', () => {
  it('breaks armour that held by 1: red 6 + 1 against TO 7', () => {
    const { events } = tackled(BRUTE, 6, 3)
    expect(armour(events)).toEqual([{ type: 'armourRolled', playerId: ELF, red: 6, white: 3, modifiers: [{ name: 'Crushing Blow', value: 1 }], broken: true }])
    expect(injured(events)).toEqual([{ type: 'injured', playerId: ELF, result: 'stunned' }])
  })

  it('goes on the white die once the armour is broken: 7 + 1 is Out, 9 + 1 a Casualty', () => {
    const out = tackled(BRUTE, 8, 7)
    expect(armour(out.events)).toEqual([
      { type: 'armourRolled', playerId: ELF, red: 8, white: 7, modifiers: [], broken: true, injuryModifiers: [{ name: 'Crushing Blow', value: 1 }] },
    ])
    expect(injured(out.events)).toEqual([{ type: 'injured', playerId: ELF, result: 'out' }])
    expect(injured(tackled(BRUTE, 8, 9).events)).toEqual([{ type: 'injured', playerId: ELF, result: 'casualty' }])
  })

  it('does nothing when the armour holds by more than 1', () => {
    const { events } = tackled(BRUTE, 5, 9)
    expect(armour(events)).toEqual([{ type: 'armourRolled', playerId: ELF, red: 5, white: 9, modifiers: [], broken: false }])
    expect(injured(events)).toEqual([])
  })

  it('lets natural rolls stand: red 1 never breaks, white 1 is still Stunned', () => {
    const state = at(rulesV22, { [BRUTE]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } }, [6, 1, 9])
    state.players[ELF]!.to = 2
    const { events } = run(engine, state, { type: 'activate', playerId: BRUTE, action: 'block' }, { type: 'block', targetId: ELF }, decide('tackle'), decide(hexKey(h(7, 5))), decide('stay'))
    expect(armour(events)).toMatchObject([{ red: 1, modifiers: [], broken: false }])
    expect(injured(tackled(BRUTE, 9, 1).events)).toEqual([{ type: 'injured', playerId: ELF, result: 'stunned' }])
  })

  it('is only for players who have it: the same rolls for an Orc Lineman, or the Blitzer, or the v21 Brute, change nothing', () => {
    expect(armour(tackled(ORC, 6, 3).events)).toMatchObject([{ broken: false }])
    expect(armour(tackled(BLITZER, 6, 3).events)).toMatchObject([{ broken: false }])
    expect(injured(tackled(ORC, 8, 7).events)).toEqual([{ type: 'injured', playerId: ELF, result: 'stunned' }])
    expect(armour(tackled(BRUTE, 6, 3, rulesV21).events)).toMatchObject([{ broken: false }])
  })

  it('counts on Both down for the defender, but not for the Brute’s own fall', () => {
    // Tackle 3 misses; the Elves choose Both down. Brute: red 8 against his TO 9 holds. Elf: red 6 + 1 breaks, white 3.
    const state = at(rulesV22, { [BRUTE]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } }, [3, 8, 5, 6, 3])
    const { events } = run(engine, state, { type: 'activate', playerId: BRUTE, action: 'block' }, { type: 'block', targetId: ELF }, decide('tackle'), decide('bothDown'))
    expect(armour(events)).toEqual([
      { type: 'armourRolled', playerId: BRUTE, red: 8, white: 5, modifiers: [], broken: false },
      { type: 'armourRolled', playerId: ELF, red: 6, white: 3, modifiers: [{ name: 'Crushing Blow', value: 1 }], broken: true },
    ])
  })

  it("doesn't count on a foul", () => {
    // Red 6 against TO 7 holds, as it would without the skill.
    const state = at(rulesV22, { [BRUTE]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5, status: 'prone' } }, [6, 3])
    const { events } = run(engine, state, { type: 'activate', playerId: BRUTE, action: 'foul' }, { type: 'foul', targetId: ELF })
    expect(armour(events)).toMatchObject([{ red: 6, modifiers: [], broken: false }])
  })

  it("doesn't count when he is the defender", () => {
    // The Orc Lineman can't Brace (activated). The Elf Tackles the Brute, 3 against 4: 9 succeeds; red 8 against TO 9 holds.
    const state = at(rulesV22, { [ELF]: { col: 5, row: 5 }, [BRUTE]: { col: 6, row: 5 } }, [9, 8, 3])
    state.players[ELF]!.activatedThisRound = false
    state.turnOwner = 'away'
    const { events } = run(engine, state, { type: 'activate', playerId: ELF, action: 'block' }, { type: 'block', targetId: BRUTE }, decide('tackle'), decide(hexKey(h(7, 5))), decide('stay'))
    expect(armour(events)).toMatchObject([{ playerId: BRUTE, red: 8, modifiers: [], broken: false }])
  })
})
