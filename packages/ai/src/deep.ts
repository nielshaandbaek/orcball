import { type Command, enemyTackleZones, type TeamId } from '@orcball/engine'
import { defaultWeights, plainMoveKey, type Weights } from './evaluate'
import { type Choice, kickCommand, positionSeed, setupCommand } from './novice'
import { generatePlans, nextStep, type Plan, startCursor } from './plans'
import { decisionReason, planReason } from './reasons'
import { type Leaf, Search } from './search'
import { type AiView, legalOf, simulate, stateOf } from './view'

// Intermediate and Expert: the same evaluation as Novice, searched deeper.
//
// A ply is one go: the acting team's whole activation (a plan) or a Wait.
// Every candidate is scored one ply deep first, as Novice does. The best few
// are then searched further: from every position the plan can end in, with
// its chance, the team that acts next takes its best candidate, scored the
// same way one ply less deep. The computer maximises its evaluation and the
// other team minimises it (the evaluation is zero-sum), and the dice are
// averaged over (expectimax).
//
// - Intermediate searches two plies: its own plan, then the best reply.
// - Expert deepens one ply at a time (iterative deepening) while the budget
//   allows, and plays the best plan of the deepest search it finished.
//
// The time budget is a hard limit. A search that runs out of time stops, and
// a candidate it didn't finish isn't counted, so a slow device searches less
// deep rather than taking longer.

export type DeepLevel = 'intermediate' | 'expert'

/** Candidates searched further at the top of the tree, and below it. */
const ROOT_BEAM = 8
const BEAM = 4
/** How many of a candidate's end positions are searched on from, and the share of its chances that's enough; see candidateValue. */
const SEARCHED_LEAVES = 3
const LEAF_MASS = 0.8
/** Expert's deepest search. Beyond it the dice average out too much to be worth the time. */
const EXPERT_MAX_PLIES = 4
/** Expert starts a deeper search only if it's likely to finish: the last one took this share of the budget at most. */
const DEEPEN_SHARE = 0.1

/** A go: a plan, or Wait. */
type Candidate = { plan: Plan | null; command: Command | null; value: number }

/**
 * A key for a Move plan such that two plans with the same key score the
 * same one ply deep: the same steps up to the last Dodge (so the same rolls,
 * and the same hexes to fall in if one fails), then plain steps to ends the
 * evaluation can't tell apart (see plainMoveKey). null for a move that can't be matched so.
 */
export function moveKey(view: AiView, plan: Plan): string | null {
  const player = view.players[plan.playerId]!
  const end = plainMoveKey(view, plan.playerId, plan.path.at(-1)!, plan.move!.sprint)
  if (end === null || !player.hex) return null
  // A step onto a loose ball picks it up on the way.
  const ball = view.ball.carrier ? null : view.ball.hex
  if (ball && plan.path.some((h) => h.q === ball.q && h.r === ball.r)) return null
  if (plan.move!.dodges === 0) return end
  // Where the last Dodge is depends on the rules version: on leaving a tackle zone (v11 on) or entering one.
  const state = stateOf(view)
  const onLeaving = view.config.movement.tackleZones === 'dodgeOnLeaving'
  let lastDodge = 0
  plan.path.forEach((hex, i) => {
    const from = i === 0 ? player.hex! : plan.path[i - 1]!
    const zonesAt = enemyTackleZones(state, onLeaving ? from : hex, player.team)
    if (zonesAt > 0 && (onLeaving || i < plan.path.length - 1)) lastDodge = i + 1
  })
  return `${plan.path
    .slice(0, lastDodge)
    .map((h) => `${h.q},${h.r}`)
    .join(' ')}|${end}`
}

/** Thrown when the budget runs out mid-search: what that search found is discarded. */
class OutOfTime extends Error {}

class DeepSearch {
  /** The search at the top of the tree. */
  readonly search: Search

  constructor(
    readonly me: TeamId,
    private readonly weights: Weights,
    private readonly seed: number,
    private readonly deadline: number,
  ) {
    this.search = this.newSearch()
  }

