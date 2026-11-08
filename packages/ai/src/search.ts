import { type Command, possibleInterceptors, type RolledEvent, type RollPreview, successChance, type TeamId } from '@orcball/engine'
import { defaultWeights, evaluate, type Weights } from './evaluate'
import { type Cursor, nextStep, type Plan, startCursor } from './plans'
import { type AiView, faceFor, type Outcome, previewsOf, simulate, stateOf } from './view'

// Expected value: every candidate is scored by the evaluation of the
// positions it can lead to, each weighted by its chance. A command that rolls
// branches on the roll's outcomes with the odds from the engine's preview
// (success, failure, and a natural 1 where that differs). Rolls the preview
// doesn't cover (D6 scatter and bounces, armour and injury) come from the
// computer's own seeded dice, sampled. The dice for a sample are seeded from
// the position's seed and the command itself, not a running count, so the
// same command gets the same dice whichever plan it's part of: plans are
// compared on the same luck, and re-planning halfway through a plan sees the
// same numbers it saw at the start.

/** How far decisions look ahead: a choice, then the decisions it leads to. */
const DECISION_DEPTH = 2

/**
 * Decisions that don't count towards that depth: where a block pushes and
 * whether the attacker follows up. They roll no dice and come before the
 * knock-down (from v11 the follow-up is asked first), so counting them would
 * score a Tackle before its knock-down happens, as no better than a Shove (#119).
 */
const FREE_DECISIONS: ReadonlySet<string> = new Set(['blocking.push', 'blocking.followUp'])

const PASS_SAMPLES = 4
const FAILURE_SAMPLES = 1
const MAX_PLAN_DEPTH = 60
const MAX_PLAN_DECISIONS = 3
/** Following a plan to the end of its activation (see planLeaves): the decisions a block can still ask (push, follow-up, catch...). */
const MAX_FOLLOWED_DECISIONS = 6

export class Search {
  /** Commands simulated so far, for the time budget and the benchmark. */
  nodes = 0
  /** Past this many simulated commands, decisions stop looking ahead and take the evaluation as it stands. */
  maxNodes = 40_000
  /** Past this time (Date.now()), every line of search stops and takes the evaluation as it stands. */
  deadline = Infinity

  // Memos by position. Plans share their first steps (moves through the same
  // hexes, the same block from different approaches...), and a command's
  // outcomes depend only on the position and the command, so a position
  // reached again is the same object and its outcomes are looked up, not
  // simulated again. Positions are never changed once made.
  private readonly outcomeMemo = new WeakMap<AiView, Map<string, { p: number; view: AiView }[]>>()
  private readonly valueMemo = new WeakMap<AiView, number>()
  private readonly decideMemo = new WeakMap<AiView, Map<number, { choice: string; value: number }>>()

  constructor(
    readonly me: TeamId,
    readonly weights: Weights = defaultWeights,
    private readonly seed = 1,
  ) {}

