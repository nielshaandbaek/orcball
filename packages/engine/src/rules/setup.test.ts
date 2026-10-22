import { describe, expect, it } from 'vitest'
import { rulesV10 } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex, toColRow } from '../hex'
import { createMatch } from '../match'
import { forcedRng } from '../rng'
import type { Command, GameEvent, GameState, TeamId } from '../state'
import { RULE_MODULES } from '.'
import { run } from './test-helpers'

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })
const cr = (hex: Hex | null) => (hex ? Object.values(toColRow(hex)) : null)
const { orcs, elves } = rulesV10.rosters as Record<'orcs' | 'elves', (typeof rulesV10.rosters)[string]>

// Home (Orcs) defends the left half, away (Elves) the right. In these tests
// away kicks off, so home receives in the left half.

/** A new match with the coin toss answered so that `kicker` kicks off. */
function afterToss(kicker: TeamId = 'away', rosters: [typeof orcs, typeof elves] = [orcs, elves]): GameState {
  const state = createMatch(rulesV10, rosters, 1)
  const choice = state.pending!.team === kicker ? 'kick' : 'receive'
  return engine.apply(state, { type: 'decide', choice }).state
}

const place = (playerId: string, col: number, row: number): Command => ({ type: 'place', playerId, hex: h(col, row) })
const endSetup: Command = { type: 'endSetup' }

function option(state: GameState, command: Command) {
  return engine.availableCommands(state).find((o) => JSON.stringify(o.command) === JSON.stringify(command))
}

/** Ready to kick: away kicks, home has players at these hexes. Dice come from `faces`. */
function readyToKick(home: Record<string, [number, number]>, faces: number[]): GameState {
  const state = afterToss('away')
  for (const [id, [col, row]] of Object.entries(home)) state.players[id]!.hex = h(col, row)
  state.players['away-lineman-1']!.hex = h(14, 5)
  state.phase = 'KickOff'
  state.turnOwner = 'away'
  state.rng = forcedRng(faces)
  return state
}

const kick = (col: number, row: number): Command => ({ type: 'kick', hex: h(col, row) })
const ballPath = (events: GameEvent[]) =>
  events.flatMap((e) => (e.type === 'ballMoved' ? [[...cr(e.to)!, e.how]] : []))

describe('coin toss', () => {
  it.each([
    ['kick', 'winner'],
    ['receive', 'loser'],
  ])('lets the winner %s, so the %s kicks off', (choice) => {
    const state = createMatch(rulesV10, [orcs, elves], 1)
    const winner = state.pending!.team
    const { state: after, events } = engine.apply(state, { type: 'decide', choice })
    const kicker = choice === 'kick' ? winner : winner === 'home' ? 'away' : 'home'
    expect(events).toEqual([{ type: 'coinTossChoice', team: winner, choice }])
    expect(after).toMatchObject({ kickingTeam: kicker, openingKicker: kicker, turnOwner: kicker, pending: null })
  })
})

