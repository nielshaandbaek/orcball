import { describe, expect, it } from 'vitest'
import { rulesV10 } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex, hexKey } from '../hex'
import { createMatch } from '../match'
import { forcedRng } from '../rng'
import type { Command, GameEvent, GameState } from '../state'
import { RULE_MODULES } from '.'
import { run, scene } from './test-helpers'

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })
const { orcs, elves } = rulesV10.rosters as Record<'orcs' | 'elves', (typeof rulesV10.rosters)[string]>

// Home (Orcs) scores in the right end zone (the last hex of each row), away
// (Elves) in the left one.
const BLITZER = 'home-blitzer-1'
const THROWER = 'home-thrower-1'
const ELF = 'away-lineman-1'
const CATCHER = 'away-catcher-1'

const activate = (playerId: string, action: 'move' | 'pass' | 'blitz' = 'move'): Command => ({ type: 'activate', playerId, action })
const step = (col: number, row: number): Command => ({ type: 'move', to: h(col, row) })
const place = (playerId: string, col: number, row: number): Command => ({ type: 'place', playerId, hex: h(col, row) })
const wait: Command = { type: 'wait' }
const endSetup: Command = { type: 'endSetup' }
const types = (events: GameEvent[]) => events.map((e) => e.type)

/** The Orc Blitzer carrying the ball at (16,5), two hexes from the end zone, an Elf far off. */
function nearlyThere(faces: number[] = []): GameState {
  const state = scene({ [BLITZER]: { col: 16, row: 5 }, [ELF]: { col: 12, row: 9 } }, faces)
  state.ball = { hex: h(16, 5), carrier: BLITZER }
  return state
}

describe('touchdowns', () => {
  it('are scored by carrying the ball into the opponent’s end zone', () => {
    const after = run(engine, nearlyThere(), activate(BLITZER), step(17, 5), step(18, 5))
    expect(after.events).toContainEqual({ type: 'touchdown', playerId: BLITZER, team: 'home' })
    expect(after.state.teams.home.score).toBe(1)
  })

  it('end the activation, the round and the drive', () => {
    const after = run(engine, nearlyThere(), activate(BLITZER), step(17, 5), step(18, 5))
    const tail = types(after.events).slice(types(after.events).indexOf('touchdown'))
    expect(tail).toEqual(['touchdown', 'activationEnded', 'roundEnded', 'driveEnded', 'phaseChanged'])
    expect(after.state).toMatchObject({
      phase: 'Setup',
      round: 1,
      half: 1,
      kickingTeam: 'home',
      turnOwner: 'home',
      activation: null,
      ball: { hex: null, carrier: null },
    })
    expect(Object.values(after.state.players).every((p) => p.hex === null)).toBe(true)
  })

  it("don't count in a team's own end zone", () => {
    const state = scene({ [BLITZER]: { col: 3, row: 5 }, [ELF]: { col: 12, row: 9 } })
    state.ball = { hex: h(3, 5), carrier: BLITZER }
    const after = run(engine, state, activate(BLITZER), step(2, 5), step(1, 5))
    expect(after.state.teams.home.score).toBe(0)
    expect(after.state.phase).toBe('Activation')
  })

  it('count when the ball is caught in the end zone', () => {
    // The Thrower at (14,5) passes 4 hexes (Short) to the Blitzer at (18,5): 8 − 1 is accurate.
    const state = scene({ [THROWER]: { col: 14, row: 5 }, [BLITZER]: { col: 18, row: 5 }, [ELF]: { col: 12, row: 9 } }, [8])
    state.ball = { hex: h(14, 5), carrier: THROWER }
    const after = run(engine, state, activate(THROWER, 'pass'), { type: 'pass', target: h(18, 5) })
    expect(after.events).toContainEqual({ type: 'touchdown', playerId: BLITZER, team: 'home' })
  })

  it("count on the other team's go, e.g. when a carrier is pushed in", () => {
    // On away's go, an Elf shoves the Orc carrier from (17,5) into (18,5).
    const state = scene({ [BLITZER]: { col: 17, row: 5 }, [ELF]: { col: 16, row: 5 }, [CATCHER]: { col: 17, row: 6 } })
    state.ball = { hex: h(17, 5), carrier: BLITZER }
    state.turnOwner = 'away'
    const asked = run(engine, state, { type: 'activate', playerId: ELF, action: 'block' }, { type: 'block', targetId: BLITZER }, { type: 'decide', choice: 'shove' }).state
    const pushed = run(engine, asked, { type: 'decide', choice: hexKey(h(18, 5)) })
    // The follow-up question comes first; the touchdown once it's answered.
    const after = run(engine, pushed.state, { type: 'decide', choice: 'stay' })
    expect(after.events).toContainEqual({ type: 'touchdown', playerId: BLITZER, team: 'home' })
    expect(after.state).toMatchObject({ phase: 'Setup', kickingTeam: 'home' })
  })

  it('need the carrier standing', () => {
    const state = nearlyThere()
    state.players[BLITZER]!.hex = h(18, 5)
    state.players[BLITZER]!.status = 'prone'
    state.ball = { hex: h(18, 5), carrier: BLITZER }
    expect(run(engine, state, wait).state.teams.home.score).toBe(0)
  })

  it('in the last round of a half end the half', () => {
    const state = nearlyThere()
    state.round = 4
    const after = run(engine, state, activate(BLITZER), step(17, 5), step(18, 5))
    expect(types(after.events)).toContain('halfEnded')
    expect(after.state).toMatchObject({ phase: 'Setup', half: 2, round: 0 })
  })
})

