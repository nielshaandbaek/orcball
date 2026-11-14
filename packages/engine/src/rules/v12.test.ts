import { describe, expect, it } from 'vitest'
import { loadRuleConfig, rulesV11, rulesV12 } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex } from '../hex'
import type { Command, GameState } from '../state'
import { RULE_MODULES } from '.'
import { previewBlock } from './blocking'
import { type Placement, run, scene } from './test-helpers'

// Rules v12: v11 plus the Block and Brace skills and the defending coach's
// choice on a missed Tackle. In the v12 rosters Orc Blitzers and Elf
// Wardancers have Block; Orc and Elf Linemen have Brace.
//
//   row 4      (5,4) (6,4) (7,4)
//   row 5   (5,5) (6,5) (7,5) (8,5)
//   row 6      (5,6) (6,6) (7,6)

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })

const BLITZER = 'home-blitzer-1' // ST 3, Block
const ORC = 'home-lineman-1' // ST 3, Brace
const ORC2 = 'home-lineman-2'
const ELF = 'away-lineman-1' // ST 3, Brace
const WARDANCER = 'away-wardancer-1' // ST 3, Block

/** A v12 scene: the players get their v12 skills, Momentum is off so misses aren't re-rolled. */
function v12(placements: Record<string, Placement>, faces: number[] = []): GameState {
  const state = scene(placements, faces)
  state.config = rulesV12
  const rosters = { home: rulesV12.rosters.orcs!, away: rulesV12.rosters.elves! }
  for (const p of Object.values(state.players)) p.skills = [...rosters[p.team].positions[p.position]!.skills]
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  return state
}

const decide = (choice: string): Command => ({ type: 'decide', choice })
const blocks = (attacker: string, defender: string): Command[] => [
  { type: 'activate', playerId: attacker, action: 'block' },
  { type: 'block', targetId: defender },
]

describe('rules v12 config', () => {
  it('gives Block to Orc Blitzers and Elf Wardancers, Brace to both teams’ Linemen', () => {
    expect(rulesV12.rosters.orcs!.positions.blitzer!.skills).toEqual(['Block'])
    expect(rulesV12.rosters.orcs!.positions.lineman!.skills).toEqual(['Brace'])
    expect(rulesV12.rosters.elves!.positions.wardancer!.skills).toEqual(['Block'])
    expect(rulesV12.rosters.elves!.positions.lineman!.skills).toEqual(['Brace'])
    expect(rulesV12.blocking).toMatchObject({ missedTackleIsFailure: false, missedTackleChoice: true })
  })

  it('rejects a skill the engine doesn’t know', () => {
    const raw = JSON.parse(JSON.stringify(rulesV12)) as { rosters: { orcs: { positions: { blitzer: { skills: string[] } } } } }
    raw.rosters.orcs.positions.blitzer.skills = ['Blok']
    expect(() => loadRuleConfig(raw)).toThrow(/rosters\.orcs\.positions\.blitzer\.skills/)
  })
})

