import { distance, type Hex } from '../hex'
import type { GameState, Player, TeamId } from '../state'

// Tackle zones and assists, shared by movement, catching, blocking and fouls.

export function exertsTackleZone(player: Player): boolean {
  return player.hex !== null && player.status === 'standing' && !player.winded
}

/** How many players of the other team exert a tackle zone on this hex. */
export function enemyTackleZones(state: GameState, hex: Hex, team: TeamId, ignoring: Player | null = null): number {
  let count = 0
  for (const p of Object.values(state.players)) {
    if (p.team !== team && p !== ignoring && exertsTackleZone(p) && distance(p.hex!, hex) === 1) count++
  }
  return count
}

/**
 * Assists for one player acting on another (RULES.md §5, used for blocks and
 * fouls): a teammate adjacent to the opponent, standing, not Winded, and in no
 * enemy tackle zone other than the opponent's own.
 */
export function countAssists(state: GameState, actor: Player, opponent: Player): number {
  return Object.values(state.players).filter(
    (p) =>
      p.team === actor.team &&
      p.id !== actor.id &&
      exertsTackleZone(p) &&
      distance(p.hex!, opponent.hex!) === 1 &&
      enemyTackleZones(state, p.hex!, p.team, opponent) === 0,
  ).length
}
