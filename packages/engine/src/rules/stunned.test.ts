import { describe, expect, it } from 'vitest'
import { type RuleConfig, rulesV10, rulesV11, rulesV12 } from '../config'
import { createEngine } from '../engine'
import { createMatch } from '../match'
import { rollDie, type RngState, seededRng } from '../rng'
import type { Command, GameEvent, GameState } from '../state'
import { RULE_MODULES } from '.'
import { run, scene } from './test-helpers'

// Bug hunt: a Stunned player should lose his next activation to turning face
// up (RULES.md §6), but a player stunned before he has activated in a round
// has been seen to activate and complete a Move.

const engine = createEngine(RULE_MODULES)

const BLITZER = 'home-blitzer-1'
const ORC = 'home-lineman-1'
const CATCHER = 'away-catcher-1'
const FAR_ELF = 'away-thrower-1'

/** A scene under the given rules, with the players' skills from that config and Momentum off. */
function sceneUnder(config: RuleConfig, placements: Parameters<typeof scene>[0], faces: number[]): GameState {
  const state = scene(placements, faces)
  state.config = config
  const rosters = { home: config.rosters.orcs!, away: config.rosters.elves! }
  for (const p of Object.values(state.players)) p.skills = [...rosters[p.team].positions[p.position]!.skills]
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  return state
}

/** Answer whatever decisions come up with their first choice, but never follow up. */
function settle(state: GameState): GameState {
  let current = state
  while (current.pending) {
    const choices = current.pending.choices
    const choice = choices.find((c) => c.id === 'stay') ?? choices.find((c) => c.id !== 'follow') ?? choices[0]!
    current = engine.apply(current, { type: 'decide', choice: choice.id }).state
  }
  return current
}

describe.each([rulesV10, rulesV11, rulesV12])('a player stunned before he activates, $id', (config) => {
  /** Home's Blitzer Tackles the Catcher in home's go: natural 10 hits, red 10 breaks the armour, white 3 is Stunned. */
  function catcherStunned(): GameState {
    let state = sceneUnder(config, { [BLITZER]: { col: 5, row: 5 }, [CATCHER]: { col: 6, row: 5 }, [ORC]: { col: 2, row: 1 }, [FAR_ELF]: { col: 16, row: 8 } }, [10, 10, 3])
    state = run(engine, state, { type: 'activate', playerId: BLITZER, action: 'block' }, { type: 'block', targetId: CATCHER }).state
    state = settle(engine.apply(state, { type: 'decide', choice: 'tackle' }).state)
    if (state.activation) state = engine.apply(state, { type: 'endActivation' }).state
    return state
  }

  it('is stunned, has not activated, and it is his team’s go', () => {
    const state = catcherStunned()
    expect(state.players[CATCHER]).toMatchObject({ status: 'stunned', activatedThisRound: false })
    expect(state.turnOwner).toBe('away')
    expect(state.round).toBe(1)
  })

  it('can only be activated for a Move', () => {
    const forCatcher = engine.legalCommands(catcherStunned()).filter((c) => c.type === 'activate' && c.playerId === CATCHER)
    expect(forCatcher).toEqual([{ type: 'activate', playerId: CATCHER, action: 'move' }])
  })

  it('spends that activation turning face up, and cannot move', () => {
    const { state, events } = run(engine, catcherStunned(), { type: 'activate', playerId: CATCHER, action: 'move' })
    expect(events).toContainEqual({ type: 'turnedFaceUp', playerId: CATCHER })
    expect(events).toContainEqual({ type: 'activationEnded', playerId: CATCHER, failed: false })
    expect(state.activation).toBeNull()
    expect(state.players[CATCHER]).toMatchObject({ status: 'prone', activatedThisRound: true })
    expect(engine.legalCommands(state).filter((c) => c.type === 'move' || c.type === 'standUp')).toEqual([])
  })

  it('cannot activate again in the same round', () => {
    const { state } = run(engine, catcherStunned(), { type: 'activate', playerId: CATCHER, action: 'move' })
    // Home's other player takes a go, so it comes back to away while the round is still on.
    const back = run(engine, state, { type: 'activate', playerId: ORC, action: 'move' }, { type: 'endActivation' }).state
    expect(back.turnOwner).toBe('away')
    expect(back.round).toBe(1)
    const forCatcher = engine.availableCommands(back).filter((o) => o.command.type === 'activate' && o.command.playerId === CATCHER)
    expect(forCatcher.every((o) => !o.available)).toBe(true)
  })
})