describe('Brace (v12)', () => {
  // The Orc Blitzer (Block) blocks the Elf Lineman (Brace), ST 3 each, no assists.
  const declared = () => run(engine, v12({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } }), ...blocks(BLITZER, ELF))

  it('lets an unactivated defender Brace before the attacker chooses', () => {
    const { state } = declared()
    expect(state.pending).toMatchObject({ kind: 'blocking.brace', team: 'away' })
    expect(state.pending!.choices.map((c) => c.id)).toEqual(['brace', 'no'])
  })

  it('Bracing adds 1 to his total and uses up his activation', () => {
    const after = run(engine, declared().state, decide('brace'))
    expect(after.events).toContainEqual({ type: 'braced', playerId: ELF })
    expect(after.state.players[ELF]!.activatedThisRound).toBe(true)
    // 3 against 4: no Shove. The Tackle is −1 for strength, +1 for the Blitzer's Block: 50%.
    expect(after.state.pending).toMatchObject({
      kind: 'blocking.shoveOrTackle',
      prompt: 'Your total 3 against 4: too weak to Shove. Tackle?',
    })
    expect(after.state.pending!.choices).toEqual([{ id: 'tackle', label: 'Tackle (50%)' }])
  })

  it('not Bracing leaves the totals, and his activation, as they were', () => {
    const after = run(engine, declared().state, decide('no'))
    expect(after.state.players[ELF]!.activatedThisRound).toBe(false)
    expect(after.state.pending?.prompt).toBe('Your total 3 against 3. Shove or Tackle?')
    expect(after.state.pending!.choices.map((c) => c.label)).toEqual(['Shove (push, no roll)', 'Tackle (60%)'])
  })

  it('is in the odds before the block is declared, beside the odds without it (#180)', () => {
    const state = run(engine, v12({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } }), { type: 'activate', playerId: BLITZER, action: 'block' }).state
    expect(previewBlock(state, ELF)).toMatchObject({
      attack: 3,
      defence: 3,
      canShove: true,
      tackle: { test: 'Tackle', chance: 0.6 },
      braced: { attack: 3, defence: 4, canShove: false, tackle: { chance: 0.5 } },
    })
    // Declaring is still free of rolls, so the computer's search sees no preview for it.
    expect(engine.previewRolls(state, { type: 'block', targetId: ELF })).toEqual([])
  })

  it('leaves the odds alone for a defender who has already activated', () => {
    const fresh = v12({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } })
    fresh.players[ELF]!.activatedThisRound = true
    const state = run(engine, fresh, { type: 'activate', playerId: BLITZER, action: 'block' }).state
    expect(previewBlock(state, ELF)!.braced).toBeNull()
    expect(previewBlock(state, 'away-catcher-1')).toBeNull()
  })

  it("isn't offered to a defender who has already activated this round", () => {
    const state = v12({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } })
    state.players[ELF]!.activatedThisRound = true
    expect(run(engine, state, ...blocks(BLITZER, ELF)).state.pending?.kind).toBe('blocking.shoveOrTackle')
  })
})

describe('Block (v12)', () => {
  it('is +1 on the Tackle only when its side has no assists', () => {
    // An Orc Lineman at (6,4) assists the Blitzer: 4 against 3, so Block adds nothing. 60%.
    const state = v12({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, [ORC2]: { col: 6, row: 4 } })
    const asked = run(engine, state, ...blocks(BLITZER, ELF), decide('no')).state
    expect(engine.previewRoll(asked, decide('tackle'))).toMatchObject({
      modifiers: [{ name: 'Strength difference', value: 1 }],
      chance: 0.6,
    })
  })

  it("counts against the attacker when the defender has it: −1", () => {
    // An Orc Lineman (no Block) blocks the Wardancer (Block), ST 3 each: 50% − 10%.
    const state = v12({ [ORC]: { col: 5, row: 5 }, [WARDANCER]: { col: 6, row: 5 } })
    const asked = run(engine, state, ...blocks(ORC, WARDANCER)).state
    expect(engine.previewRoll(asked, decide('tackle'))).toMatchObject({
      modifiers: [{ name: "Defender's Block", value: -1 }],
      chance: 0.4,
    })
  })

  it("doesn't help a Shove: against a Braced defender the Blitzer still can't Shove", () => {
    const after = run(engine, v12({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } }), ...blocks(BLITZER, ELF), decide('brace'))
    expect(after.state.pending!.choices.map((c) => c.id)).toEqual(['tackle'])
  })

  it("doesn't save the attacker on a natural 1", () => {
    // Tackle rolls 1; armour red 2, white 1 holds.
    const state = v12({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } }, [1, 2, 1])
    const after = run(engine, state, ...blocks(BLITZER, ELF), decide('no'), decide('tackle'))
    expect(after.state.players[BLITZER]!.status).toBe('prone')
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: BLITZER, failed: true })
  })
})

describe('Dodge (v12)', () => {
  // The Blitzer (AG 6+) starts next to the Elf at (7,5).
  const marked = () => run(engine, v12({ [BLITZER]: { col: 6, row: 5 }, [ELF]: { col: 7, row: 5 } }), { type: 'activate', playerId: BLITZER, action: 'move' }).state
  const dodge = (col: number, row: number): Command => ({ type: 'move', to: h(col, row), dodge: true })

  it('is +1 by default: AG 6+ dodges into a free hex on 5+, 60%', () => {
    expect(engine.previewRoll(marked(), dodge(5, 5))).toMatchObject({
      target: 6,
      modifiers: [{ name: 'Dodge bonus', value: 1 }],
      chance: 0.6,
    })
  })

  it('still counts −1 per tackle zone on the hex dodged into', () => {
    // (6,4) is next to the Elf too: +1 −1, 50%.
    expect(engine.previewRoll(marked(), dodge(6, 4))).toMatchObject({
      modifiers: [
        { name: 'Dodge bonus', value: 1 },
        { name: '1 tackle zone', value: -1 },
      ],
      chance: 0.5,
    })
  })
})

