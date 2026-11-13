import { apply, createMatch, forcedRng, fromColRow, type GameState, legalCommands, type PlayerStatus, type RuleConfig, rulesV12 } from '@orcball/engine'
import { type AiView, viewOf } from './view'

export const { orcs, elves } = rulesV12.rosters as Record<'orcs' | 'elves', (typeof rulesV12.rosters)[string]>

export const h = (col: number, row: number) => fromColRow({ col, row })

export type Placement = { col: number; row: number; status?: PlayerStatus }

/**
 * Round 1 of a match (v12 unless `config` says otherwise), Orcs at home and to go, with only these players on
 * the pitch. `faces` forces the dice; without them the match's own seeded dice roll.
 */
export function scene(
  placements: Record<string, Placement>,
  options: { carrier?: string; ball?: Placement; faces?: number[]; config?: RuleConfig } = {},
): GameState {
  const config = options.config ?? rulesV12
  const state = createMatch(config, [config.rosters.orcs!, config.rosters.elves!], 1)
  for (const [id, { col, row, status }] of Object.entries(placements)) {
    state.players[id]!.hex = h(col, row)
    state.players[id]!.status = status ?? 'standing'
  }
  Object.assign(state, { pending: null, phase: 'Round', round: 1, kickingTeam: 'away', openingKicker: 'away', firstGo: 'home', turnOwner: 'home' })
  if (options.carrier) state.ball = { hex: state.players[options.carrier]!.hex, carrier: options.carrier }
  else if (options.ball) state.ball = { hex: h(options.ball.col, options.ball.row), carrier: null }
  if (options.faces) state.rng = forcedRng(options.faces)
  return state
}

/**
 * Every `every`th position of a match played with seeded random legal
 * commands: the same positions on any machine. With `until`, play stops at
 * the first position it accepts, the last one returned.
 */
export function randomPositions(seed: number, every: number, until?: (view: AiView) => boolean): AiView[] {
  let state: GameState = createMatch(rulesV12, [orcs, elves], seed)
  const views: AiView[] = []
  let pick = seed
  for (let n = 0; state.phase !== 'FullTime' && n < 20_000; n++) {
    const view = viewOf(state)
    if (until?.(view)) return [...views, view]
    if (n % every === 0) views.push(view)
    const legal = legalCommands(state)
    pick = (Math.imul(pick, 1_103_515_245) + 12_345) >>> 0
    state = apply(state, legal[pick % legal.length]!).state
  }
  return views
}
