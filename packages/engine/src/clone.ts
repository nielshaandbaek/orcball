import { deepClone } from './json'
import type { GameState, Player } from './state'

// The copy apply changes. The rule config never changes during a match, so
// the copy shares it. Players are most of the state and the search copies a
// state for every command it tries, so they're copied field by field rather
// than by the generic deepClone. clone.test.ts checks that the copy shares
// nothing but the config, so a nested field added to Player can't slip through.

function clonePlayer(p: Player): Player {
  return { ...p, skills: [...p.skills], hex: p.hex && { q: p.hex.q, r: p.hex.r } }
}

export function cloneState(state: GameState): GameState {
  const players: Record<string, Player> = {}
  for (const id in state.players) players[id] = clonePlayer(state.players[id]!)
  return {
    ...state,
    rng: deepClone(state.rng),
    activation: deepClone(state.activation),
    doubleActivation: deepClone(state.doubleActivation),
    teams: deepClone(state.teams),
    players,
    ball: { hex: state.ball.hex && { q: state.ball.hex.q, r: state.ball.hex.r }, carrier: state.ball.carrier },
    pending: deepClone(state.pending),
  }
}
