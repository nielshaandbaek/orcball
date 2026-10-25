import { describe, expect, it } from 'vitest'
import { createEngine, type RuleModule } from '../engine'
import type { ActionType, Command, GameState } from '../state'
import { momentum, offerReroll, resolveReroll } from './momentum'
import { endActivation, round, startDriveRound } from './round'
import { onPitch, roundState, run, runRule } from './test-helpers'

// A stand-in rule for activations that roll: 'move' rolls a D10 'gamble' at
// 6+. Success ends the activation normally; failure offers a Momentum re-roll,
// and a failure that stands ends the activation as failed.
const gamble: RuleModule = {
  name: 'gamble',
  options: (state) =>
    state.phase === 'Activation' && !state.pending ? [{ command: { type: 'move', to: { q: 0, r: 0 } }, available: true }] : [],
  commands: {
    move(ctx) {
      const event = ctx.test('gamble', 6, [])
      if (event.success) return endActivation(ctx, { failed: false })
      const team = ctx.state.players[ctx.state.activation!.playerId]!.team
      if (!offerReroll(ctx, { kind: 'gamble.reroll', team, failed: event, data: { note: 'kept' } })) {
        endActivation(ctx, { failed: true })
      }
    },
  },
  decisions: {
    'gamble.reroll'(ctx, pending, choice) {
      const { event, data } = resolveReroll(ctx, pending, choice)
      expect(data).toEqual({ note: 'kept' })
      endActivation(ctx, { failed: !event.success })
    },
  },
}

const engine = createEngine([round, momentum, gamble])

const activate = (playerId: string, action: ActionType = 'move'): Command => ({
  type: 'activate',
  playerId,
  action,
})
const end: Command = { type: 'endActivation' }
const wait: Command = { type: 'wait' }
const roll: Command = { type: 'move', to: { q: 0, r: 0 } }
const double: Command = { type: 'spendMomentum', use: 'double' }

/** Activate a player and end the activation straight away. */
const go = (playerId: string): Command[] => [activate(playerId), end]

const noMomentum = (state: GameState) => {
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  return state
}

describe('goes', () => {
  it('starts each drive with the receiving team', () => {
    const state = roundState()
    state.phase = 'KickOff'
    state.round = 0
    state.kickingTeam = 'home'
    const { state: after, events } = runRule(state, startDriveRound)
    expect(after).toMatchObject({ phase: 'Round', round: 1, firstGo: 'away', turnOwner: 'away' })
    expect(events).toContainEqual({ type: 'phaseChanged', from: 'KickOff', to: 'Round' })
  })

  it('keeps counting rounds through the half for a new drive', () => {
    const state = roundState()
    state.phase = 'KickOff'
    state.round = 2
    expect(runRule(state, startDriveRound).state.round).toBe(3)
  })

  it('alternates between the coaches', () => {
    const state = roundState()
    const [h1, h2] = onPitch(state, 'home')
    const [a1] = onPitch(state, 'away')
    const after = run(engine, state, ...go(h1!))
    expect(after.state.turnOwner).toBe('away')
    expect(run(engine, after.state, ...go(a1!)).state.turnOwner).toBe('home')
    expect(() => run(engine, after.state, activate(h2!))).toThrow()
  })

  it('offers every action to each player who has not activated, and Wait', () => {
    const state = roundState({ home: 1, away: 1 })
    const [h1] = onPitch(state, 'home')
    expect(engine.legalCommands(state)).toEqual([
      ...['move', 'block', 'blitz', 'pass', 'handOff', 'foul'].map((action) => activate(h1!, action as ActionType)),
      wait,
      double,
    ])
  })

  it('marks the active player and offers to end the activation', () => {
    const state = roundState()
    const [h1] = onPitch(state, 'home')
    const { state: active, events } = run(engine, state, activate(h1!, 'blitz'))
    expect(active.phase).toBe('Activation')
    expect(active.activation).toEqual({
      playerId: h1,
      action: 'blitz',
      maUsed: 0,
      stopped: false,
      moved: false,
      freeLeave: null,
      blocked: false,
    })
    expect(events).toContainEqual({ type: 'activated', playerId: h1, action: 'blitz' })
    expect(engine.legalCommands(active)).toContainEqual(end)
    expect(engine.legalCommands(active)).not.toContainEqual(wait)
  })
})

