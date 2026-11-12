import { type DecisionChoice, type Hex, otherTeam, type PendingDecision, type TeamId, toColRow } from '@orcball/engine'
import { evaluate, type Feature } from './evaluate'
import { nextStep, type Plan, startCursor } from './plans'
import type { Search } from './search'
import { type AiView, faceFor, previewsOf, simulate } from './view'

// The computer's reasons, in plain words for the match log (#61): what the
// plan does, what it's for (the evaluation terms that gain most if it works)
// and the odds of the rolls it needs. A reason only uses what a coach can see:
// the board and the odds the engine shows, never the dice to come.

/** A hex as the board and RULES.md write it: (column, row). */
export function where(hex: Hex): string {
  const { col, row } = toColRow(hex)
  return `(${col}, ${row})`
}

/** Player ids in engine text (a choice's label, say) as names. */
export function named(view: AiView, text: string, me: TeamId): string {
  return text.replace(/\b(home|away)-[a-z-]+-\d+\b/g, (id) => playerLabel(view, id, me))
}

/** "Brute 1" for the computer's own players, "Elves Catcher 1" for the other team's. */
export function playerLabel(view: AiView, id: string, me: TeamId): string {
  const p = view.players[id]
  if (!p) return id
  const roster = Object.values(view.config.rosters).find((r) => r.name === view.teams[p.team].name)
  const name = `${roster?.positions[p.position]?.name ?? p.position} ${p.id.split('-').at(-1)}`
  return p.team === me ? name : `${view.teams[p.team].name} ${name}`
}

/** What the plan does, e.g. "Blitzer 1 Blitzes Elves Catcher 1 from (10, 4)". */
export function planAction(view: AiView, plan: Plan, me: TeamId): string {
  const who = playerLabel(view, plan.playerId, me)
  const target = (id: string) => playerLabel(view, id, me)
  const end = plan.path.at(-1)
  const from = end ? ` from ${where(end)}` : ''
  const final = plan.final
  if (final?.type === 'block') return plan.action === 'blitz' ? `${who} Blitzes ${target(final.targetId)}${from}` : `${who} blocks ${target(final.targetId)}`
  if (final?.type === 'pass') {
    const mate = Object.values(view.players).find((p) => p.hex && p.hex.q === final.target.q && p.hex.r === final.target.r)
    return `${who} passes to ${mate ? target(mate.id) : where(final.target)}`
  }
  if (final?.type === 'handOff') return `${who} hands off to ${target(final.targetId)}`
  if (final?.type === 'foul') return `${who} fouls ${target(final.targetId)}${from}`
  if (end) return `${who} moves to ${where(end)}`
  if (plan.label.endsWith('turns face up')) return `${who} turns face up`
  if (plan.standUp) return `${who} stands up`
  return plan.activate ? `${who} stays where he is` : `${who} stops here`
}

/** What a gain in each evaluation term is for, said as a purpose. */
const PURPOSE: Partial<Record<Feature, string>> = {
  score: 'score',
  ball: 'get the ball',
  carrierProgress: 'take the ball forward',
  carrierMarked: 'free the ball carrier',
  carrierThreats: 'keep the ball carrier out of reach',
  carrierSupport: 'support the ball carrier',
  carrierLane: 'clear the ball carrier’s way',
  carrierScreen: 'screen the ball carrier',
  receivers: 'get free for a pass',
  forwardThreats: 'get free up front',
  carrierReach: 'open a way to the end zone',
  looseBallCloser: 'get nearer the loose ball',
  standing: 'knock a player down',
  out: 'take a player out',
  injured: 'take a player out',
  markedOpponents: 'mark opponents',
}

/** Gains smaller than this are noise, not a purpose. */
const MIN_GAIN = 0.25

/** The purposes of going from `before` to `after`: the largest gains in the evaluation, at most two. */
export function purposes(before: AiView, after: AiView, me: TeamId, search: Search): string[] {
  const a = evaluate(before, me, search.weights).contributions
  const b = evaluate(after, me, search.weights).contributions
  const gains = (Object.keys(PURPOSE) as Feature[])
    .map((f) => ({ f, gain: b[f] - a[f] }))
    .filter((g) => g.gain >= MIN_GAIN)
    .sort((x, y) => y.gain - x.gain)
  const out: string[] = []
  for (const { f } of gains) {
    let text = PURPOSE[f]!
    // More of the team standing is a player knocked down, or one of ours back up.
    if (f === 'standing') {
      const standing = (v: AiView, t: TeamId) => Object.values(v.players).filter((p) => p.team === t && p.hex && p.status === 'standing').length
      if (standing(after, otherTeam(me)) >= standing(before, otherTeam(me))) continue
    }
    if (f === 'ball' && score(after, me) > score(before, me)) continue
    // Getting the ball moves its carrier forward too, and ends the chase for the loose ball: one purpose.
    if ((f === 'carrierProgress' || f === 'looseBallCloser') && gains.some((g) => g.f === 'ball')) continue
    // Taking the ball off the other team is winning it.
    if (f === 'ball' && before.ball.carrier && before.players[before.ball.carrier]?.team !== me) text = 'win the ball'
    if (!out.includes(text)) out.push(text)
    if (out.length === 2) break
  }
  return out
}