/**
 * The same rule over whole random matches: a player who is Stunned when his
 * activation starts must turn face up and do nothing else. Any command that
 * activates a Stunned player and leaves him active, moves him or stands him
 * up is reported with the seed and the command count.
 */
describe.each([rulesV10, rulesV11, rulesV12])('stunned players in random matches, $id', (config) => {
  const { orcs, elves } = config.rosters as Record<'orcs' | 'elves', NonNullable<RuleConfig['rosters'][string]>>

  function pick<T>(rng: RngState, items: readonly T[]): { item: T; rng: RngState } {
    const roll = rollDie(rng, Math.max(items.length, 2))
    return { item: items[(roll.value - 1) % items.length]!, rng: roll.rng }
  }

  /** Random legal commands; setup places a full team and ends. */
  function choose(state: GameState, rng: RngState): { item: Command; rng: RngState } {
    const legal = engine.legalCommands(state)
    if (state.phase === 'Setup' && !state.pending) {
      const placed = Object.values(state.players).filter((p) => p.team === state.turnOwner && p.hex !== null).length
      const end = legal.find((c) => c.type === 'endSetup')
      const places = legal.filter((c) => c.type === 'place' && state.players[c.playerId]!.hex === null)
      if (end && (placed >= state.config.match.playersOnPitch || places.length === 0)) return { item: end, rng }
      if (places.length > 0) return pick(rng, places)
    }
    return pick(rng, legal)
  }

  function problemsIn(seed: number): string[] {
    let state = createMatch(config, [orcs, elves], seed)
    let rng: RngState = seededRng(seed ^ 0x57a7)
    const problems: string[] = []
    // The player whose current activation began while he was Stunned.
    let activeWasStunned: string | null = null
    for (let n = 1; state.phase !== 'FullTime' && n < 20_000; n++) {
      const choice = choose(state, rng)
      rng = choice.rng
      const before = state
      const { state: after, events } = engine.apply(state, choice.item)
      const where = `seed ${seed}, command ${n} ${JSON.stringify(choice.item)}`

      if (choice.item.type === 'activate' && before.players[choice.item.playerId]!.status === 'stunned') {
        activeWasStunned = choice.item.playerId
        if (!events.some((e) => e.type === 'turnedFaceUp')) problems.push(`${where}: no turnedFaceUp`)
        if (after.activation?.playerId === activeWasStunned) problems.push(`${where}: still active after turning face up`)
      }
      if (activeWasStunned && choice.item.type !== 'activate' && before.activation?.playerId === activeWasStunned) {
        problems.push(`${where}: a command during the activation of ${activeWasStunned}, who was Stunned`)
      }
      if (after.activation?.playerId !== activeWasStunned) activeWasStunned = null
      for (const e of events as GameEvent[]) {
        const mover = e.type === 'moved' || e.type === 'stoodUp' || e.type === 'disengaged' ? e.playerId : null
        if (mover && before.players[mover]!.status === 'stunned') problems.push(`${where}: Stunned ${mover} ${e.type}`)
      }
      if (after.activation && after.players[after.activation.playerId]!.status === 'stunned') {
        problems.push(`${where}: ${after.activation.playerId} is active while Stunned`)
      }
      state = after
    }
    return problems
  }

  it('never lets a Stunned player act beyond turning face up', () => {
    const problems = Array.from({ length: 30 }, (_, i) => problemsIn(i + 1)).flat()
    expect(problems.slice(0, 10)).toEqual([])
  })
})