  /**
   * A Search with its own memos. Each position searched below the top gets
   * one, so its memos go when it's done: kept for the whole decision, they
   * held every position ever looked at, and collecting the garbage took a third of the time.
   */
  private newSearch(): Search {
    const search = new Search(this.me, this.weights, this.seed)
    // The budget, not a node count, bounds the deep search; decisions inside plans stay two steps deep.
    search.maxNodes = Infinity
    search.deadline = this.deadline
    return search
  }

  private checkTime(): void {
    if (Date.now() > this.deadline) throw new OutOfTime()
  }

  /**
   * Every go open to the acting team, scored one ply deep, best first for
   * that team. At the top of the search (`partial`), running out of time
   * keeps the candidates scored so far, as Novice does. Below the top, of
   * plain moves that score the same one ply deep (see plainMoveKey), only
   * the first is tried: the replies are most of the search, and most of
   * their moves are lineman steps that change nothing the evaluation sees.
   */
  candidates(view: AiView, search: Search, partial = false): Candidate[] {
    const sign = view.turnOwner === this.me ? 1 : -1
    const result: Candidate[] = []
    const seen = new Set<string>()
    for (const plan of generatePlans(view)) {
      if (!partial && plan.move) {
        const key = moveKey(view, plan)
        if (key !== null && seen.has(key)) continue
        if (key !== null) seen.add(key)
      }
      if (partial && result.length > 0 && Date.now() > this.deadline) break
      if (!partial) this.checkTime()
      result.push({ plan, command: null, value: search.planValue(view, plan) })
    }
    const wait = legalOf(view).find((c) => c.type === 'wait')
    if (wait) result.push({ plan: null, command: wait, value: search.value(simulate(view, wait, { seed: 1 }).view) })
    // A stable sort keeps generation order between equal values, as Novice's strict comparison does.
    return result.sort((a, b) => sign * (b.value - a.value))
  }

  /** Where a candidate can end, with the chances. */
  leaves(view: AiView, candidate: Candidate, search: Search): Leaf[] {
    if (candidate.plan) return search.planLeaves(view, candidate.plan, true)
    return [{ p: 1, view: simulate(view, candidate.command!, { seed: 1 }).view }]
  }

  /**
   * A candidate's value for the computer, searching `plies` deep (counting
   * the candidate's own). The play goes on from the likeliest positions the
   * candidate can end in: up to SEARCHED_LEAVES of them, until they cover
   * LEAF_MASS of the chance. The rest, mostly rare branches of a roll, are
   * scored as they stand, adjusted by how much searching on changed the
   * value of the others on average.
   */
  candidateValue(view: AiView, candidate: Candidate, plies: number, search: Search = this.search): number {
    if (plies <= 1) return candidate.value
    const leaves = this.leaves(view, candidate, search).sort((a, b) => b.p - a.p)
    let total = 0
    let searched = 0
    let count = 0
    let change = 0
    let rest = 0
    for (const leaf of leaves) {
      const now = leaf.value ?? search.value(leaf.view)
      if (leaf.value === undefined && count < SEARCHED_LEAVES && searched < LEAF_MASS) {
        const deeper = this.positionValue(leaf.view, plies - 1)
        total += leaf.p * deeper
        change += leaf.p * (deeper - now)
        searched += leaf.p
        count++
      } else {
        total += leaf.p * now
        rest += leaf.p
      }
    }
    return total + (searched > 0 ? (rest * change) / searched : 0)
  }

  /** A position's value for the computer, with `plies` gos still to search. */
  positionValue(view: AiView, plies: number): number {
    this.checkTime()
    // Only a go can be searched: not a decision still open, a setup, a kick-off or full time.
    const search = this.newSearch()
    if (plies <= 0 || view.pending || view.activation || (view.phase !== 'Round' && view.phase !== 'Activation')) {
      return search.settled(view, this.me, 2)
    }
    const candidates = this.candidates(view, search)
    if (candidates.length === 0) return search.value(view)
    if (plies === 1) return candidates[0]!.value
    const sign = view.turnOwner === this.me ? 1 : -1
    let best = -Infinity
    for (const candidate of candidates.slice(0, BEAM)) best = Math.max(best, sign * this.candidateValue(view, candidate, plies, search))
    return sign * best
  }
}

/**
 * A plan chosen earlier, kept for the positions it expects next: when the
 * match goes as planned (a step with no roll, a roll that succeeds), the next
 * command comes from the plan rather than a new search. A deep search takes
 * seconds, and a plan is a dozen commands. Anything unexpected (a failed roll,
 * other dice) gives a position the plan didn't expect, and the computer searches again.
 */
