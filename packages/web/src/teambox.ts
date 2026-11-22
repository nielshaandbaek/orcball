import type { GameState, TeamId } from '@orcball/engine'

/** The actions a team may take once a round, in the order the team bar shows them (#253). */
export const ROUND_ACTIONS = [
  { key: 'blitz', label: 'Blitz' },
  { key: 'pass', label: 'Pass' },
  { key: 'handOff', label: 'Hand-off' },
  { key: 'foul', label: 'Foul' },
] as const
export type RoundAction = (typeof ROUND_ACTIONS)[number]['key']

/**
 * What a team's block in the score bar shows (#253, from #178 and #172):
 * whether it's the team's go, the players it still has to activate this
 * round, which of its once-a-round actions are still free, and a double
 * activation it has. null outside a round (setup, kick-off, touchdown, half
 * and full time).
 */
export type TeamBox = {
  name: string
  /** The team whose go it is: full colour; the other is faded. */
  onGo: boolean
  /** Players on the pitch not yet activated this round; the active player counts until his activation ends. */
  left: number
  /** The team can still Blitz this round, and has a player left to do it. */
  blitz: boolean
  /** Each once-a-round action: still free this round (and a player left to take it), or used. */
  free: Record<RoundAction, boolean>
  /** Activations left in a double activation the team has, or 0. */
  double: number
  /** All of it in words, for screen readers and the tooltip. */
  label: string
}

export function teamBox(game: GameState, team: TeamId): TeamBox | null {
  if (game.phase !== 'Round' && game.phase !== 'Activation') return null
  const { name, usedThisRound } = game.teams[team]
  const left = Object.values(game.players).filter((p) => p.team === team && p.hex && !p.activatedThisRound).length
  const limits = game.config.activations.perRoundPerTeam
  const free = Object.fromEntries(ROUND_ACTIONS.map(({ key }) => [key, left > 0 && usedThisRound[key] < limits[key]])) as Record<RoundAction, boolean>
  const blitz = free.blitz
  const double = game.doubleActivation?.team === team ? game.doubleActivation.left : 0
  const onGo = game.turnOwner === team
  const parts = [
    `${left} player${left === 1 ? '' : 's'} left to activate`,
    left > 0 ? (blitz ? 'Blitz unused' : 'Blitz used') : null,
    left > 0 && ROUND_ACTIONS.some(({ key }) => key !== 'blitz' && !free[key])
      ? `${ROUND_ACTIONS.filter(({ key }) => key !== 'blitz' && !free[key])
          .map(({ label }) => label)
          .join(', ')} used`
      : null,
    double > 0 ? `double activation${double < 2 ? ' (one more)' : ''}` : null,
  ].filter(Boolean)
  return { name, onGo, left, blitz, free, double, label: `${name}${onGo ? '’ go' : ''}: ${parts.join(', ')}` }
}