describe('a missed Tackle (v12)', () => {
  // Tackle rolls 3: a miss. Then the Elves choose.
  const missed = (faces: number[]) => {
    const state = v12({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } }, [3, ...faces])
    return run(engine, state, ...blocks(BLITZER, ELF), decide('no'), decide('tackle'))
  }

  it('asks the defending coach: both down, or nothing happens', () => {
    expect(missed([]).state.pending).toMatchObject({ kind: 'blocking.missChoice', team: 'away' })
  })

  it('nothing happens: the Block is over, and it isn’t a failure', () => {
    const after = run(engine, missed([]).state, decide('nothing'))
    expect(after.events).toContainEqual({ type: 'tackleMissChosen', team: 'away', choice: 'nothing' })
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: BLITZER, failed: false })
    expect(after.state.players[ELF]!.status).toBe('standing')
    expect(after.state.doubleActivation).toBeNull()
  })

  it('both down: both fall where they stand, and the attacker has failed', () => {
    // Armour: Blitzer red 2 white 1, Elf red 2 white 1; both hold.
    const after = run(engine, missed([2, 1, 2, 1]).state, decide('bothDown'))
    expect(after.state.players[BLITZER]).toMatchObject({ hex: h(5, 5), status: 'prone' })
    expect(after.state.players[ELF]).toMatchObject({ hex: h(6, 5), status: 'prone' })
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: BLITZER, failed: true })
    expect(after.state.doubleActivation).toEqual({ team: 'away', left: 2 })
  })

  it('both down with the defender carrying the ball: he falls last and the ball bounces', () => {
    // Armour holds for both; the ball bounces E from (6,5) to (7,5) and settles.
    const state = v12({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } }, [3, 2, 1, 2, 1, 1])
    state.ball = { hex: h(6, 5), carrier: ELF }
    const asked = run(engine, state, ...blocks(BLITZER, ELF), decide('no'), decide('tackle')).state
    const after = run(engine, asked, decide('bothDown'))
    expect(after.state.ball).toEqual({ hex: h(7, 5), carrier: null })
    expect(after.state.pending).toBeNull()
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: BLITZER, failed: true })
  })
})

describe('only a standing player can Block (v12)', () => {
  const activations = (state: GameState, playerId: string) =>
    engine.availableCommands(state).filter((o) => o.command.type === 'activate' && o.command.playerId === playerId)
  const option = (state: GameState, playerId: string, action: string) =>
    activations(state, playerId).find((o) => o.command.type === 'activate' && o.command.action === action)

  it('greys out Block for a prone player, with the reason', () => {
    const state = v12({ [BLITZER]: { col: 5, row: 5, status: 'prone' }, [ELF]: { col: 6, row: 5 } })
    expect(option(state, BLITZER, 'block')).toEqual({
      command: { type: 'activate', playerId: BLITZER, action: 'block' },
      available: false,
      reason: 'Only a standing player can Block; a player who is down can Blitz instead',
    })
    expect(() => engine.apply(state, { type: 'activate', playerId: BLITZER, action: 'block' })).toThrow()
  })

  it('still lets a prone player Blitz: he stands up, then blocks', () => {
    const state = v12({ [BLITZER]: { col: 5, row: 5, status: 'prone' }, [ELF]: { col: 6, row: 5 } })
    expect(option(state, BLITZER, 'blitz')?.available).toBe(true)
    const up = run(engine, state, { type: 'activate', playerId: BLITZER, action: 'blitz' }, { type: 'standUp' }).state
    expect(engine.legalCommands(up)).toContainEqual({ type: 'block', targetId: ELF })
  })

  it('lets a standing player Block as before', () => {
    const state = v12({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } })
    expect(option(state, BLITZER, 'block')?.available).toBe(true)
  })

  it('leaves v11 as it was: a prone player may still declare a Block', () => {
    const state = v12({ [BLITZER]: { col: 5, row: 5, status: 'prone' }, [ELF]: { col: 6, row: 5 } })
    state.config = rulesV11
    expect(option(state, BLITZER, 'block')?.available).toBe(true)
  })
})
