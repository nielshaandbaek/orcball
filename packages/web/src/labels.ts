import type { ActionType, GameState, MatchFile, Player, TeamId } from '@orcball/engine'

// Names for players and teams, taken from the rosters in the match file.

const TEAM_INDEX: Record<TeamId, 0 | 1> = { home: 0, away: 1 }

export function positionName(file: MatchFile, player: Player): string {
  return file.rosters[TEAM_INDEX[player.team]].positions[player.position]?.name ?? player.position
}

/** "Brute 2" */
export function playerName(file: MatchFile, player: Player): string {
  const n = player.id.split('-').at(-1)
  return `${positionName(file, player)} ${n}`
}

/** Short label for a token: initials and number, e.g. "BO2". */
export function tokenLabel(file: MatchFile, player: Player): string {
  const initials = positionName(file, player)
    .split(/\s+/)
    .map((w) => w[0]!.toUpperCase())
    .join('')
  return `${initials}${player.id.split('-').at(-1)}`
}

export function teamName(state: GameState, team: TeamId): string {
  return state.teams[team].name
}

export const ACTION_NAMES: Record<ActionType, string> = {
  move: 'Move',
  block: 'Block',
  blitz: 'Blitz',
  pass: 'Pass',
  handOff: 'Hand-off',
  foul: 'Foul',
}
