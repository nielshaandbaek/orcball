import type { GameEvent, GameState, Hex } from '@orcball/engine'

/**
 * The position at the moment of a touchdown: the engine clears the
 * pitch in the same command, so without this the scorer is never seen in the
 * end zone before the Touchdown banner. The players are moved as the events
 * up to the touchdown moved them, and the scorer holds the ball. Null when the
 * command scored no touchdown.
 */
export function scoredPosition(before: GameState, events: readonly GameEvent[]): GameState | null {
  const at = events.findIndex((e) => e.type === 'touchdown')
  if (at < 0) return null
  const scorer = (events[at] as Extract<GameEvent, { type: 'touchdown' }>).playerId
  const held = structuredClone(before)
  const place = (playerId: string, hex: Hex | null) => {
    const player = held.players[playerId]
    if (player) player.hex = hex
  }
  for (const e of events.slice(0, at)) {
    if (e.type === 'moved') place(e.playerId, e.path.at(-1) ?? held.players[e.playerId]?.hex ?? null)
    else if (e.type === 'disengaged' || e.type === 'followedUp') place(e.playerId, e.to)
    else if (e.type === 'pushed') place(e.playerId, e.to)
  }
  const hex = held.players[scorer]?.hex ?? null
  if (!hex) return null
  held.ball = { ...held.ball, hex, carrier: scorer }
  held.pending = null
  return held
}
