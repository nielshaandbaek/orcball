import { describe, expect, it } from 'vitest'
import { rulesV31, rulesV32 } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex } from '../hex'
import { createMatch } from '../match'
import type { Command, GameEvent, GameState } from '../state'
import { RULE_MODULES } from '.'
import { knockDown, pushedIntoCrowd } from './injury'
import { run, runRule, scene } from './test-helpers'

// Rules v32: v31 with the Undead Mummy at AG 10+ (#269), and the Lizards as
// 3 Warriors, 1 Shaman and 3 Geckoes with Stunty for all but the Warriors
// (#270): enemy tackle zones don't count against their Dodge (Tackle still
// does), and +1 on the white die against them.

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })

describe('rules v32 config', () => {
  it('is v31 with the Mummy at AG 10+ and the new Lizards, and v31 is unchanged', () => {
    const { id: _a, rosters: r32, ...rest32 } = rulesV32
    const { id: _b, rosters: r31, ...rest31 } = rulesV31
    expect(rulesV32.id).toBe('rules-v32')
    expect(rest32).toEqual(rest31)
    const { undead: u32, lizards: l32, ...others32 } = r32
    const { undead: u31, lizards: l31, ...others31 } = r31
    expect(others32).toEqual(others31)
    expect(u32).toEqual({ ...u31!, positions: { ...u31!.positions, mummy: { ...u31!.positions.mummy!, ag: 10 } } })
    expect(u31!.positions.mummy!.ag).toBe(9)
    expect(l32!.traits).toEqual([{ skill: 'Stunty', except: ['warrior'] }])
    expect(l31!.traits).toBeUndefined()
    expect(l32!.positions).toEqual({
      warrior: { ...l31!.positions.warrior!, max: 3 },
      shaman: { ...l31!.positions.shaman!, max: 1 },
      gecko: l31!.positions.gecko,
    })
  })

  it('fields 3 Warriors without Stunty, 1 Shaman and 3 Geckoes with it', () => {
    const state = createMatch(rulesV32, [rulesV32.rosters.lizards!, rulesV32.rosters.undead!], 1)
    const lizards = Object.values(state.players).filter((p) => p.team === 'home')
    expect(lizards).toHaveLength(7)
    expect(lizards.filter((p) => p.position === 'warrior').map((p) => p.skills)).toEqual([['Juggernaut'], ['Juggernaut'], ['Juggernaut']])
    expect(lizards.filter((p) => p.position === 'shaman').map((p) => p.skills)).toEqual([['Sure Hands', 'Stunty']])
    expect(lizards.filter((p) => p.position === 'gecko').map((p) => p.skills)).toEqual([['Dodge', 'Stunty'], ['Dodge', 'Stunty'], ['Dodge', 'Stunty']])
    expect(state.players['away-mummy-1']!.ag).toBe(10)
  })
})

describe('Stunty (#270): tackle zones on the hex he steps into don\'t count against his Dodge', () => {
  // The Elf at (6,5) dodges to (5,5); Orcs mark both hexes.
  //   row 4      (5,4) (6,4) (7,4)
  //   row 5   (5,5) (6,5) (7,5)
  //   row 6      (5,6) (6,6)
  const ELF = 'away-lineman-1'
  const ORC = 'home-lineman-1' // at (7,5), marking the hex he leaves
  const ORC2 = 'home-lineman-2' // at (5,4), marking both hexes
  const ORC3 = 'home-thrower-1' // at (4,5), marking the hex he steps into

  function marked({ stunty = true, tackle = false, alone = false } = {}, faces: number[] = []) {
    const others = alone ? {} : { [ORC2]: { col: 5, row: 4 }, [ORC3]: { col: 4, row: 5 } }
    const state = scene({ [ELF]: { col: 6, row: 5 }, [ORC]: { col: 7, row: 5 }, ...others }, faces)
    state.config = rulesV32
    for (const p of Object.values(state.players)) p.skills = []
    state.players[ELF]!.skills = stunty ? ['Stunty'] : []
    if (tackle) state.players[ORC]!.skills = ['Tackle']
    Object.assign(state, { turnOwner: 'away', firstGo: 'away' })
    state.teams.away.momentum = 0
    return run(engine, state, { type: 'activate', playerId: ELF, action: 'move' }).state
  }
  const dodgeAway: Command = { type: 'move', to: h(5, 5), dodge: true }
  const disengage: Command = { type: 'move', to: h(5, 5), disengage: true }
  const preview = (state: GameState) => engine.previewRoll(state, dodgeAway)!

  it('no tackle-zone modifier for him; two zones are −2 without Stunty', () => {
    expect(preview(marked({ stunty: false })).modifiers).toContainEqual({ name: '2 tackle zones', value: -2 })
    expect(preview(marked())).toMatchObject({ test: 'Dodge', modifiers: [{ name: 'Dodge bonus', value: 1 }] })
  })

  it('in the roll itself, not only the preview', () => {
    const { events } = run(engine, marked({}, [9]), dodgeAway)
    expect(events.find((e) => e.type === 'rolled' && e.test === 'Dodge')).toMatchObject({ modifiers: [{ name: 'Dodge bonus', value: 1 }], success: true })
  })

  it('Tackle still gives −1, and still stops a Strength Disengage', () => {
    expect(preview(marked({ tackle: true })).modifiers).toEqual([
      { name: 'Dodge bonus', value: 1 },
      { name: 'Tackle', value: -1 },
    ])
    const offered = (state: GameState) => engine.availableCommands(state).some((o) => JSON.stringify(o.command) === JSON.stringify(disengage))
    // Marked by the one Orc only, so (5,5) is free of zones.
    expect(offered(marked({ tackle: true, alone: true }))).toBe(false)
    expect(offered(marked({ alone: true }))).toBe(true)
  })
})

