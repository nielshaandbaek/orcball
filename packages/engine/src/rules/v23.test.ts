import { describe, expect, it } from 'vitest'
import { type RuleConfig, rulesV22, rulesV23 } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex } from '../hex'
import { createMatch } from '../match'
import type { Command, GameState } from '../state'
import { RULE_MODULES } from '.'
import { run, scene } from './test-helpers'

// Rules v23: v22 as two fixed drives of up to 6 rounds, one on offence for
// each team (#194). The home team receives first, with no coin toss; any
// touchdown ends the half; 2 Momentum per drive; Out players back only for
// the next drive.

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })
const { orcs, elves } = rulesV23.rosters as Record<'orcs' | 'elves', (typeof rulesV23.rosters)[string]>

// Home (Orcs) scores in the right end zone, away (Elves) in the left one.
const BLITZER = 'home-blitzer-1'
const ELF = 'away-lineman-1'

const activate = (playerId: string): Command => ({ type: 'activate', playerId, action: 'move' })
const step = (col: number, row: number): Command => ({ type: 'move', to: h(col, row) })

/** The Orc Blitzer carrying the ball two hexes from the end zone in round 2 of a half. */
function nearlyThere(config: RuleConfig, half: number): GameState {
  const state = scene({ [BLITZER]: { col: 16, row: 5 }, [ELF]: { col: 12, row: 9 } })
  state.config = config
  state.half = half
  state.round = 2
  state.ball = { hex: h(16, 5), carrier: BLITZER }
  state.teams.home.momentum = 0
  state.teams.away.momentum = 1
  return state
}

const score = (state: GameState) => run(engine, state, activate(BLITZER), step(17, 5), step(18, 5))

describe('rules v23 config', () => {
  it('is v22 as two drives of 6 rounds, 2 Momentum a drive, Out for the drive, Block only when attacking', () => {
    const { id: _a, match: m23, momentum: mo23, injury: i23, blocking: b23, ...rest23 } = rulesV23
    const { id: _b, match: m22, momentum: mo22, injury: i22, blocking: b22, ...rest22 } = rulesV22
    expect(rulesV23.id).toBe('rules-v23')
    expect(rest23).toEqual(rest22)
    expect(m23).toEqual({ ...m22, halves: 2, roundsPerHalf: 6, touchdownEndsHalf: true, homeReceivesFirst: true })
    expect(mo23).toEqual({ ...mo22, perHalf: 2 })
    expect(b23).toEqual({ ...b22, blockSkillAttackOnly: true })
    const { outReturnsAfterRounds: _c, ...i22Rest } = i22
    expect(i23).toEqual(i22Rest)
  })
})

describe('the home team receives first (#194)', () => {
  it('needs no coin toss: the away team sets up to kick off', () => {
    for (const seed of [1, 2, 3]) {
      const state = createMatch(rulesV23, [orcs, elves], seed)
      expect(state).toMatchObject({ phase: 'Setup', pending: null, kickingTeam: 'away', openingKicker: 'away', turnOwner: 'away', firstGo: 'home' })
      expect(state.teams.home.momentum).toBe(2)
    }
  })

  it('still tosses in v22', () => {
    expect(createMatch(rulesV22, [orcs, elves], 1).pending?.kind).toBe('setup.coinToss')
  })
})

describe('a touchdown ends the drive and the half (#194)', () => {
  it('goes to half time in round 2, and the away team receives the second drive', () => {
    const after = score(nearlyThere(rulesV23, 1))
    expect(after.state.teams.home.score).toBe(1)
    expect(after.events.map((e) => e.type)).toContain('halfEnded')
    expect(after.state).toMatchObject({ phase: 'Setup', half: 2, round: 0, kickingTeam: 'home', turnOwner: 'home' })
    // A fresh 2 Momentum each, unused ones lost.
    expect(after.state.teams.home.momentum).toBe(2)
    expect(after.state.teams.away.momentum).toBe(2)
  })

  it('ends the match in the second drive', () => {
    const after = score(nearlyThere(rulesV23, 2))
    expect(after.state).toMatchObject({ phase: 'FullTime', winner: 'home' })
  })

  it('in v22 only ends the drive: the half goes on with a kick-off', () => {
    const after = score(nearlyThere(rulesV22, 1))
    expect(after.events.map((e) => e.type)).not.toContain('halfEnded')
    expect(after.state).toMatchObject({ phase: 'Setup', half: 1, round: 2, kickingTeam: 'home' })
  })
})

describe('the Block skill only when attacking (#191)', () => {
  // An Elf Lineman (ST 3) blocks the Orc Blitzer (ST 3, Block), no assists.
  const tackle = (config: RuleConfig) => {
    const state = scene({ [ELF]: { col: 8, row: 5 }, [BLITZER]: { col: 9, row: 5 } })
    state.config = config
    state.players[BLITZER]!.skills = ['Block']
    Object.assign(state, { turnOwner: 'away', firstGo: 'away' })
    const blocked = run(engine, state, { type: 'activate', playerId: ELF, action: 'block' }, { type: 'block', targetId: BLITZER }).state
    return engine.previewRoll(blocked, { type: 'decide', choice: 'tackle' })
  }

  it("doesn't help the Blitzer when he is the one blocked in v23", () => {
    expect(tackle(rulesV23)?.modifiers.map((m) => m.name)).not.toContain("Defender's Block")
  })

  it('still did in v22', () => {
    expect(tackle(rulesV22)?.modifiers.map((m) => m.name)).toContain("Defender's Block")
  })
})
