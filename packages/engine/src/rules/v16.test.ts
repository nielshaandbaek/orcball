import { describe, expect, it } from 'vitest'
import { rulesV15, rulesV16 } from '../config'
import { createEngine } from '../engine'
import { distance, fromColRow, type Hex } from '../hex'
import type { Command, GameState, TeamId } from '../state'
import { forcedRng } from '../rng'
import { RULE_MODULES } from '.'
import { type Placement, run, scene } from './test-helpers'
import { countAssists } from './zones'

// Rules v16: v15 with the Dodge, Catch and Guard skills (#101, #99, #102; the
// Elf Catchers get Dodge and Catch, nobody gets Guard yet), no empty
// activations (#103), and Cancel before the player has done anything (#121).

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })

const BLITZER = 'home-blitzer-1' // ST 3, Block
const ORC = 'home-lineman-1'
const ORC2 = 'home-lineman-2'
const THROWER = 'home-thrower-1'
const CATCHER = 'away-catcher-1' // AG 4+, Dodge and Catch in v16
const ELF = 'away-lineman-1' // AG 4+
const ELF2 = 'away-lineman-2'
const ELF_THROWER = 'away-thrower-1'

/** A scene under v16 (or another config), each player with his skills there; no Momentum, so misses aren't re-rolled. */
function v16(placements: Record<string, Placement>, faces: number[] = [], { config = rulesV16, turn = 'home' as TeamId } = {}): GameState {
  const state = scene(placements, faces)
  state.config = config
  const rosters = { home: config.rosters.orcs!, away: config.rosters.elves! }
  for (const p of Object.values(state.players)) p.skills = [...(rosters[p.team].positions[p.position]?.skills ?? [])]
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  state.turnOwner = turn
  state.firstGo = turn
  return state
}

const activate = (playerId: string, action: 'move' | 'block' | 'blitz' | 'pass' | 'handOff' | 'foul' = 'move'): Command => ({ type: 'activate', playerId, action })
const option = (state: GameState, type: Command['type']) => engine.availableCommands(state).find((o) => o.command.type === type)

describe('rules v16 config', () => {
  it('is v15 with the two activation switches and Dodge and Catch for the Elf Catcher', () => {
    const { id: _a, rosters: r16, activations: a16, ...rest16 } = rulesV16
    const { id: _b, rosters: r15, activations: a15, ...rest15 } = rulesV15
    expect(rulesV16.id).toBe('rules-v16')
    expect(rest16).toEqual(rest15)
    expect(a16).toEqual({ ...a15, noEmptyActivation: true, cancelBeforeActing: true })
    expect(r16.orcs).toEqual(r15.orcs)
    const elves = r15.elves!
    expect(r16.elves).toEqual({ ...elves, positions: { ...elves.positions, catcher: { ...elves.positions.catcher!, skills: ['Dodge', 'Catch'] } } })
  })

  it('gives nobody Guard yet', () => {
    const skills = Object.values(rulesV16.rosters).flatMap((r) => Object.values(r.positions).flatMap((p) => p.skills))
    expect(skills).not.toContain('Guard')
  })
})

describe('Dodge (#101)', () => {
  // The Catcher at (10,5) is marked by the Orc at (9,5); (11,5) is clear.
  const marked = (config = rulesV16) =>
    run(engine, v16({ [CATCHER]: { col: 10, row: 5 }, [ORC]: { col: 9, row: 5 } }, [], { config, turn: 'away' }), activate(CATCHER)).state
  const dodge: Command = { type: 'move', to: h(11, 5), dodge: true }

  it('is +1 more on a Dodge, on top of the Dodge bonus: AG 4+ needs a 2', () => {
    expect(engine.previewRoll(marked(), dodge)).toMatchObject({
      target: 4,
      modifiers: [
        { name: 'Dodge bonus', value: 1 },
        { name: 'Dodge', value: 1 },
      ],
      chance: 0.9,
    })
  })

  it('shows on the roll in the log', () => {
    const state = marked()
    state.rng = forcedRng([2])
    const after = run(engine, state, dodge)
    expect(after.events.find((e) => e.type === 'rolled')).toMatchObject({ test: 'Dodge', modifiers: [{ name: 'Dodge bonus' }, { name: 'Dodge', value: 1 }] })
  })

  it('isn’t there for a v15 Catcher', () => {
    expect(engine.previewRoll(marked(rulesV15), dodge)).toMatchObject({ modifiers: [{ name: 'Dodge bonus', value: 1 }] })
  })
})