const score = (view: AiView, team: TeamId) => view.teams[team].score

type Roll = { test: string; chance: number }

/**
 * Walk the plan as if every roll it makes succeeds, answering decisions on the
 * way as the search would. Returns where it ends and the rolls it needed, with
 * the odds the engine shows for each. No dice are looked at: successes are forced.
 */
export function successLine(view: AiView, plan: Plan, search: Search): { view: AiView; rolls: Roll[] } {
  const rolls: Roll[] = []
  let current = view
  let cursor = startCursor(plan)
  for (let i = 0; i < 40; i++) {
    let command
    // Rolls the plan itself makes: its commands, and the Tackle it chooses. Not the catches and
    // bounces that follow, which come from sampled dice.
    let counts = true
    if (current.pending) {
      // The plan's own decisions (Shove or Tackle, follow-up) and the other coach's (Brace), as the search sees them.
      command = { type: 'decide' as const, choice: search.decide(current, 1).choice }
      counts = current.pending.kind === 'blocking.shoveOrTackle'
    } else {
      const step = nextStep(current, plan, cursor)
      if (!step) break
      command = step.command
      cursor = step.cursor
    }
    // Every roll the command makes succeeds: a Dodge and the pick-up after it, say.
    const previews = previewsOf(current, command)
    const faces = previews.map((p) => faceFor(p, 'success')).filter((f): f is number => f !== null)
    if (counts) for (const p of previews) rolls.push({ test: p.test, chance: p.chance })
    current = simulate(current, command, { faces, seed: i + 1 }).view
    if (!current.activation && !current.pending) break
  }
  return { view: current, rolls }
}

const pct = (chance: number) => `${Math.round(chance * 100)}%`

/** "Dodge 70%, Tackle 60%": the plan's rolls, at most three, then how many more. */
export function oddsText(rolls: Roll[]): string {
  const shown = rolls.slice(0, 3).map((r) => `${r.test} ${pct(r.chance)}`)
  if (rolls.length > 3) shown.push(`${rolls.length - 3} more`)
  return shown.join(', ')
}

/** A plan's reason: "Blitzer 1 Blitzes Elves Catcher 1 from (10, 4) to get the ball (Tackle 60%)". */
export function planReason(view: AiView, plan: Plan, me: TeamId, search: Search): string {
  const line = successLine(view, plan, search)
  const why = purposes(view, line.view, me, search)
  const odds = oddsText(line.rolls)
  return `${planAction(view, plan, me)}${why.length > 0 ? ` to ${why.join(' and ')}` : ''}${odds ? ` (${odds})` : ''}`
}

/** A decision in plain words: "Tackles (60%)", "Follows up", "Pushes to (10, 4)". */
export function decisionReason(view: AiView, pending: PendingDecision, choice: DecisionChoice, me: TeamId): string {
  const label = named(view, choice.label, me)
  const at = choice.hex ? where(choice.hex) : ''
  switch (pending.kind) {
    case 'setup.coinToss':
      return choice.id === 'kick' ? 'Chooses to kick off' : 'Chooses to receive'
    case 'kickOff.touchback':
      return `Gives the ball to ${label}`
    case 'blocking.shoveOrTackle':
      return choice.id === 'tackle' ? label.replace(/^Tackle/, 'Tackles') : 'Shoves'
    case 'blocking.push':
      if (choice.id === 'crowd') return 'Pushes into the crowd'
      return `${label === 'Chain-push' ? 'Chain-pushes' : 'Pushes'} to ${at}`
    case 'blocking.followUp':
      return choice.id === 'follow' ? 'Follows up' : 'Stays put'
    case 'blocking.brace':
      return choice.id === 'brace' ? 'Braces (+1)' : 'Doesn’t brace'
    case 'gamble.reroll':
      return choice.id === 'reroll' ? 'Re-rolls with Momentum' : 'Accepts the roll'
    case 'ball.catchOrLeave':
      return choice.id === 'catch' ? 'Tries to catch the ball' : 'Lets the ball bounce'
    case 'passing.chooseInterceptor':
      return `Intercepts with ${label}`
    default:
      return `Chooses “${label}”${at ? ` at ${at}` : ''}`
  }
}
