import { describe, expect, it } from 'vitest'
import { rulesV25, rulesV26 } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex } from '../hex'
import { createMatch } from '../match'
import type { Command, GameEvent, GameState } from '../state'
import { RULE_MODULES } from '.'
import { knockDown, pushedIntoCrowd } from './injury'
import { maxMovement, reachableHexes } from './movement'
import { run, runRule, scene } from './test-helpers'

// Rules v26: v25 with the Dwarves (#211) and their skills, Thick Skull (#212,
// a team trait), Tackle (#214) and Frenzy (#213); a team must field 7 players
// at setup, or every player it has available (#200).

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
  it('is v25 with setup.fieldAllAvailable and a fourth team, the Dwarves', () => {
    const { id: _a, setup: s26, rosters: r26, ...rest26 } = rulesV26
    const { id: _b, setup: s25, rosters: r25, ...rest25 } = rulesV25
    expect(rulesV26.id).toBe('rules-v26')
    expect(rest26).toEqual(rest25)
    expect(s26).toEqual({ ...s25, fieldAllAvailable: true })
    const { dwarves, ...others } = r26
    expect(others).toEqual(r25)
    // #211: one skill per position, and Thick Skull for the whole team.
    expect(dwarves!.traits).toEqual(['Thick Skull'])
    const stats = Object.fromEntries(Object.entries(dwarves!.positions).map(([id, p]) => [id, [p.name, p.max, p.ma, p.st, p.ag, p.to, ...p.skills]]))
    expect(stats).toEqual({
      blocker: ['Blocker', 2, 3, 3, 8, 9, 'Tackle'],
      guard: ['Guard', 2, 4, 3, 7, 9, 'Guard'],
      runner: ['Runner', 1, 5, 3, 6, 8, 'Sure Hands'],
      'troll-slayer': ['Troll Slayer', 2, 4, 3, 7, 8, 'Frenzy'],
    })
  })

  it('fields 7 Dwarves, every one with his position\'s skill and the team trait', () => {
    const state = createMatch(rulesV26, [rulesV26.rosters.dwarves!, elves!], 1)
    const dwarves = Object.values(state.players).filter((p) => p.team === 'home')
    expect(dwarves).toHaveLength(7)
    expect(state.players['home-troll-slayer-1']!.skills).toEqual(['Frenzy', 'Thick Skull'])
    expect(state.players['home-blocker-2']!.skills).toEqual(['Tackle', 'Thick Skull'])
    // Other teams have no traits.
    expect(createMatch(rulesV26, [orcs!, elves!], 1).players['home-lineman-1']!.skills).toEqual(['Brace'])
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

describe('Tackle (#214): no Strength Disengage, and −1 a Tackle player on a Dodge out of his zone', () => {
  // The Elf (ST 3) at (6,5) moves away from Orcs (ST 3) marking him; (5,5) is free of their zones.
  //   row 4      (5,4) (6,4) (7,4)
  //   row 5   (5,5) (6,5) (7,5)
  const ELF = 'away-lineman-1'
  const ORC = 'home-lineman-1'
  const ORC2 = 'home-lineman-2'

  function marked(tacklers: string[], extra: Record<string, { col: number; row: number }> = {}, faces: number[] = []) {
    const state = scene({ [ELF]: { col: 6, row: 5 }, [ORC]: { col: 7, row: 5 }, ...extra }, faces)
    state.config = rulesV26
    for (const p of Object.values(state.players)) p.skills = tacklers.includes(p.id) ? ['Tackle'] : []
    Object.assign(state, { turnOwner: 'away', firstGo: 'away' })
    state.teams.away.momentum = 0
    return run(engine, state, { type: 'activate', playerId: ELF, action: 'move' }).state
  }
  const dodgeAway: Command = { type: 'move', to: h(5, 5), dodge: true }
  const disengage: Command = { type: 'move', to: h(5, 5), disengage: true }
  const modifiers = (state: GameState) => engine.previewRoll(state, dodgeAway)!.modifiers
  const offered = (state: GameState, command: Command) => engine.availableCommands(state).some((o) => JSON.stringify(o.command) === JSON.stringify(command))

  it('−1 on the Dodge for one Tackle player marking him; none without the skill', () => {
    expect(modifiers(marked([ORC]))).toContainEqual({ name: 'Tackle', value: -1 })
    expect(modifiers(marked([])).map((m) => m.name)).not.toContain('Tackle')
  })

  it('−2 for two Tackle players marking the hex he leaves', () => {
    expect(modifiers(marked([ORC, ORC2], { [ORC2]: { col: 6, row: 4 } }))).toContainEqual({ name: 'Tackle', value: -2 })
  })

  it('in the roll itself, not only the preview', () => {
    const { events } = run(engine, marked([ORC], {}, [9]), dodgeAway)
    const roll = events.find((e) => e.type === 'rolled' && e.test === 'Dodge')
    expect(roll).toMatchObject({ modifiers: expect.arrayContaining([{ name: 'Tackle', value: -1 }]) })
  })

  it('adds up with the Dodge skill: +1 and −1 both shown', () => {
    const state = marked([ORC])
    state.players[ELF]!.skills = ['Dodge']
    expect(modifiers(state)).toEqual(expect.arrayContaining([{ name: 'Dodge', value: 1 }, { name: 'Tackle', value: -1 }]))
  })

  it('no Strength Disengage while a Tackle player marks him; allowed without one', () => {
    expect(offered(marked([]), disengage)).toBe(true)
    expect(offered(marked([ORC]), disengage)).toBe(false)
    expect(() => run(engine, marked([ORC]), disengage)).toThrow(/Illegal command/)
    // The reach (the board's shading, the computer's plans) has no Disengage either.
    const reach = reachableHexes(marked([ORC]), ELF).find((r) => r.hex.q === h(5, 5).q && r.hex.r === h(5, 5).r)
    expect(reach?.disengages ?? 0).toBe(0)
  })

  it('does nothing while the Tackle player is Winded or down: no zone', () => {
    for (const change of [{ winded: true }, { status: 'prone' as const }]) {
      const state = scene({ [ELF]: { col: 6, row: 5 }, [ORC]: { col: 7, row: 5 }, [ORC2]: { col: 6, row: 4 } }, [])
      state.config = rulesV26
      for (const p of Object.values(state.players)) p.skills = p.id === ORC ? ['Tackle'] : []
      Object.assign(state.players[ORC]!, change)
      Object.assign(state, { turnOwner: 'away', firstGo: 'away' })
      const active = run(engine, state, { type: 'activate', playerId: ELF, action: 'move' }).state
      expect(modifiers(active).map((m) => m.name)).not.toContain('Tackle')
    }
  })

  it('leaves a Leap alone: no Dodge, an unmodified roll', () => {
    const state = marked([ORC])
    state.players[ELF]!.skills = ['Leap']
    expect(engine.previewRoll(state, { type: 'leap', to: h(4, 5) })!.modifiers).toEqual([])
  })
})

describe('Frenzy (#213): a forced follow-up, and a second block if he stays up', () => {
  //   row 4      (5,4) (6,4) (7,4) (8,4)
  //   row 5   (5,5) (6,5) (7,5) (8,5) (9,5)
  //   row 6      (5,6) (6,6) (7,6) (8,6)
  const SLAYER = 'home-lineman-1' // ST 3, given Frenzy
  const ELF = 'away-lineman-1' // ST 3
  const ELF2 = 'away-lineman-2'
  const decide = (choice: string): Command => ({ type: 'decide', choice })
  const at = (col: number, row: number) => decide(hexKeyOf(col, row))
  const hexKeyOf = (col: number, row: number) => `${h(col, row).q},${h(col, row).r}`

  function frenzyScene(extra: Record<string, { col: number; row: number }> = {}, faces: number[] = []) {
    const state = scene({ [SLAYER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, ...extra }, faces)
    state.config = rulesV26
    for (const p of Object.values(state.players)) p.skills = p.id === SLAYER ? ['Frenzy'] : []
    state.teams.home.momentum = 0
    state.teams.away.momentum = 0
    return state
  }
  const block = (action: 'block' | 'blitz' = 'block'): Command[] => [
    { type: 'activate', playerId: SLAYER, action },
    { type: 'block', targetId: ELF },
  ]
  const types = (events: GameEvent[]) => events.map((e) => e.type)

  it('Shove then Shove: two hexes forward, and never asked to follow up', () => {
    const state = frenzyScene()
    const first = run(engine, state, ...block(), decide('shove'), at(7, 5))
    // He followed up by himself, and the second Shove is under way: where does it push?
    expect(first.state.players[SLAYER]!.hex).toEqual(h(6, 5))
    expect(first.state.pending?.kind).toBe('blocking.push')
    expect(types(first.events)).toContain('frenzy')
    const second = run(engine, first.state, at(8, 5))
    expect(second.state.players[ELF]!.hex).toEqual(h(8, 5))
    expect(second.state.players[SLAYER]!.hex).toEqual(h(7, 5))
    expect([...first.events, ...second.events].filter((e) => e.type === 'followedUp')).toHaveLength(2)
    expect([...first.events, ...second.events].filter((e) => e.type === 'blockChosen').map((e) => e.type === 'blockChosen' && e.choice)).toEqual(['shove', 'shove'])
    // Two blocks at most: the Block action is over.
    expect(second.state.activation).toBeNull()
    expect(second.state.players[SLAYER]!.activatedThisRound).toBe(true)
  })

  it('a missed Tackle the defender lets go ("nothing happens"), then a second Tackle', () => {
    // Tackle 6+: a 3 misses; the second, a 9, knocks him down (red 2 holds against TO 7).
    const state = frenzyScene({}, [3, 9, 2, 1])
    const missed = run(engine, state, ...block(), decide('tackle'))
    expect(missed.state.pending?.kind).toBe('blocking.missChoice')
    const after = run(engine, missed.state, decide('nothing'), at(7, 5))
    expect(types(after.events)).toEqual(expect.arrayContaining(['frenzy', 'blockChosen', 'pushed', 'followedUp', 'knockedDown']))
    expect(after.state.players[ELF]).toMatchObject({ hex: h(7, 5), status: 'prone' })
    expect(after.state.players[SLAYER]!.hex).toEqual(h(6, 5))
  })

  it('a successful Tackle puts him down: no second block', () => {
    const { state, events } = run(engine, frenzyScene({}, [9, 2, 1]), ...block(), decide('tackle'), at(7, 5))
    expect(types(events)).not.toContain('frenzy')
    expect(state.players[ELF]!.status).toBe('prone')
    expect(state.players[SLAYER]!.hex).toEqual(h(6, 5))
    expect(state.activation).toBeNull()
  })

  it('a Shove he is too weak for the second time is a Tackle: an Elf now assists the defender', () => {
    // After the follow-up to (6,5), the Elf at (6,4) marks him and assists: 3 against 4.
    const state = frenzyScene({ [ELF2]: { col: 6, row: 4 } }, [9, 2, 1])
    const { events } = run(engine, state, ...block(), decide('shove'), at(7, 5), at(8, 5))
    expect(events.filter((e) => e.type === 'blockChosen').map((e) => e.type === 'blockChosen' && e.choice)).toEqual(['shove', 'tackle'])
    expect(events.filter((e) => e.type === 'blockDeclared').map((e) => e.type === 'blockDeclared' && [e.attack, e.defence])).toEqual([
      [3, 3],
      [3, 4],
    ])
  })

  it('a natural 1 on the first Tackle: he falls, no second block', () => {
    const { events } = run(engine, frenzyScene({}, [1, 2, 1]), ...block(), decide('tackle'))
    expect(types(events)).not.toContain('frenzy')
    expect(events).toContainEqual({ type: 'knockedDown', playerId: SLAYER })
  })

  it('in a Blitz the second block costs 1 MA: with it he blocks again; without, the Blitz carries on', () => {
    const withMa = run(engine, frenzyScene(), ...block('blitz'), decide('shove'), at(7, 5))
    expect(types(withMa.events)).toContain('frenzy')
    expect(withMa.state.activation!.maUsed).toBe(2)

    // Every hex of MA (and Sprint) but the one the first block costs already spent.
    const state = frenzyScene()
    const active = run(engine, state, { type: 'activate', playerId: SLAYER, action: 'blitz' }).state
    active.activation!.maUsed = maxMovement(active, active.players[SLAYER]!) - 1
    const noMa = run(engine, active, { type: 'block', targetId: ELF }, decide('shove'), at(7, 5))
    expect(types(noMa.events)).not.toContain('frenzy')
    expect(noMa.state.activation?.playerId).toBe(SLAYER)
    expect(noMa.state.pending).toBeNull()
  })

  it('without Frenzy the follow-up is still asked, and there is one block', () => {
    const state = frenzyScene()
    state.players[SLAYER]!.skills = []
    const { state: after, events } = run(engine, state, ...block(), decide('shove'), at(7, 5))
    expect(after.pending?.kind).toBe('blocking.followUp')
    expect(types(events)).not.toContain('frenzy')
  })
})

describe('the Dwarf Guard (#211): assists a Troll Slayer\'s block even when marked', () => {
  //   row 4      (5,4) (6,4) (7,4)
  //   row 5   (5,5) (6,5) (7,5)
  const SLAYER = 'home-lineman-1' // as the Troll Slayer
  const GUARD = 'home-lineman-2' // as the Guard, next to the Elf and marked by another
  const ELF = 'away-lineman-1'
  const ELF2 = 'away-lineman-2'

  function declared(guard: boolean) {
    const state = scene({ [SLAYER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, [GUARD]: { col: 6, row: 4 }, [ELF2]: { col: 7, row: 4 } })
    state.config = rulesV26
    for (const p of Object.values(state.players)) p.skills = []
    state.players[GUARD]!.skills = guard ? ['Guard'] : []
    const { events } = run(engine, state, { type: 'activate', playerId: SLAYER, action: 'block' }, { type: 'block', targetId: ELF })
    return events.find((e) => e.type === 'blockDeclared')
  }

  it('3 + 1 against 3 with Guard; marked without it, no assist', () => {
    expect(declared(true)).toMatchObject({ attack: 4, defence: 3 })
    expect(declared(false)).toMatchObject({ attack: 3, defence: 3 })
  })
})