describe('Catch (#99)', () => {
  /** The Elf Thrower at (10,5) with the ball, activated to hand off to the Catcher at (9,5). */
  const handing = (extra: Record<string, Placement> = {}, faces: number[] = []) => {
    const state = v16({ [ELF_THROWER]: { col: 10, row: 5 }, [CATCHER]: { col: 9, row: 5 }, ...extra }, faces, { turn: 'away' })
    state.ball = { hex: h(10, 5), carrier: ELF_THROWER }
    return run(engine, state, activate(ELF_THROWER, 'handOff')).state
  }
  const handOff: Command = { type: 'handOff', targetId: CATCHER }

  it('is +1 on a marked catch', () => {
    // The Orc at (8,5) marks the Catcher: +1 −1.
    expect(engine.previewRoll(handing({ [ORC]: { col: 8, row: 5 } }), handOff)).toMatchObject({
      modifiers: [
        { name: 'Catch', value: 1 },
        { name: '1 tackle zone', value: -1 },
      ],
      chance: 0.7,
    })
    // A 4 catches: AG 4+ with +1 −1.
    const after = run(engine, handing({ [ORC]: { col: 8, row: 5 } }, [4]), handOff)
    expect(after.events.find((e) => e.type === 'rolled')).toMatchObject({ test: 'Catch', natural: 4, success: true })
    expect(after.state.ball.carrier).toBe(CATCHER)
  })

  it('leaves an unmarked hand-off automatic: no roll at all', () => {
    expect(engine.previewRoll(handing(), handOff)).toBeNull()
    const after = run(engine, handing(), handOff)
    expect(after.events.some((e) => e.type === 'rolled')).toBe(false)
    expect(after.state.ball.carrier).toBe(CATCHER)
  })

  it('is +1 on an interception too', () => {
    // The Orc Thrower at (3,5) passes to the Blitzer at (8,5) over the Catcher at (5,5): AG 4+ at −3 +1 intercepts on a 6.
    const state = v16({ [THROWER]: { col: 3, row: 5 }, [BLITZER]: { col: 8, row: 5 }, [CATCHER]: { col: 5, row: 5 } }, [6])
    state.ball = { hex: h(3, 5), carrier: THROWER }
    const after = run(engine, state, activate(THROWER, 'pass'), { type: 'pass', target: h(8, 5) })
    expect(after.events.find((e) => e.type === 'rolled')).toMatchObject({
      test: 'Interception',
      modifiers: [
        { name: 'Interception', value: -3 },
        { name: 'Catch', value: 1 },
      ],
      natural: 6,
      success: true,
    })
    expect(after.events).toContainEqual({ type: 'intercepted', playerId: CATCHER })
  })
})

describe('Guard (#102)', () => {
  // The Blitzer at (5,5) blocks the Elf at (6,5). The Orc at (6,4) is next to
  // the Elf, and also marked by a second Elf at (6,3).
  function guarded(guard: boolean) {
    const state = v16({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, [ORC]: { col: 6, row: 4 }, [ELF2]: { col: 6, row: 3 } })
    if (guard) state.players[ORC]!.skills = ['Guard']
    return state
  }

  it('sets up an Orc marked by another Elf', () => {
    const state = guarded(false)
    expect(distance(state.players[ORC]!.hex!, state.players[ELF]!.hex!)).toBe(1)
    expect(distance(state.players[ORC]!.hex!, state.players[ELF2]!.hex!)).toBe(1)
    expect(distance(state.players[BLITZER]!.hex!, state.players[ELF2]!.hex!)).toBeGreaterThan(1)
  })

  it('assists on a block while in another enemy tackle zone; without Guard he doesn’t', () => {
    const declared = (guard: boolean) => run(engine, guarded(guard), activate(BLITZER, 'block'), { type: 'block', targetId: ELF }).events.find((e) => e.type === 'blockDeclared')
    expect(declared(true)).toMatchObject({ attack: 4, defence: 3 })
    expect(declared(false)).toMatchObject({ attack: 3, defence: 3 })
  })

  it('assists the defender too', () => {
    // The Elf blocks the Orc Lineman; the Blitzer, marked by the second Elf, guards the Orc.
    const state = v16({ [ELF]: { col: 6, row: 5 }, [ORC]: { col: 5, row: 5 }, [BLITZER]: { col: 5, row: 4 }, [ELF2]: { col: 5, row: 3 } }, [], { turn: 'away' })
    expect(distance(h(5, 4), h(5, 3))).toBe(1)
    expect(distance(h(5, 4), h(6, 5))).toBe(1)
    state.players[BLITZER]!.skills = ['Guard']
    const declared = run(engine, state, activate(ELF, 'block'), { type: 'block', targetId: ORC }).events.find((e) => e.type === 'blockDeclared')
    expect(declared).toMatchObject({ attack: 3, defence: 4 })
  })

  it('counts only on blocks: not for fouls or the Strength Disengage check', () => {
    const state = guarded(true)
    const blitzer = state.players[BLITZER]!
    const elf = state.players[ELF]!
    expect(countAssists(state, blitzer, elf, { block: true })).toBe(1)
    expect(countAssists(state, blitzer, elf)).toBe(0)
  })

  it('gives no assist while Winded', () => {
    const state = guarded(true)
    state.players[ORC]!.winded = true
    expect(countAssists(state, state.players[BLITZER]!, state.players[ELF]!, { block: true })).toBe(0)
  })
})

