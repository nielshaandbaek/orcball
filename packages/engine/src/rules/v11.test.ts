import { describe, expect, it } from 'vitest'
import { rulesV10, rulesV11, ruleConfigHash } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex, hexKey } from '../hex'
import type { Command, GameState } from '../state'
import { RULE_MODULES } from '.'
import { reachableHexes } from './movement'
import { exertsTackleZone } from './zones'
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

describe('Tackle (v11)', () => {
  const tackle = (faces: number[]) => {
    const state = v11({ [BLITZER]: { col: 6, row: 5 }, [ELF]: { col: 7, row: 5 } }, faces)
    return run(engine, state, activate(BLITZER, 'block'), { type: 'block', targetId: ELF }, { type: 'decide', choice: 'tackle' })
  }

  it('a miss is just "nothing happens": the activation ends, but not as a failure', () => {
    const after = tackle([3])
    expect(after.state.players[ELF]).toMatchObject({ hex: h(7, 5), status: 'standing' })
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: BLITZER, failed: false })
    expect(after.state.doubleActivation).toBeNull()
  })

  it('a Blitzer may keep moving after a miss, Dodging out of the tackle zone', () => {
    const state = v11({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 7, row: 5 } }, [3])
    const after = run(
      engine,
      state,
      { type: 'activate', playerId: BLITZER, action: 'blitz' },
      step(6, 5),
      { type: 'block', targetId: ELF },
      { type: 'decide', choice: 'tackle' },
    )
    expect(after.events.some((e) => e.type === 'activationEnded')).toBe(false)
    expect(after.state.activation).toMatchObject({ playerId: BLITZER, blocked: true, stopped: false, maUsed: 2 })
    expect(after.state.doubleActivation).toBeNull()
    expect(moves(after.state)).toContainEqual(dodge(5, 5))
    expect(engine.legalCommands(after.state).some((c) => c.type === 'block')).toBe(false)
  })

  it('a natural 1 knocks the attacker down, and that is a failure', () => {
    const after = tackle([1, 2, 1])
    expect(after.state.players[BLITZER]!.status).toBe('prone')
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: BLITZER, failed: true })
    expect(after.state.doubleActivation).toEqual({ team: 'away', left: 2 })
  })
})

describe('kick-off scatter (v11)', () => {
  it('goes the lower of 2D6 hexes', () => {
    // Kick at (3,5); direction E, distance dice 5 and 2 → 2 hexes, onto the Orc
    // Lineman at (5,5), whose coach chooses to catch: 6, caught.
    const state = v11({ [ORC]: { col: 5, row: 5 }, [ELF]: { col: 14, row: 5 } }, [1, 5, 2, 6])
    state.phase = 'KickOff'
    state.kickingTeam = 'away'
    state.turnOwner = 'away'
    const kicked = run(engine, state, { type: 'kick', hex: h(3, 5) })
    expect(kicked.events.filter((e) => e.type === 'ballMoved').map((e) => e.type === 'ballMoved' && e.to)).toEqual([h(4, 5), h(5, 5)])
    expect(kicked.state.pending).toMatchObject({ kind: 'ball.catchOrLeave', team: 'home' })
    const after = run(engine, kicked.state, { type: 'decide', choice: 'catch' }).state
    expect(after.ball.carrier).toBe(ORC)
  })
})