describe('one activation per player', () => {
  it('greys out a player who has already activated', () => {
    const state = roundState()
    const [h1] = onPitch(state, 'home')
    const [a1] = onPitch(state, 'away')
    const back = run(engine, state, ...go(h1!), ...go(a1!)).state
    expect(back.players[h1!]!.activatedThisRound).toBe(true)
    expect(engine.availableCommands(back)).toContainEqual({
      command: activate(h1!),
      available: false,
      reason: 'This player has already activated this round',
    })
    expect(engine.legalCommands(back).some((c) => c.type === 'activate' && c.playerId === h1)).toBe(false)
  })

  it('so Blitz and Pass are always different players', () => {
    const state = roundState()
    const [h1] = onPitch(state, 'home')
    const [a1] = onPitch(state, 'away')
    const back = run(engine, state, activate(h1!, 'blitz'), end, ...go(a1!)).state
    expect(engine.legalCommands(back)).not.toContainEqual(activate(h1!, 'pass'))
  })
})

describe('once-per-round actions', () => {
  it.each(['blitz', 'pass', 'handOff', 'foul'])('allows one %s per team per round', (action) => {
    const state = roundState()
    const [h1, h2] = onPitch(state, 'home')
    const [a1] = onPitch(state, 'away')
    const back = run(engine, state, activate(h1!, action as ActionType), end, ...go(a1!)).state
    expect(back.teams.home.usedThisRound[action as 'blitz']).toBe(1)
    const option = engine.availableCommands(back).find((o) => JSON.stringify(o.command) === JSON.stringify(activate(h2!, action as ActionType)))
    expect(option).toMatchObject({ available: false, reason: expect.stringMatching(/already used its .* this round/) })
    // The other team still has its own.
    expect(engine.legalCommands(run(engine, state, activate(h1!, action as ActionType), end).state)).toContainEqual(
      activate(a1!, action as ActionType),
    )
  })

  it('does not limit Move or Block', () => {
    const state = roundState()
    const [h1, h2] = onPitch(state, 'home')
    const [a1] = onPitch(state, 'away')
    const back = run(engine, state, activate(h1!, 'block'), end, ...go(a1!)).state
    expect(engine.legalCommands(back)).toContainEqual(activate(h2!, 'block'))
  })

  it('resets the limits each round', () => {
    const state = roundState({ home: 1, away: 1 })
    const [h1] = onPitch(state, 'home')
    const [a1] = onPitch(state, 'away')
    const next = run(engine, state, activate(h1!, 'blitz'), end, ...go(a1!)).state
    expect(next.round).toBe(2)
    expect(next.teams.home.usedThisRound.blitz).toBe(0)
  })
})

describe('ending the round', () => {
  it('ends after two Waits in a row', () => {
    const state = roundState()
    const after = run(engine, state, wait)
    expect(after.state).toMatchObject({ turnOwner: 'away', lastGoWasWait: true, round: 1 })
    const ended = run(engine, after.state, wait)
    expect(ended.events).toContainEqual({ type: 'roundEnded', half: 1, round: 1 })
    expect(ended.state.round).toBe(2)
  })

  it('does not end on two Waits with an activation between them', () => {
    const state = roundState()
    const [a1] = onPitch(state, 'away')
    const after = run(engine, state, wait, ...go(a1!), wait)
    expect(after.state.round).toBe(1)
    expect(after.state.turnOwner).toBe('away')
  })

  it('ends once every player on the pitch has activated', () => {
    const state = roundState({ home: 1, away: 1 })
    const ended = run(engine, state, ...go(onPitch(state, 'home')[0]!), ...go(onPitch(state, 'away')[0]!))
    expect(ended.events).toContainEqual({ type: 'roundEnded', half: 1, round: 1 })
    expect(Object.values(ended.state.players).every((p) => !p.activatedThisRound)).toBe(true)
  })

  it('ignores players off the pitch', () => {
    const state = roundState({ home: 1, away: 1 })
    expect(Object.keys(state.players)).toHaveLength(14)
    const ended = run(engine, state, ...go(onPitch(state, 'home')[0]!), ...go(onPitch(state, 'away')[0]!))
    expect(ended.state.round).toBe(2)
  })

  it('alternates who goes first each round', () => {
    const state = roundState()
    const r2 = run(engine, state, wait, wait).state
    expect(r2).toMatchObject({ round: 2, firstGo: 'away', turnOwner: 'away' })
    const r3 = run(engine, r2, wait, wait).state
    expect(r3).toMatchObject({ round: 3, firstGo: 'home', turnOwner: 'home' })
  })

  it('makes a coach with nobody left Wait automatically', () => {
    const state = roundState({ home: 1, away: 3 })
    const [h1] = onPitch(state, 'home')
    const [a1, a2] = onPitch(state, 'away')
    // Home's only player goes; then away goes, and home has to Wait.
    const after = run(engine, state, ...go(h1!), ...go(a1!))
    expect(after.events).toContainEqual({ type: 'waited', team: 'home', forced: true })
    expect(after.state).toMatchObject({ turnOwner: 'away', lastGoWasWait: true })
    // Away keeps going until it Waits too, which ends the round.
    const more = run(engine, after.state, ...go(a2!))
    expect(more.state).toMatchObject({ turnOwner: 'away', round: 1 })
    expect(run(engine, more.state, wait).events).toContainEqual({ type: 'roundEnded', half: 1, round: 1 })
  })

  it('goes to half time after the last round of the first half, and full time after the second', () => {
    const state = roundState()
    state.round = 4
    const half = run(engine, state, wait, wait)
    expect(half.events).toContainEqual({ type: 'phaseChanged', from: 'Round', to: 'HalfTime' })
    // Half time moves straight on to setting up the second half (see drive.ts).
    expect(half.state).toMatchObject({ phase: 'Setup', half: 2, round: 0 })
    state.half = 2
    const full = run(engine, state, wait, wait).state
    expect(full.phase).toBe('FullTime')
    expect(engine.legalCommands(full)).toEqual([])
  })
})

