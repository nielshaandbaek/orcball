import { distance, type Hex, onPitch } from '../hex'
import type { GameState, Player, TeamId } from '../state'

// Tackle zones and assists, shared by movement, catching, blocking and fouls.

export function exertsTackleZone(player: Player): boolean {
  // Off the pitch (pushed into the crowd, waiting for the injury roll) is no tackle zone.
  return player.hex !== null && onPitch(player.hex) && player.status === 'standing' && !player.winded
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

/** Strength totals for one player against another: ST + assists each (blocks and Strength Disengage). */
export function blockTotals(state: GameState, attacker: Player, defender: Player): { attack: number; defence: number } {
  const value = state.config.blocking.assistValue
  return {
    attack: attacker.st + value * countAssists(state, attacker, defender),
    defence: defender.st + value * countAssists(state, defender, attacker),
  }
}