describe('no empty activations (#103) and Cancel (#121)', () => {
  const two = (config = rulesV16) => v16({ [BLITZER]: { col: 5, row: 5 }, [ORC]: { col: 5, row: 7 }, [ELF]: { col: 14, row: 5 } }, [], { config })

  it('doesn’t offer End activation before the player has done something, but offers Cancel', () => {
    const state = run(engine, two(), activate(BLITZER)).state
    expect(option(state, 'endActivation')).toMatchObject({ available: false, reason: 'The player hasn’t done anything yet: act, or Cancel' })
    expect(option(state, 'cancelActivation')).toMatchObject({ available: true })
    expect(() => engine.apply(state, { type: 'endActivation' })).toThrow(/hasn’t done anything/)
  })

  it('offers End activation once he has stepped, and Cancel no more', () => {
    const state = run(engine, two(), activate(BLITZER), { type: 'move', to: h(6, 5) }).state
    expect(option(state, 'endActivation')).toMatchObject({ available: true })
    expect(option(state, 'cancelActivation')).toBeUndefined()
  })

  it('counts standing up as doing something', () => {
    const state = two()
    state.players[BLITZER]!.status = 'prone'
    const after = run(engine, state, activate(BLITZER), { type: 'standUp' }).state
    expect(option(after, 'endActivation')).toMatchObject({ available: true })
    expect(option(after, 'cancelActivation')).toBeUndefined()
  })

  it('Cancel takes the activation back: he can activate again, with another action, and the go stays', () => {
    const after = run(engine, two(), activate(BLITZER, 'blitz'), { type: 'cancelActivation' })
    expect(after.events.slice(-2)).toEqual([
      { type: 'activationCancelled', playerId: BLITZER },
      { type: 'phaseChanged', from: 'Activation', to: 'Round' },
    ])
    const { state } = after
    expect(state.activation).toBeNull()
    expect(state.phase).toBe('Round')
    expect(state.turnOwner).toBe('home')
    expect(state.players[BLITZER]!.activatedThisRound).toBe(false)
    // The Blitz is free again.
    expect(state.teams.home.usedThisRound.blitz).toBe(0)
    expect(engine.legalCommands(state)).toContainEqual(activate(ORC, 'blitz'))
    expect(engine.legalCommands(state)).toContainEqual(activate(BLITZER, 'move'))
  })

  it('Cancel leaves a Winded player Winded', () => {
    const state = two()
    state.players[BLITZER]!.winded = true
    const activated = run(engine, state, activate(BLITZER)).state
    expect(activated.players[BLITZER]!.winded).toBe(false)
    expect(run(engine, activated, { type: 'cancelActivation' }).state.players[BLITZER]!.winded).toBe(true)
  })

  it('Cancel leaves a double activation as it was, first or second', () => {
    const state = two()
    state.doubleActivation = { team: 'home', left: 2 }
    expect(run(engine, state, activate(BLITZER), { type: 'cancelActivation' }).state.doubleActivation).toEqual({ team: 'home', left: 2 })
    const second = run(engine, state, activate(BLITZER), { type: 'move', to: h(6, 5) }, { type: 'endActivation' }, activate(ORC)).state
    expect(second.turnOwner).toBe('home')
    const after = run(engine, second, { type: 'cancelActivation' }).state
    expect(after.doubleActivation).toEqual({ team: 'home', left: 1 })
    expect(after.turnOwner).toBe('home')
  })

  /** The Orcs, on a double, activate once and then Wait; then the Elves Wait. */
  const waitAfterFirst = (config = rulesV16) => {
    const state = two(config)
    state.doubleActivation = { team: 'home', left: 2 }
    return run(engine, state, activate(BLITZER), { type: 'move', to: h(6, 5) }, { type: 'endActivation' }, { type: 'wait' }, { type: 'wait' })
  }

  it('a Wait in place of the second activation of a double counts as a Wait', () => {
    // So the Elves' Wait straight after it is the second in a row, and ends the round.
    const after = waitAfterFirst()
    expect(after.events).toContainEqual({ type: 'waited', team: 'home', forced: false })
    expect(after.events).toContainEqual({ type: 'roundEnded', half: 1, round: 1 })
  })

  it('leaves v15 as it was: End activation with nothing done, no Cancel, and the Wait after a first activation isn’t one', () => {
    const activated = run(engine, two(rulesV15), activate(BLITZER)).state
    expect(option(activated, 'endActivation')).toMatchObject({ available: true })
    expect(option(activated, 'cancelActivation')).toBeUndefined()
    expect(waitAfterFirst(rulesV15).events.some((e) => e.type === 'roundEnded')).toBe(false)
  })
})