describe('a new drive', () => {
  it('brings Out players back, stands up the fallen, and keeps Casualties and ejections out', () => {
    const state = nearlyThere()
    const status = { 'home-black-orc-1': 'out', 'home-black-orc-2': 'casualty', 'away-catcher-2': 'ejected', 'away-wardancer-1': 'stunned' } as const
    for (const [id, s] of Object.entries(status)) state.players[id]!.status = s
    state.players['away-wardancer-1']!.hex = h(12, 3)
    const after = run(engine, state, activate(BLITZER), step(17, 5), step(18, 5)).state
    expect(after.players['home-black-orc-1']!.status).toBe('standing')
    expect(after.players['home-black-orc-2']!.status).toBe('casualty')
    expect(after.players['away-catcher-2']!.status).toBe('ejected')
    expect(after.players['away-wardancer-1']).toMatchObject({ status: 'standing', hex: null })
    // Out players can be set up again; Casualties can't.
    const setups = engine.legalCommands(after).filter((c) => c.type === 'place').map((c) => (c.type === 'place' ? c.playerId : ''))
    expect(setups).toContain('home-black-orc-1')
    expect(setups).not.toContain('home-black-orc-2')
  })
})

describe('half time and full time', () => {
  it('resets Momentum and gives the second-half kick to the team that received first', () => {
    const state = scene({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 12, row: 9 } })
    state.round = 4
    state.teams.home.momentum = 0
    state.teams.away.momentum = 1
    const after = run(engine, state, wait, wait).state
    expect(after).toMatchObject({ phase: 'Setup', half: 2, round: 0, kickingTeam: 'home', turnOwner: 'home' })
    expect(after.teams.home.momentum).toBe(2)
    expect(after.teams.away.momentum).toBe(2)
  })

  it.each([
    [2, 1, 'home'],
    [0, 1, 'away'],
    [1, 1, 'draw'],
  ] as const)('ends the match after the second half: %i–%i is %s', (home, away, winner) => {
    const state = scene({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 12, row: 9 } })
    state.half = 2
    state.round = 4
    state.teams.home.score = home
    state.teams.away.score = away
    const after = run(engine, state, wait, wait)
    expect(after.state).toMatchObject({ phase: 'FullTime', winner })
    expect(after.events).toContainEqual({ type: 'matchEnded', score: { home, away }, winner })
    expect(engine.legalCommands(after.state)).toEqual([])
  })
})

describe('a whole match', () => {
  it('plays from the coin toss to full time', () => {
    let state = createMatch(rulesV10, [orcs, elves], 1)
    const toss = state.pending!.team === 'away' ? 'kick' : 'receive'
    state = engine.apply(state, { type: 'decide', choice: toss }).state
    expect(state.kickingTeam).toBe('away')
    // Kicks: E for 1 each time, then a catch roll. 6 for the Orc, 4 for the Elf.
    state = { ...state, rng: forcedRng([1, 1, 6, 1, 1, 4, 1, 1, 4]) }

    const all: GameEvent[] = []
    const play = (...commands: Command[]) => {
      const result = run(engine, state, ...commands)
      state = result.state
      all.push(...result.events)
    }

    // First half, drive 1: the Elves kick to the Orc Blitzer, who catches it at (9,5).
    play(place(CATCHER, 16, 9), endSetup, place(BLITZER, 9, 5), endSetup)
    expect(state.phase).toBe('KickOff')
    play({ type: 'kick', hex: h(8, 5) })
    expect(state).toMatchObject({ phase: 'Round', round: 1, turnOwner: 'home', ball: { carrier: BLITZER } })

    // Round 1: the Blitzer runs 8 hexes, Sprinting. Then both coaches Wait.
    play(activate(BLITZER), ...[10, 11, 12, 13, 14, 15, 16, 17].map((c) => step(c, 5)), { type: 'endActivation' }, wait)
    expect(state).toMatchObject({ round: 2, turnOwner: 'away' })

    // Round 2: the Elves Wait; the Blitzer steps into the end zone. Touchdown.
    play(wait, activate(BLITZER), step(18, 5))
    expect(state.teams.home.score).toBe(1)
    expect(state).toMatchObject({ phase: 'Setup', kickingTeam: 'home', round: 2 })

    // Drive 2: the Orcs kick; the Elf Catcher takes it. Rounds 3 and 4 pass with Waits.
    play(place(BLITZER, 5, 5), endSetup, place(CATCHER, 14, 5), endSetup, { type: 'kick', hex: h(13, 5) })
    expect(state).toMatchObject({ phase: 'Round', round: 3, turnOwner: 'away', ball: { carrier: CATCHER } })
    play(wait, wait, wait, wait)

    // Half time: Momentum resets, and the Orcs kick off the second half.
    expect(types(all)).toContain('halfEnded')
    expect(state).toMatchObject({ phase: 'Setup', half: 2, round: 0, kickingTeam: 'home' })
    expect(state.teams.home.momentum).toBe(2)

    // Second half: one drive, four rounds of Waits.
    play(place(BLITZER, 5, 5), endSetup, place(CATCHER, 14, 5), endSetup, { type: 'kick', hex: h(13, 5) })
    expect(state).toMatchObject({ phase: 'Round', half: 2, round: 1 })
    play(wait, wait, wait, wait, wait, wait, wait, wait)

    expect(state).toMatchObject({ phase: 'FullTime', winner: 'home', teams: { home: { score: 1 }, away: { score: 0 } } })
    expect(all.at(-1)).toEqual({ type: 'matchEnded', score: { home: 1, away: 0 }, winner: 'home' })
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })
})
