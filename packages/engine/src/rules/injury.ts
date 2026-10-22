import type { RuleContext, RuleModule } from '../engine'

// Knock-downs, armour and injury, fouls (RULES.md §6 and §8).
// The armour and injury roll and fouls arrive in #13; dropping the ball
// arrives with the ball rules (#8).

/** Knock a player down: placed prone where they stand. */
export function knockDown(ctx: RuleContext, playerId: string): void {
  const player = ctx.state.players[playerId]!
  player.status = 'prone'
  ctx.emit({ type: 'knockedDown', playerId })
}

export const injury: RuleModule = {
  name: 'injury',
}
