import type { RolledEvent } from '../dice'
import type { RuleContext, RuleModule } from '../engine'
import type { Json } from '../json'
import type { DecisionChoice, GameState, PendingDecision, TeamId } from '../state'
import { atStartOfGo } from './round'

// Momentum (RULES.md §9). Each team gets a few tokens per half, at most one
// per round. A token buys either a double activation at the start of a go,
// or a re-roll of one of the team's own rolls. Armour, injury and scatter
// rolls can't be re-rolled, so those rules never offer one, and no roll is
// re-rolled more than once.
//
// Re-rolls are pending decisions owned by the rule that rolled: it calls
// offerReroll after a failure and, in its own decision handler, resolveReroll
// to get the final result. That keeps each rule's follow-up in one place.

/** Why the team can't spend Momentum now, or null if it can. */
export function momentumBlocked(state: GameState, team: TeamId): string | null {
  const t = state.teams[team]
  if (t.momentum <= 0) return 'No Momentum left this half'
  if (t.momentumUsedThisRound) return 'Momentum already used this round'
  return null
}

function spend(ctx: RuleContext, team: TeamId, use: 'reroll' | 'double'): void {
  const t = ctx.state.teams[team]
  t.momentum--
  t.momentumUsedThisRound = true
  ctx.emit({ type: 'momentumSpent', team, use })
}

const REROLL_CHOICES: DecisionChoice[] = [
  { id: 'reroll', label: 'Re-roll (1 Momentum)' },
  { id: 'accept', label: 'Accept the result' },
]

type RerollData = { failed: RolledEvent; data: Json }

/**
 * After a failed roll, offer the team a Momentum re-roll as a pending
 * decision of the calling rule's own `kind`. Returns false when the team
 * can't spend Momentum, in which case the caller goes on with the failure.
 */
export function offerReroll(
  ctx: RuleContext,
  offer: { kind: string; team: TeamId; failed: RolledEvent; data: Json },
): boolean {
  if (offer.failed.success) throw new Error('offerReroll: the roll succeeded')
  if (momentumBlocked(ctx.state, offer.team)) return false
  const payload: RerollData = { failed: offer.failed, data: offer.data }
  ctx.ask({
    kind: offer.kind,
    team: offer.team,
    prompt: `${offer.failed.test} failed (rolled ${offer.failed.natural}). Re-roll?`,
    choices: REROLL_CHOICES,
    data: payload,
  })
  return true
}

/**
 * Answer a re-roll offer from offerReroll. Returns the final rolled event (the
 * re-roll, or the original failure if the coach accepted it) and the caller's
 * own data.
 */
export function resolveReroll(
  ctx: RuleContext,
  pending: PendingDecision,
  choice: DecisionChoice,
): { event: RolledEvent; data: Json } {
  const { failed, data } = pending.data as RerollData
  if (choice.id !== 'reroll') return { event: failed, data }
  spend(ctx, pending.team, 'reroll')
  return { event: ctx.test(failed.test, failed.target, failed.modifiers), data }
}

export const momentum: RuleModule = {
  name: 'momentum',

  options(state) {
    if (!atStartOfGo(state)) return []
    const team = state.turnOwner
    const command = { type: 'spendMomentum', use: 'double' } as const
    if (state.doubleActivation?.team === team) {
      return [{ command, available: false, reason: 'You already have a double activation' }]
    }
    const blocked = momentumBlocked(state, team)
    return [blocked ? { command, available: false, reason: blocked } : { command, available: true }]
  },

  commands: {
    spendMomentum(ctx) {
      const team = ctx.state.turnOwner
      spend(ctx, team, 'double')
      ctx.state.doubleActivation = { team, left: 2 }
      ctx.emit({ type: 'doubleActivationGained', team, source: 'momentum' })
    },
  },
}