describe('blocking the ball carrier (v11)', () => {
  // The Blitzer at (5,5) Tackles the Elf carrying the ball at (6,5) and pushes
  // it to (7,5). Tackle 6; armour red 2, white 1 holds; then the ball bounces
  // from (7,5) in the direction of the next die (1 = E, onto the Orc at (8,5);
  // 2 = SE, onto the second Elf at (7,6)).
  const decide = (choice: string): Command => ({ type: 'decide', choice })
  const pushed = (faces: number[]) => {
    const state = v11(
      { [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, [ORC]: { col: 8, row: 5 }, [ELF2]: { col: 7, row: 6 } },
      faces,
    )
    state.ball = { hex: h(6, 5), carrier: ELF }
    return run(
      engine,
      state,
      { type: 'activate', playerId: BLITZER, action: 'blitz' },
      { type: 'block', targetId: ELF },
      decide('tackle'),
      decide(hexKey(h(7, 5))),
    )
  }

  it('asks about the follow-up before the knock-down and the ball', () => {
    const asked = pushed([6, 2, 1, 1])
    expect(asked.state.pending?.kind).toBe('blocking.followUp')
    expect(asked.events.some((e) => e.type === 'armourRolled' || e.type === 'ballMoved')).toBe(false)
    const after = run(engine, asked.state, decide('follow'))
    const order = after.events.map((e) => e.type).filter((t) => ['followedUp', 'armourRolled', 'ballMoved'].includes(t))
    expect(order).toEqual(['followedUp', 'armourRolled', 'ballMoved'])
    expect(after.state.players[BLITZER]!.hex).toEqual(h(6, 5))
  })

  it('lets the coach whose player the ball lands on choose to catch or let it bounce', () => {
    const after = run(engine, pushed([6, 2, 1, 1]).state, decide('follow')).state
    expect(after.pending).toMatchObject({ kind: 'ball.catchOrLeave', team: 'home' })
    expect(after.pending?.choices.map((c) => c.label)).toEqual(['Catch (40%)', 'Let it bounce'])
    expect(engine.previewRoll(after, decide('catch'))).toMatchObject({ test: 'Catch', target: 6, chance: 0.4 })
  })

  it('lets it bounce on if declined, which is no failure: the Blitz carries on', () => {
    // Declined: bounces E again from (8,5) to (9,5) and settles.
    const after = run(engine, pushed([6, 2, 1, 1, 1]).state, decide('follow'), decide('leave'))
    expect(after.events).toContainEqual({ type: 'catchDeclined', playerId: ORC })
    expect(after.state.ball).toEqual({ hex: h(9, 5), carrier: null })
    expect(after.events.some((e) => e.type === 'activationEnded')).toBe(false)
    expect(after.state.activation).toMatchObject({ playerId: BLITZER, stopped: false })
  })

  it('counts a failed catch by the active team as a failure', () => {
    // Catch rolls 3: dropped, bounces E to (9,5).
    const after = run(engine, pushed([6, 2, 1, 1, 3, 1]).state, decide('follow'), decide('catch'))
    expect(after.state.ball).toEqual({ hex: h(9, 5), carrier: null })
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: BLITZER, failed: true })
    expect(after.state.doubleActivation).toEqual({ team: 'away', left: 2 })
  })

  it("doesn't count an opponent's dropped catch as anyone's failure", () => {
    // Bounces SE onto the second Elf, whose coach tries: 1, dropped; bounces E to (8,6).
    const asked = run(engine, pushed([6, 2, 1, 2, 1, 1]).state, decide('follow')).state
    expect(asked.pending).toMatchObject({ kind: 'ball.catchOrLeave', team: 'away' })
    const after = run(engine, asked, decide('catch'))
    expect(after.state.ball).toEqual({ hex: h(8, 6), carrier: null })
    expect(after.events.some((e) => e.type === 'activationEnded')).toBe(false)
    expect(after.state.doubleActivation).toBeNull()
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

describe('chain push into the crowd (v11)', () => {
  // The Blitzer at (16,5) Tackles the Elf at (17,5). All three push hexes are
  // taken, so the push chains into the second Elf on the touchline at (18,5),
  // who goes into the crowd. While the follow-up question is open, he waits on
  // the hex just off the pitch, (19,5), not on (18,5) with the first Elf (#77).
  // Dice: Tackle 6; then, after the follow-up, the crowd injury's white die 8
  // (Out), and armour red 2, white 1 holds for the Elf.
  const decide = (choice: string): Command => ({ type: 'decide', choice })
  const ORC2 = 'home-lineman-2'
  const chained = (faces: number[], ballWithElf2 = false) => {
    const state = v11(
      { [BLITZER]: { col: 16, row: 5 }, [ELF]: { col: 17, row: 5 }, [ELF2]: { col: 18, row: 5 }, [ORC]: { col: 17, row: 4 }, [ORC2]: { col: 17, row: 6 } },
      faces,
    )
    if (ballWithElf2) state.ball = { hex: h(18, 5), carrier: ELF2 }
    return run(
      engine,
      state,
      { type: 'activate', playerId: BLITZER, action: 'blitz' },
      { type: 'block', targetId: ELF },
      decide('tackle'),
      decide(hexKey(h(18, 5))),
    )
  }

  it('puts the crowd-pushed player off the pitch while the follow-up is asked', () => {
    const { state } = chained([6, 8, 2, 1])
    expect(state.pending?.kind).toBe('blocking.followUp')
    expect(state.players[ELF]!.hex).toEqual(h(18, 5))
    expect(state.players[ELF2]!.hex).toEqual(fromColRow({ col: 19, row: 5 }))
    const hexes = Object.values(state.players).flatMap((p) => (p.hex ? [hexKey(p.hex)] : []))
    expect(new Set(hexes).size).toBe(hexes.length)
  })

  it('gives the player in the crowd no tackle zone', () => {
    const { state } = chained([6, 8, 2, 1])
    expect(exertsTackleZone(state.players[ELF2]!)).toBe(false)
  })

  it('takes him off with the crowd injury once the follow-up is answered', () => {
    const asked = chained([6, 8, 2, 1]).state
    const after = run(engine, asked, decide('follow'))
    expect(after.events).toContainEqual({ type: 'injuryRolled', playerId: ELF2, white: 8 })
    expect(after.state.players[ELF2]).toMatchObject({ hex: null, status: 'out' })
    expect(after.state.players[ELF]).toMatchObject({ hex: h(18, 5), status: 'prone' })
    expect(after.state.players[BLITZER]!.hex).toEqual(h(17, 5))
  })

  it('takes the ball with a carrier into the crowd, and throws it in from the edge hex', () => {
    // Armour first (the ball goes last), then the crowd injury, then the throw-in from (18,5).
    const asked = chained([6, 2, 1, 8, 4, 1, 1, 1, 1, 1, 1], true).state
    expect(asked.ball).toEqual({ hex: fromColRow({ col: 19, row: 5 }), carrier: ELF2 })
    const after = run(engine, asked, decide('follow'))
    expect(after.state.players[ELF2]!.hex).toBeNull()
    expect(after.state.ball.carrier).not.toBe(ELF2)
    const moved = after.events.find((e) => e.type === 'ballMoved')
    expect(moved).toMatchObject({ from: h(18, 5) })
  })
})