describe('setup', () => {
  it('starts with the kicking team, placing its own players only', () => {
    const state = afterToss('away')
    const legal = engine.legalCommands(state)
    expect(legal.length).toBeGreaterThan(0)
    expect(legal.every((c) => c.type !== 'place' || c.playerId.startsWith('away-'))).toBe(true)
  })

  it('only allows hexes in the team’s own half', () => {
    const state = afterToss('away')
    expect(option(state, place('away-lineman-1', 12, 5))).toMatchObject({ available: true })
    expect(option(state, place('away-lineman-1', 5, 5))).toMatchObject({ available: false, reason: 'Set up in your own half' })
    // The right half starts at column 10 in every row.
    expect(option(state, place('away-lineman-1', 10, 5))).toMatchObject({ available: true })
    expect(option(state, place('away-lineman-1', 10, 4))).toMatchObject({ available: true })
  })

  it('never allows a halfway hex', () => {
    const state = afterToss('away')
    for (const row of [2, 4, 6, 8]) {
      expect(option(state, place('away-lineman-1', 9, row))).toMatchObject({
        available: false,
        reason: "Halfway hexes can't be used at setup",
      })
    }
  })

  it('gives every hex on the pitch to each player, legal or with a reason', () => {
    const state = afterToss('away')
    const forOne = engine.availableCommands(state).filter((o) => o.command.type === 'place' && o.command.playerId === 'away-lineman-1')
    expect(forOne).toHaveLength(158)
    expect(forOne.filter((o) => o.available)).toHaveLength(77)
  })

  it("doesn't allow two players on one hex", () => {
    const state = run(engine, afterToss('away'), place('away-lineman-1', 12, 5)).state
    expect(option(state, place('away-lineman-2', 12, 5))).toMatchObject({ available: false, reason: 'There is already a player there' })
  })

  it('allows at most one player per wide zone', () => {
    const state = run(engine, afterToss('away'), place('away-lineman-1', 12, 1)).state
    expect(option(state, place('away-lineman-2', 13, 2))).toMatchObject({
      available: false,
      reason: 'At most 1 player per wide zone',
    })
    // The other wide zone is separate, and the same player can move within it.
    expect(option(state, place('away-lineman-2', 13, 9))).toMatchObject({ available: true })
    expect(option(state, place('away-lineman-1', 13, 2))).toMatchObject({ available: true })
  })

  it('allows at most 7 players on the pitch', () => {
    const big = { ...orcs, positions: { lineman: { ...orcs.positions.lineman!, max: 9 } } }
    let state = afterToss('home', [big, elves])
    state = run(engine, state, ...[1, 2, 3, 4, 5, 6, 7].map((n) => place(`home-lineman-${n}`, 5, n + 1))).state
    expect(option(state, place('home-lineman-8', 3, 5))).toMatchObject({
      available: false,
      reason: 'Already 7 players on the pitch',
    })
    // Someone already on the pitch can still move.
    expect(option(state, place('home-lineman-1', 3, 5))).toMatchObject({ available: true })
  })

  it('needs no minimum on the Line of Scrimmage', () => {
    const state = run(engine, afterToss('away'), place('away-lineman-1', 18, 5)).state
    expect(option(state, endSetup)).toMatchObject({ available: true })
  })

  it('lets a player be moved or taken off again', () => {
    const placed = run(engine, afterToss('away'), place('away-lineman-1', 12, 5), place('away-lineman-1', 13, 5))
    expect(placed.state.players['away-lineman-1']!.hex).toEqual(h(13, 5))
    const off = run(engine, placed.state, { type: 'unplace', playerId: 'away-lineman-1' })
    expect(off.state.players['away-lineman-1']!.hex).toBeNull()
    expect(off.events).toEqual([{ type: 'unplaced', playerId: 'away-lineman-1' }])
  })

  it('needs at least one player on the pitch to finish', () => {
    expect(option(afterToss('away'), endSetup)).toMatchObject({ available: false, reason: 'Set up at least one player' })
  })

  it('hands over to the receiving team, then to the kick', () => {
    const kicked = run(engine, afterToss('away'), place('away-lineman-1', 12, 5), endSetup)
    expect(kicked.state).toMatchObject({ phase: 'Setup', turnOwner: 'home' })
    const ready = run(engine, kicked.state, place('home-lineman-1', 5, 5), endSetup)
    expect(ready.state).toMatchObject({ phase: 'KickOff', turnOwner: 'away' })
    expect(ready.events).toContainEqual({ type: 'phaseChanged', from: 'Setup', to: 'KickOff' })
  })
})

