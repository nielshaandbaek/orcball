import type { GameState, TeamId } from '@orcball/engine'

/**
 * The Blitz badge in the score bar (#143): whether the team can still Blitz
 * this round, or null outside a round (setup, kick-off, half and full time).
 */
export function blitzBadge(game: GameState, team: TeamId): { left: boolean; label: string } | null {
  if (game.phase !== 'Round' && game.phase !== 'Activation') return null
  const { name, usedThisRound } = game.teams[team]
  const left = usedThisRound.blitz < game.config.activations.perRoundPerTeam.blitz
  return { left, label: left ? `${name} can still Blitz this round` : `${name} have Blitzed this round` }
}
