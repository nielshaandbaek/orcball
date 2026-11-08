import { distance, type Hex, hexKey, neighbours, onPitch } from '../hex'
import type { GameState, Player, TeamId } from '../state'
import { hasSkill } from './skills'

// Tackle zones and assists, shared by movement, catching, blocking and fouls.

export function exertsTackleZone(player: Player): boolean {
  // Off the pitch (pushed into the crowd, waiting for the injury roll) is no tackle zone.
  return player.hex !== null && onPitch(player.hex) && player.status === 'standing' && !player.winded
}

/** How many players of the other team exert a tackle zone on this hex. */
export function enemyTackleZones(state: GameState, hex: Hex, team: TeamId, ignoring: Player | null = null): number {
  let count = 0
  const players = state.players
  for (const id in players) {
    const p = players[id]!
    if (p.team !== team && p !== ignoring && exertsTackleZone(p) && distance(p.hex!, hex) === 1) count++
  }
  return count
}

/**
 * Enemy tackle zones on every hex, for a team, as a map from hexKey to count
 * (hexes in none are missing). For callers that ask about many hexes of one
 * unchanging state, such as reachableHexes.
 */
export function tackleZoneMap(state: GameState, team: TeamId): Map<string, number> {
  const zones = new Map<string, number>()
  for (const p of Object.values(state.players)) {
    if (p.team === team || !exertsTackleZone(p)) continue
    for (const n of neighbours(p.hex!)) {
      const key = hexKey(n)
      zones.set(key, (zones.get(key) ?? 0) + 1)
    }
  }
  return zones
}

/**
 * Assists for one player acting on another (RULES.md §5, used for blocks,
 * fouls and the Strength Disengage check): a teammate adjacent to the
 * opponent, standing, not Winded, and in no enemy tackle zone other than the
 * opponent's own. On a block (`block`), a player with Guard (v16) assists
 * whatever other tackle zones he's in.
 */
export function countAssists(state: GameState, actor: Player, opponent: Player, { block = false }: { block?: boolean } = {}): number {
  return Object.values(state.players).filter(
    (p) =>
      p.team === actor.team &&
      p.id !== actor.id &&
      exertsTackleZone(p) &&
      distance(p.hex!, opponent.hex!) === 1 &&
      ((block && hasSkill(p, 'Guard')) || enemyTackleZones(state, p.hex!, p.team, opponent) === 0),
  ).length
}

/**
 * Strength totals for one player against another: ST + assists each. On a
 * block (`block`) Guard counts; the Strength Disengage check leaves it out.
 */
export function blockTotals(state: GameState, attacker: Player, defender: Player, { block = false }: { block?: boolean } = {}): { attack: number; defence: number } {
  const value = state.config.blocking.assistValue
  return {
    attack: attacker.st + value * countAssists(state, attacker, defender, { block }),
    defence: defender.st + value * countAssists(state, defender, attacker, { block }),
  }
}