describe('kick-off', () => {
  it("offers every hex in the receiver's half", () => {
    const state = readyToKick({ 'home-lineman-1': [5, 5] }, [])
    const kicks = engine.legalCommands(state).filter((c) => c.type === 'kick')
    expect(kicks).toHaveLength(77)
    expect(kicks.every((c) => c.type === 'kick' && toColRow(c.hex).col <= 9)).toBe(true)
    expect(kicks).not.toContainEqual(kick(9, 4))
  })

  it('deviates D6 direction × D6 hexes and is caught: round 1, receiving team first', () => {
    // Kick at (3,5), E for 2 → (5,5): the Orc lineman (AG 6+) catches on a 6.
    const state = readyToKick({ 'home-lineman-1': [5, 5] }, [1, 2, 6])
    const { state: after, events } = run(engine, state, kick(3, 5))
    expect(ballPath(events)).toEqual([
      [4, 5, 'kick'],
      [5, 5, 'kick'],
    ])
    expect(events).toContainEqual(expect.objectContaining({ type: 'rolled', test: 'Catch', natural: 6, success: true }))
    expect(after.ball.carrier).toBe('home-lineman-1')
    expect(after).toMatchObject({ phase: 'Round', round: 1, firstGo: 'home', turnOwner: 'home' })
  })

  it('bounces once from an empty hex and starts the round', () => {
    // Kick at (3,5), W for 1 → (2,5): empty, bounces SE to (2,6).
    const state = readyToKick({ 'home-lineman-1': [5, 5] }, [4, 1, 2])
    const { state: after, events } = run(engine, state, kick(3, 5))
    expect(ballPath(events)).toEqual([
      [2, 5, 'kick'],
      [2, 6, 'bounce'],
    ])
    expect(after.ball).toEqual({ hex: h(2, 6), carrier: null })
    expect(after.phase).toBe('Round')
  })

  it('is a touchback if it lands on a halfway hex', () => {
    // Kick at (8,4), E for 1 → (9,4).
    const state = readyToKick({ 'home-lineman-1': [5, 5], 'home-thrower-1': [3, 3] }, [1, 1])
    const { state: after, events } = run(engine, state, kick(8, 4))
    expect(events).toContainEqual({ type: 'touchback', team: 'home' })
    expect(after.pending).toMatchObject({ kind: 'kickOff.touchback', team: 'home' })
    expect(engine.legalCommands(after)).toEqual([
      { type: 'decide', choice: 'home-thrower-1' },
      { type: 'decide', choice: 'home-lineman-1' },
    ])
    const given = run(engine, after, { type: 'decide', choice: 'home-thrower-1' })
    expect(given.events).toContainEqual({ type: 'ballGiven', playerId: 'home-thrower-1' })
    expect(given.state.ball).toEqual({ hex: h(3, 3), carrier: 'home-thrower-1' })
    expect(given.state).toMatchObject({ phase: 'Round', round: 1, turnOwner: 'home' })
  })

  it('is a touchback if it goes out of bounds', () => {
    // Kick at (2,5), W for 3: off the pitch after (1,5).
    const state = readyToKick({ 'home-lineman-1': [5, 5] }, [4, 3])
    const { state: after, events } = run(engine, state, kick(2, 5))
    expect(events).toContainEqual({ type: 'touchback', team: 'home' })
    expect(after.pending?.kind).toBe('kickOff.touchback')
  })

  it("is a touchback if it ends in the kicker's half", () => {
    // Kick at (9,5), E for 1 → (10,5); bounces E to (11,5).
    const state = readyToKick({ 'home-lineman-1': [5, 5] }, [1, 1, 1])
    expect(run(engine, state, kick(9, 5)).state.pending?.kind).toBe('kickOff.touchback')
  })

  it("is fine if it lands in the kicker's half but bounces back", () => {
    // Kick at (9,5), E for 1 → (10,5); bounces W to (9,5), the receiver's half.
    const state = readyToKick({ 'home-lineman-1': [5, 5] }, [1, 1, 4])
    const after = run(engine, state, kick(9, 5)).state
    expect(after.pending).toBeNull()
    expect(after.ball).toEqual({ hex: h(9, 5), carrier: null })
    expect(after.phase).toBe('Round')
  })

  it('is a touchback if a bounce goes out of bounds', () => {
    // Kick at (2,5), W for 1 → (1,5); bounces W, off the pitch.
    const state = readyToKick({ 'home-lineman-1': [5, 5] }, [4, 1, 4])
    expect(run(engine, state, kick(2, 5)).state.pending?.kind).toBe('kickOff.touchback')
  })
})