  /**
   * Dice for one sample of a command: the same command, outcome and sample
   * always get the same dice. Where the ball is and what's being decided are
   * part of the key, so a ball left to bounce on doesn't bounce the same way forever.
   */
  private seedFor(view: AiView, command: Command, outcome: string, sample: number): number {
    const ball = view.ball.hex ? `${view.ball.hex.q},${view.ball.hex.r}` : '-'
    const key = `${JSON.stringify(command)}|${outcome}|${sample}|${ball}|${view.pending?.kind ?? ''}`
    let h = (this.seed ^ 2_166_136_261) >>> 0
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16_777_619)
    return h >>> 0
  }

  value(view: AiView, team: TeamId = this.me): number {
    let value = this.valueMemo.get(view)
    if (value === undefined) {
      value = evaluate(view, this.me, this.weights).total
      this.valueMemo.set(view, value)
    }
    // The evaluation is zero-sum: the other team's value is minus ours.
    return team === this.me ? value : -value
  }

  /** The positions a command can lead to, with their chances. */
  outcomes(view: AiView, command: Command): { p: number; view: AiView }[] {
    let memo = this.outcomeMemo.get(view)
    if (!memo) {
      memo = new Map()
      this.outcomeMemo.set(view, memo)
    }
    const key = JSON.stringify(command)
    let result = memo.get(key)
    if (!result) {
      result = this.simulateOutcomes(view, command)
      memo.set(key, result)
    }
    return result
  }

  private simulateOutcomes(view: AiView, command: Command): { p: number; view: AiView }[] {
    const preview = rollPreview(view, command)
    this.nodes++
    if (!preview) {
      // A pass someone may intercept rolls the interception first, so it's sampled a few times instead.
      const samples = command.type === 'pass' ? PASS_SAMPLES : 1
      this.nodes += samples - 1
      return Array.from({ length: samples }, (_, i) => ({ p: 1 / samples, view: simulate(view, command, { seed: this.seedFor(view, command, 'any', i) }).view }))
    }
    // A natural 1 always fails and a natural 10 always succeeds, so each has 10%.
    const success = preview.chance
    const natural1 = 0.1
    const failure = Math.max(0, 1 - success - natural1)
    const branches: { p: number; outcome: Outcome }[] = [
      { p: success, outcome: 'success' },
      { p: failure, outcome: 'failure' },
      { p: natural1, outcome: 'natural1' },
    ]
    const result: { p: number; view: AiView }[] = []
    for (const { p, outcome } of branches) {
      if (p <= 1e-9) continue
      const face = faceFor(preview, outcome)
      if (face === null) continue
      const samples = outcome === 'success' ? 1 : FAILURE_SAMPLES
      for (let i = 0; i < samples; i++) {
        if (result.length > 0) this.nodes++
        result.push({ p: p / samples, view: simulate(view, command, { faces: [face], seed: this.seedFor(view, command, outcome, i) }).view })
      }
    }
    return result
  }

  /** The best answer to the pending decision, for the team it's addressed to. */
  decide(view: AiView, depth = DECISION_DEPTH): { choice: string; value: number } {
    let memo = this.decideMemo.get(view)
    if (!memo) {
      memo = new Map()
      this.decideMemo.set(view, memo)
    }
    let result = memo.get(depth)
    if (!result) {
      result = this.decideNow(view, depth)
      memo.set(depth, result)
    }
    return result
  }

  private decideNow(view: AiView, depth: number): { choice: string; value: number } {
    const pending = view.pending!
    const next = FREE_DECISIONS.has(pending.kind) ? depth : depth - 1
    let best: { choice: string; value: number } | null = null
    for (const c of pending.choices) {
      const value = this.expect(view, { type: 'decide', choice: c.id }, pending.team, next)
      if (!best || value > best.value + 1e-9) best = { choice: c.id, value }
    }
    return best!
  }

  /** Expected value for `team` after a command, settling the decisions it leads to. */
  private expect(view: AiView, command: Command, team: TeamId, depth: number): number {
    let total = 0
    for (const o of this.outcomes(view, command)) total += o.p * this.settled(o.view, team, depth)
    return total
  }

  /** The value of a position for `team` once its pending decisions are answered. */
  settled(view: AiView, team: TeamId, depth: number): number {
    if (!view.pending || depth <= 0 || this.nodes > this.maxNodes || Date.now() > this.deadline) return this.value(view, team)
    const { value } = this.decide(view, depth)
    // The evaluation is zero-sum: a decision's value for the other team is minus its value for us.
    return view.pending.team === team ? value : -value
  }

  /** The expected value of carrying out a plan, for the searching team. */
  planValue(view: AiView, plan: Plan): number {
    let total = 0
    for (const leaf of this.planLeaves(view, plan)) total += leaf.p * (leaf.value ?? this.value(leaf.view))
    return total
  }

  /**
   * Where carrying out a plan can end, with the chances: once the plan is
   * done or no longer fits (a failed roll ended the activation). A leaf whose
   * position can't be played on from (a decision still open, the search cut
   * short) carries its value for the searching team, scored as it stands.
   *
   * With `follow`, the decisions left once the plan's own commands are done
   * (a block's push and follow-up) are answered and followed too, so the
   * leaves are where the activation ends, ready for the next go: a deeper
   * search plays on from there. Without it they're scored as they stand.
   */
  planLeaves(view: AiView, plan: Plan, follow = false): Leaf[] {
    const leaves: Leaf[] = []
    this.collectLeaves(view, plan, startCursor(plan), 1, 0, 0, leaves, follow)
    return leaves
  }

  private collectLeaves(view: AiView, plan: Plan, cursor: Cursor, p: number, depth: number, decisions: number, leaves: Leaf[], follow: boolean): void {
    // A plan is at most a few dozen commands and decisions; deeper means something keeps asking.
    if (depth > MAX_PLAN_DEPTH || Date.now() > this.deadline) {
      leaves.push({ p, view, value: this.value(view) })
      return
    }
    if (view.pending) {
      // Once the plan's own commands are done, or after a run of decisions (a ball bouncing from
      // player to player), what's left is scored like any decision: a step or two deep.
      const done = cursor.finalDone && cursor.steps >= plan.path.length
      if (follow ? decisions >= MAX_FOLLOWED_DECISIONS : done || decisions >= MAX_PLAN_DECISIONS) {
        leaves.push({ p, view, value: this.settled(view, this.me, DECISION_DEPTH) })
        return
      }
      const { choice } = this.decide(view)
      for (const o of this.outcomes(view, { type: 'decide', choice })) {
        this.collectLeaves(o.view, plan, cursor, p * o.p, depth + 1, decisions + 1, leaves, follow)
      }
      return
    }
    const step = nextStep(view, plan, cursor)
    if (!step) {
      leaves.push({ p, view })
      return
    }
    for (const o of this.outcomes(view, step.command)) this.collectLeaves(o.view, plan, step.cursor, p * o.p, depth + 1, 0, leaves, follow)
  }
}

/** A position a plan can end in, its chance, and its value if it's scored as it stands. */
export type Leaf = { p: number; view: AiView; value?: number }

/**
 * The roll a command makes, if any. A Momentum re-roll isn't covered by the
 * engine's preview, so it's rebuilt from the failed roll it repeats.
 */
function rollPreview(view: AiView, command: Command): RollPreview | null {
  if (command.type === 'pass' && view.activation) {
    const thrower = view.players[view.activation.playerId]!
    if (possibleInterceptors(stateOf(view), thrower, command.target).length > 0) return null
  }
  const [preview] = previewsOf(view, command)
  if (preview) return preview
  if (command.type === 'decide' && command.choice === 'reroll') {
    const failed = (view.pending?.data as { failed?: RolledEvent } | null)?.failed
    if (failed) return { test: failed.test, target: failed.target, modifiers: failed.modifiers, chance: successChance(failed.target, failed.modifiers) }
  }
  return null
}