type Kept = { plan: Plan; cursor: ReturnType<typeof startCursor>; reason: string }
const kept = new Map<string, Kept>()
const KEPT_MAX = 256

/** Plans are kept per team, level and weights: two computers in one process mustn't follow each other's plans. */
function keyOf(view: AiView, me: TeamId, level: DeepLevel, weights: Weights): string {
  const { config: _config, ...rest } = view
  return `${me}|${level}|${weights.id}|${JSON.stringify(rest)}`
}

/** Remember what the plan expects after this step, so the next command can follow it. */
function keep(
  view: AiView,
  me: TeamId,
  level: DeepLevel,
  weights: Weights,
  plan: Plan,
  cursor: Kept['cursor'],
  command: Command,
  reason: string,
  search: Search,
): void {
  if (kept.size > KEPT_MAX) kept.clear()
  for (const o of search.outcomes(view, command)) {
    if (o.view.pending || !nextStep(o.view, plan, cursor)) continue
    kept.set(keyOf(o.view, me, level, weights), { plan, cursor, reason })
  }
}

export function chooseDeep(view: AiView, me: TeamId, level: DeepLevel, weights: Weights = defaultWeights, budgetMs = 10_000): Choice {
  const start = Date.now()
  const deadline = start + budgetMs
  const seed = positionSeed(view)
  const deep = new DeepSearch(me, weights, seed, deadline)
  const search = deep.search

  if (view.pending) {
    const { choice } = search.decide(view)
    const picked = view.pending.choices.find((c) => c.id === choice) ?? { id: choice, label: choice }
    return { command: { type: 'decide', choice }, reason: decisionReason(view, view.pending, picked, me) }
  }
  if (view.phase === 'Setup') return setupCommand(view, me, search)
  if (view.phase === 'KickOff') return kickCommand(view, search)

  const plan = (p: Plan) => `${p.playerId}: ${p.label}`
  const continued = kept.get(keyOf(view, me, level, weights))
  if (continued) {
    const step = nextStep(view, continued.plan, continued.cursor)
    if (step) {
      keep(view, me, level, weights, continued.plan, step.cursor, step.command, continued.reason, search)
      return { command: step.command, reason: continued.reason, plan: plan(continued.plan) }
    }
  }

  // One ply: every candidate, as Novice scores them. A budget too short for even that plays the best found so far.
  let ranked = deep.candidates(view, search, true)
  let best = ranked[0] ?? null
  const maxPlies = level === 'intermediate' ? 2 : EXPERT_MAX_PLIES
  for (let plies = 2; plies <= maxPlies && ranked.length > 1; plies++) {
    const began = Date.now()
    const scored: Candidate[] = []
    try {
      for (const candidate of ranked.slice(0, ROOT_BEAM)) scored.push({ ...candidate, value: deep.candidateValue(view, candidate, plies) })
    } catch (e) {
      if (!(e instanceof OutOfTime)) throw e
    }
    // A search cut short still counts if it got through the previous best (searched first):
    // whatever it found beats that at this depth, too.
    if (scored.length > 0) {
      scored.sort((a, b) => b.value - a.value)
      best = scored[0]!
      ranked = [...scored, ...ranked.slice(scored.length)]
    }
    if (Date.now() > deadline) break
    if (level === 'expert' && Date.now() - began > budgetMs * DEEPEN_SHARE) break
  }

  if (best?.command) return { command: best.command, reason: 'Waits, keeping its players for later in the round', plan: 'wait' }
  if (best?.plan) {
    const step = nextStep(view, best.plan, startCursor(best.plan))
    if (step) {
      const reason = planReason(view, best.plan, me, search)
      keep(view, me, level, weights, best.plan, step.cursor, step.command, reason, search)
      return { command: step.command, reason, plan: plan(best.plan) }
    }
  }
  const legal = legalOf(view)
  const fallback = legal.find((c) => c.type === 'endActivation') ?? legal.find((c) => c.type === 'wait') ?? legal[0]
  if (!fallback) throw new Error(`chooseDeep: no legal commands in phase ${view.phase}`)
  return { command: fallback, reason: 'No plan fits' }
}