describe('double activations', () => {
  it('follow a failed roll that stands', () => {
    const state = noMomentum(roundState({ faces: [3] }))
    const [h1] = onPitch(state, 'home')
    const failed = run(engine, state, activate(h1!), roll)
    expect(failed.events).toContainEqual({ type: 'activationEnded', playerId: h1, failed: true })
    expect(failed.events).toContainEqual({ type: 'doubleActivationGained', team: 'away', source: 'failure' })
    expect(failed.state).toMatchObject({ turnOwner: 'away', doubleActivation: { team: 'away', left: 2 } })
  })

  it('let the team activate two players in a row', () => {
    const state = noMomentum(roundState({ faces: [3] }))
    const [h1] = onPitch(state, 'home')
    const [a1, a2] = onPitch(state, 'away')
    const first = run(engine, state, activate(h1!), roll, ...go(a1!)).state
    expect(first).toMatchObject({ turnOwner: 'away', doubleActivation: { team: 'away', left: 1 } })
    const second = run(engine, first, ...go(a2!)).state
    expect(second).toMatchObject({ turnOwner: 'home', doubleActivation: null })
  })

  it('are forfeited by Waiting instead, which counts as a Wait', () => {
    const state = noMomentum(roundState({ faces: [3] }))
    const [h1] = onPitch(state, 'home')
    const after = run(engine, state, activate(h1!), roll, wait)
    expect(after.events).toContainEqual({ type: 'doubleActivationForfeited', team: 'away' })
    expect(after.state).toMatchObject({ turnOwner: 'home', doubleActivation: null, lastGoWasWait: true })
  })

  it('can stop after the first player, which does not count as a Wait', () => {
    const state = noMomentum(roundState({ faces: [3] }))
    const [h1] = onPitch(state, 'home')
    const [a1] = onPitch(state, 'away')
    const after = run(engine, state, activate(h1!), roll, ...go(a1!), wait)
    expect(after.state).toMatchObject({ turnOwner: 'home', doubleActivation: null, lastGoWasWait: false })
    // So a Wait by home now doesn't end the round.
    expect(run(engine, after.state, wait).state.round).toBe(1)
  })

  it('end early on a failure, and the opponent gets one back', () => {
    const state = noMomentum(roundState({ faces: [3, 2] }))
    const [h1] = onPitch(state, 'home')
    const [a1] = onPitch(state, 'away')
    const after = run(engine, state, activate(h1!), roll, activate(a1!), roll)
    expect(after.events).toContainEqual({ type: 'doubleActivationForfeited', team: 'away' })
    expect(after.state).toMatchObject({ turnOwner: 'home', doubleActivation: { team: 'home', left: 2 } })
  })

  it('are lost if the round ends first', () => {
    const state = noMomentum(roundState({ home: 1, away: 1, faces: [3] }))
    const [h1] = onPitch(state, 'home')
    const [a1] = onPitch(state, 'away')
    // Home goes fine; away's last player fails, which ends the round.
    const after = run(engine, state, ...go(h1!), activate(a1!), roll)
    expect(after.events).toContainEqual({ type: 'doubleActivationForfeited', team: 'home' })
    expect(after.events).toContainEqual({ type: 'roundEnded', half: 1, round: 1 })
    expect(after.state).toMatchObject({ round: 2, turnOwner: 'away', doubleActivation: null })
  })

  it('are cleared at half time', () => {
    const state = noMomentum(roundState({ home: 1, away: 1, faces: [3] }))
    state.round = 4
    const after = run(engine, state, ...go(onPitch(state, 'home')[0]!), activate(onPitch(state, 'away')[0]!), roll)
    expect(after.state).toMatchObject({ phase: 'Setup', half: 2, doubleActivation: null })
  })
})

