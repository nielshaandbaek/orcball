import type { GameState, TeamId } from '@orcball/engine'

/**
 * What a team's box under the board shows (#178, #172): whether it's the
 * team's go, the players it still has to activate this round, whether it can
 * still Blitz (the first dot is a bolt), and a double activation it has. null
 * outside a round (setup, kick-off, touchdown, half and full time).
 */
export type TeamBox = {
  name: string
  /** The team whose go it is: full colour; the other is faded. */
  onGo: boolean
  /** Players on the pitch not yet activated this round; the active player counts until his activation ends. */
  left: number
  /** The team can still Blitz this round, and has a player left to do it. */
  blitz: boolean
  /** Activations left in a double activation the team has, or 0. */
  double: number
  /** All of it in words, for screen readers and the tooltip. */
  label: string
}

export function teamBox(game: GameState, team: TeamId): TeamBox | null {
  if (game.phase !== 'Round' && game.phase !== 'Activation') return null
  const { name, usedThisRound } = game.teams[team]
  const left = Object.values(game.players).filter((p) => p.team === team && p.hex && !p.activatedThisRound).length
  const blitz = left > 0 && usedThisRound.blitz < game.config.activations.perRoundPerTeam.blitz
  const double = game.doubleActivation?.team === team ? game.doubleActivation.left : 0
  const onGo = game.turnOwner === team
  const parts = [
    `${left} player${left === 1 ? '' : 's'} left to activate`,
    left > 0 ? (blitz ? 'Blitz unused' : 'Blitz used') : null,
    double > 0 ? `double activation${double < 2 ? ' (one more)' : ''}` : null,
  ].filter(Boolean)
  return { name, onGo, left, blitz, double, label: `${name}${onGo ? '’ go' : ''}: ${parts.join(', ')}` }
}