describe('Stunty (#270): +1 on the white die against him', () => {
  const GECKO = 'home-lineman-1' // standing in for a Stunty player: TO 9 here
  const ATTACKER = 'away-lineman-1'
  const none = { kind: 'none' } as const
  const injury = (events: GameEvent[]) => events.find((e) => e.type === 'injured')

  function downed(red: number, white: number, { stunty = true, crushingBlow = false } = {}) {
    const state = scene({ [GECKO]: { col: 5, row: 5 }, [ATTACKER]: { col: 6, row: 5 } }, [red, white])
    state.config = rulesV32
    state.players[GECKO]!.skills = stunty ? ['Stunty'] : []
    state.players[ATTACKER]!.skills = crushingBlow ? ['Crushing Blow'] : []
    return runRule(state, (ctx) => knockDown(ctx, GECKO, none, crushingBlow ? state.players[ATTACKER]! : null))
  }

  it('a 7 is Out for him (Stunned without Stunty), and the armour roll shows the +1', () => {
    const { events } = downed(10, 7)
    expect(injury(events)).toEqual({ type: 'injured', playerId: GECKO, result: 'out' })
    expect(events).toContainEqual(expect.objectContaining({ type: 'armourRolled', broken: true, injuryModifiers: [{ name: 'Stunty', value: 1 }] }))
    expect(injury(downed(10, 7, { stunty: false }).events)).toEqual({ type: 'injured', playerId: GECKO, result: 'stunned' })
  })

  it('a 9 is a Casualty; a natural 1 is still Stunned', () => {
    expect(injury(downed(10, 9).events)).toMatchObject({ result: 'casualty' })
    expect(injury(downed(10, 1).events)).toMatchObject({ result: 'stunned' })
  })

  it('no modifier while the armour holds', () => {
    const { events } = downed(2, 9)
    expect(events.find((e) => e.type === 'armourRolled')).not.toHaveProperty('injuryModifiers')
    expect(injury(events)).toBeUndefined()
  })

  it('adds up with Crushing Blow: a 6 becomes 8, Out', () => {
    const { events } = downed(10, 6, { crushingBlow: true })
    expect(events).toContainEqual(expect.objectContaining({ type: 'armourRolled', injuryModifiers: [{ name: 'Crushing Blow', value: 1 }, { name: 'Stunty', value: 1 }] }))
    expect(injury(events)).toMatchObject({ result: 'out' })
  })

  it('in the crowd too: a 7 is Out, not the reserves', () => {
    const state = scene({ [GECKO]: { col: 5, row: 1 } }, [7])
    state.config = rulesV32
    state.players[GECKO]!.skills = ['Stunty']
    const { state: after, events } = runRule(state, (ctx) => pushedIntoCrowd(ctx, GECKO, h(5, 1), none))
    expect(events).toContainEqual({ type: 'injuryRolled', playerId: GECKO, white: 7, modifiers: [{ name: 'Stunty', value: 1 }] })
    expect(after.players[GECKO]!.status).toBe('out')
  })
})