describe('Momentum', () => {
  it('buys a double activation at the start of a go', () => {
    const state = roundState()
    const [h1, h2] = onPitch(state, 'home')
    const bought = run(engine, state, double)
    expect(bought.events).toEqual([
      { type: 'momentumSpent', team: 'home', use: 'double' },
      { type: 'doubleActivationGained', team: 'home', source: 'momentum' },
    ])
    expect(bought.state.teams.home).toMatchObject({ momentum: 1, momentumUsedThisRound: true })
    const after = run(engine, bought.state, ...go(h1!), ...go(h2!)).state
    expect(after.turnOwner).toBe('away')
  })

  it('is limited to one token per round', () => {
    const state = roundState()
    const [a1] = onPitch(state, 'away')
    const [h1] = onPitch(state, 'home')
    const back = run(engine, state, double, ...go(h1!), ...go(onPitch(state, 'home')[1]!), ...go(a1!)).state
    expect(engine.availableCommands(back)).toContainEqual({
      command: double,
      available: false,
      reason: 'Momentum already used this round',
    })
    // The next round it's available again.
    const next = run(engine, roundState(), double, wait, wait).state
    expect(next.teams.home.momentumUsedThisRound).toBe(false)
  })

  it('runs out after the tokens for the half', () => {
    const state = roundState()
    state.teams.home.momentum = 0
    expect(engine.availableCommands(state)).toContainEqual({
      command: double,
      available: false,
      reason: 'No Momentum left this half',
    })
  })

  it('cannot buy a second double on top of one', () => {
    const state = noMomentum(roundState({ faces: [3] }))
    state.teams.away.momentum = 2
    const after = run(engine, state, activate(onPitch(state, 'home')[0]!), roll).state
    expect(engine.availableCommands(after)).toContainEqual({
      command: double,
      available: false,
      reason: 'You already have a double activation',
    })
  })

  it('offers a re-roll after a failed roll, as a decision for that team', () => {
    const state = roundState({ faces: [3] })
    const [h1] = onPitch(state, 'home')
    const failed = run(engine, state, activate(h1!), roll).state
    expect(failed.pending).toMatchObject({ kind: 'gamble.reroll', team: 'home' })
    expect(engine.legalCommands(failed)).toEqual([
      { type: 'decide', choice: 'reroll' },
      { type: 'decide', choice: 'accept' },
    ])
  })

  it('previews the re-roll with the same odds as the roll it repeats', () => {
    const state = roundState({ faces: [3] })
    const failed = run(engine, state, activate(onPitch(state, 'home')[0]!), roll).state
    expect(engine.previewRolls(failed, { type: 'decide', choice: 'reroll' })).toEqual([
      { test: 'gamble re-roll', target: 6, modifiers: [], chance: 0.5 },
    ])
    expect(engine.previewRolls(failed, { type: 'decide', choice: 'accept' })).toEqual([])
  })

  it('re-rolls for a token and goes on with the new result', () => {
    const state = roundState({ faces: [3, 8] })
    const [h1] = onPitch(state, 'home')
    const failed = run(engine, state, activate(h1!), roll).state
    const rerolled = run(engine, failed, { type: 'decide', choice: 'reroll' })
    expect(rerolled.events).toContainEqual({ type: 'momentumSpent', team: 'home', use: 'reroll' })
    expect(rerolled.events).toContainEqual(expect.objectContaining({ type: 'rolled', test: 'gamble', natural: 8, success: true }))
    expect(rerolled.events).toContainEqual({ type: 'activationEnded', playerId: h1, failed: false })
    expect(rerolled.state.teams.home).toMatchObject({ momentum: 1, momentumUsedThisRound: true })
    expect(rerolled.state.doubleActivation).toBeNull()
  })

  it('never re-rolls the same roll twice', () => {
    const state = roundState({ faces: [3, 2] })
    const [h1] = onPitch(state, 'home')
    const after = run(engine, state, activate(h1!), roll, { type: 'decide', choice: 'reroll' })
    expect(after.state.pending).toBeNull()
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: h1, failed: true })
    expect(after.state.doubleActivation).toEqual({ team: 'away', left: 2 })
  })

  it('keeps the token if the coach accepts the failure', () => {
    const state = roundState({ faces: [3] })
    const [h1] = onPitch(state, 'home')
    const after = run(engine, state, activate(h1!), roll, { type: 'decide', choice: 'accept' })
    expect(after.state.teams.home.momentum).toBe(2)
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: h1, failed: true })
  })

  it('is not offered once the team has used Momentum this round', () => {
    const state = roundState({ faces: [3] })
    state.teams.home.momentumUsedThisRound = true
    const after = run(engine, state, activate(onPitch(state, 'home')[0]!), roll)
    expect(after.state.pending).toBeNull()
    expect(after.state.doubleActivation).toEqual({ team: 'away', left: 2 })
  })
})
