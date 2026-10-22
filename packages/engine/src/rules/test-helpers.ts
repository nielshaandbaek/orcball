import { rulesV10 } from '../config'
import { resolveTest } from '../dice'
import { type Engine, type RuleContext } from '../engine'
import { fromColRow } from '../hex'
import { deepClone } from '../json'
import { createMatch } from '../match'
import { forcedRng } from '../rng'
import type { Command, GameEvent, GameState, Player, TeamId } from '../state'

const { orcs, elves } = rulesV10.rosters as Record<'orcs' | 'elves', (typeof rulesV10.rosters)[string]>

/**
 * A match in round 1 of the first half, Orcs at home, Elves away kicking off,
 * so home goes first. The first `home` and `away` players of each team stand
 * on the pitch; the rest are in reserve. Dice come from `faces`.
 */
export function roundState({ home = 3, away = 3, faces = [] }: { home?: number; away?: number; faces?: number[] } = {}): GameState {
  const state = createMatch(rulesV10, [orcs, elves], 1)
  const counts: Record<TeamId, number> = { home, away }
  for (const team of ['home', 'away'] as const) {
    Object.values(state.players)
      .filter((p) => p.team === team)
      .slice(0, counts[team])
      .forEach((p, i) => {
        p.hex = fromColRow({ col: team === 'home' ? 5 : 14, row: 2 + i })
      })
  }
  state.phase = 'Round'
  state.round = 1
  state.firstGo = 'home'
  state.turnOwner = 'home'
  state.rng = forcedRng(faces)
  return state
}

/** Ids of the players on the pitch for a team, in roster order. */
export function onPitch(state: GameState, team: TeamId): string[] {
  return Object.values(state.players)
    .filter((p) => p.team === team && p.hex !== null)
    .map((p) => p.id)
}

/** Apply commands in order, collecting every event. */
export function run(engine: Engine, state: GameState, ...commands: Command[]): { state: GameState; events: GameEvent[] } {
  let current = state
  const events: GameEvent[] = []
  for (const command of commands) {
    const result = engine.apply(current, command)
    current = result.state
    events.push(...result.events)
  }
  return { state: current, events }
}

/** Run a rule helper directly against a copy of the state. */
export function runRule(state: GameState, fn: (ctx: RuleContext) => void): { state: GameState; events: GameEvent[] } {
  const draft = deepClone(state)
  const events: GameEvent[] = []
  fn({
    state: draft,
    emit: (e) => events.push(e),
    test(test, target, modifiers) {
      const result = resolveTest(draft.rng, test, target, modifiers)
      draft.rng = result.rng
      events.push(result.event)
      return result.event
    },
    ask(decision) {
      draft.pending = deepClone(decision)
    },
  })
  return { state: draft, events }
}

export type Placement = { col: number; row: number; status?: Player['status']; winded?: boolean }

/** A round-1 state with only these players on the pitch, at (col, row). */
export function scene(placements: Record<string, Placement>, faces: number[] = []): GameState {
  const state = roundState({ home: 0, away: 0, faces })
  for (const [id, p] of Object.entries(placements)) {
    const player = state.players[id]!
    player.hex = fromColRow({ col: p.col, row: p.row })
    player.status = p.status ?? 'standing'
    player.winded = p.winded ?? false
  }
  return state
}
