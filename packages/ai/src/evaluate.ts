import {
  allPitchHexes,
  distance,
  endZoneOf,
  exertsTackleZone,
  halfOf,
  type Hex,
  otherTeam,
  type Player,
  TEAM_SIDES,
  type TeamId,
} from '@orcball/engine'
import { z } from 'zod'
import defaultWeightsJson from '../weights/default.json' with { type: 'json' }
import type { AiView } from './view'

// How good a position is for one team: a weighted sum of features. Every
// feature is the team's own count minus the opponent's, so a position scores
// the same for one team as minus the other's. Search at every level uses
// this one function; the weights are data, tuned by self-play.

export const FEATURES = [
  /** Touchdowns. */
  'score',
  /** Carrying the ball. */
  'ball',
  /** How far the carrier has come: 0 at the longest distance from scoring, up to the full length in the end zone. */
  'carrierProgress',
  /** Enemy tackle zones on the carrier. */
  'carrierMarked',
  /** Opponents who can still reach the carrier this round. */
  'carrierThreats',
  /** Standing team-mates next to the carrier. */
  'carrierSupport',
  /** Opponents with a tackle zone in the carrier's lane: nearer the end zone than him and within 4 hexes (#86). */
  'carrierLane',
  /** Team-mates with a tackle zone between the carrier and an opponent who can still reach him this round (#86). */
  'carrierScreen',
  /** Standing team-mates in the opponent's half, free of tackle zones, within a quick pass of the carrier (#86). */
  'receivers',
  /** A loose ball: how much nearer the team's closest standing player is than the opponent's, at most 6. */
  'looseBallCloser',
  /** Players standing on the pitch. */
  'standing',
  /** Players on the pitch, prone or stunned. */
  'down',
  /** Players out for the drive. */
  'out',
  /** Players out for the match: casualties and ejections. */
  'injured',
  /** Standing opponents in at least one of the team's tackle zones. */
  'markedOpponents',
  /** The lead, weighted by how much of the match is over: a lead counts for more when there's less time to catch up. */
  'leadLate',
  /** Momentum tokens left. */
  'momentum',
  /** Players left in a double activation the team has gained. */
  'doubleActivation',
] as const

export type Feature = (typeof FEATURES)[number]

const weight = z.number().refine(Number.isFinite, 'must be a finite number')

export const WeightsSchema = z.strictObject({
  id: z.string().min(1),
  ...(Object.fromEntries(FEATURES.map((f) => [f, weight])) as Record<Feature, typeof weight>),
})

export type Weights = z.infer<typeof WeightsSchema>

export class WeightsError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(`Invalid evaluation weights:\n${problems.map((p) => `- ${p}`).join('\n')}`)
    this.name = 'WeightsError'
    this.problems = problems
  }
}

/** Validate parsed JSON weights. Throws a WeightsError naming every bad field. */
export function loadWeights(input: unknown): Weights {
  const result = WeightsSchema.safeParse(input)
  if (result.success) return result.data
  throw new WeightsError(
    result.error.issues.map((issue) => {
      const path = issue.path.map(String).join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    }),
  )
}

export const defaultWeights: Weights = loadWeights(defaultWeightsJson)

export type Evaluation = {
  total: number
  /** Each feature's weight times its value; they add up to the total. */
  contributions: Record<Feature, number>
}

/** Each feature, `me`'s count minus the opponent's: what the weights multiply (and what tuning fits them to). */
export function featureDifferences(view: AiView, me: TeamId): Record<Feature, number> {
  const mine = teamFeatures(view, me)
  const theirs = teamFeatures(view, otherTeam(me))
  const differences = {} as Record<Feature, number>
  for (const f of FEATURES) differences[f] = mine[f] - theirs[f]
  return differences
}

/** Score a position from `me`'s point of view. */
export function evaluate(view: AiView, me: TeamId, weights: Weights = defaultWeights): Evaluation {
  const differences = featureDifferences(view, me)
  const contributions = {} as Record<Feature, number>
  let total = 0
  for (const f of FEATURES) {
    // `+ 0` turns -0 into 0, so a level position reads as 0 for both teams.
    const c = weights[f] * differences[f] + 0
    contributions[f] = c
    total += c
  }
  return { total, contributions }
}

/** The hexes each team scores in: the end zone the other team defends. */
const SCORING_HEXES: Record<TeamId, Hex[]> = {
  home: allPitchHexes().filter((h) => endZoneOf(h) === TEAM_SIDES.away),
  away: allPitchHexes().filter((h) => endZoneOf(h) === TEAM_SIDES.home),
}

function distanceToScore(hex: Hex, team: TeamId): number {
  return Math.min(...SCORING_HEXES[team].map((h) => distance(hex, h)))
}

/** The longest distance from scoring on the pitch, the same for both teams. */
const LONGEST = Math.max(...SCORING_HEXES.away.map((h) => distanceToScore(h, 'home')))

const LOOSE_BALL_CAP = 6

/** How far ahead of the carrier an opponent stands in his lane. */
const LANE_REACH = 4

type Placed = Player & { hex: Hex }

/** An opponent's player in the carrier's lane: ahead of him, towards where he scores, and within LANE_REACH. */
function inLane(hex: Hex, carrier: Placed): boolean {
  return distance(hex, carrier.hex) <= LANE_REACH && distanceToScore(hex, carrier.team) < distanceToScore(carrier.hex, carrier.team)
}

/** Opponents who can still reach the carrier this round: standing, not yet activated, within their MA. */
function threatsTo(view: AiView, carrier: Placed): Placed[] {
  return Object.values(view.players).filter(
    (p): p is Placed => p.team !== carrier.team && p.hex !== null && p.status === 'standing' && !p.activatedThisRound && distance(p.hex, carrier.hex) - 1 <= p.ma,
  )
}

/** A team-mate at `hex`, within 2 of the carrier, on a short way from one of the threats to him: he's in their way. */
function screens(hex: Hex, carrier: Placed, threats: Placed[]): boolean {
  if (distance(hex, carrier.hex) > 2) return false
  return threats.some((t) => {
    const direct = distance(t.hex, carrier.hex)
    return distance(t.hex, hex) < direct && distance(t.hex, hex) + distance(hex, carrier.hex) <= direct + 1
  })
}

/** A team-mate's hex a quick pass from the carrier, in the opponent's half (free of tackle zones is checked apart). */
function receiverHex(view: AiView, hex: Hex, carrier: Placed): boolean {
  const quick = view.config.ball.passBands[0]!.maxRange
  const d = distance(hex, carrier.hex)
  return d >= 1 && d <= quick && halfOf(hex) === TEAM_SIDES[otherTeam(carrier.team)]
}

/** One team's side of every feature. */
function teamFeatures(view: AiView, team: TeamId): Record<Feature, number> {
  const players = Object.values(view.players)
  const own = players.filter((p) => p.team === team)
  const enemies = players.filter((p) => p.team !== team)
  const onPitch = (p: Player): p is Player & { hex: Hex } => p.hex !== null
  const standing = (p: Player) => onPitch(p) && p.status === 'standing'

  const carrier = view.ball.carrier ? view.players[view.ball.carrier] : undefined
  const myCarrier = carrier?.team === team && carrier.hex ? (carrier as Placed) : null
  const threats = myCarrier ? threatsTo(view, myCarrier) : []
  const markedHere = (hex: Hex) => enemies.some((e) => exertsTackleZone(e) && distance(e.hex!, hex) === 1)

  let looseBallCloser = 0
  if (!view.ball.carrier && view.ball.hex) {
    const ballHex = view.ball.hex
    const nearest = (ps: Player[]) => Math.min(LOOSE_BALL_CAP, ...ps.filter(standing).map((p) => distance(p.hex!, ballHex)))
    // Only the side that is nearer counts it, so the two sides don't cancel twice.
    looseBallCloser = Math.max(0, nearest(enemies) - nearest(own))
  }

  const scoreFor = (t: TeamId) => view.teams[t].score
  const lead = scoreFor(team) - scoreFor(otherTeam(team))
  const totalRounds = view.config.match.halves * view.config.match.roundsPerHalf
  const roundsPlayed = (view.half - 1) * view.config.match.roundsPerHalf + view.round
  const matchOver = Math.min(1, Math.max(0, roundsPlayed / totalRounds))

  return {
    score: scoreFor(team),
    ball: myCarrier ? 1 : 0,
    carrierProgress: myCarrier ? LONGEST - distanceToScore(myCarrier.hex, team) : 0,
    carrierMarked: myCarrier ? enemies.filter((p) => exertsTackleZone(p) && distance(p.hex!, myCarrier.hex) === 1).length : 0,
    carrierThreats: myCarrier
      ? enemies.filter((p) => standing(p) && !p.activatedThisRound && distance(p.hex!, myCarrier.hex) - 1 <= p.ma).length
      : 0,
    carrierSupport: myCarrier ? own.filter((p) => p !== myCarrier && standing(p) && distance(p.hex!, myCarrier.hex) === 1).length : 0,
    carrierLane: myCarrier ? enemies.filter((e) => exertsTackleZone(e) && inLane(e.hex!, myCarrier)).length : 0,
    carrierScreen: myCarrier ? own.filter((p) => p !== myCarrier && exertsTackleZone(p) && screens(p.hex!, myCarrier, threats)).length : 0,
    receivers: myCarrier
      ? own.filter((p) => p !== myCarrier && standing(p) && receiverHex(view, p.hex!, myCarrier) && !markedHere(p.hex!)).length
      : 0,
    looseBallCloser,
    standing: own.filter(standing).length,
    down: own.filter((p) => onPitch(p) && (p.status === 'prone' || p.status === 'stunned')).length,
    out: own.filter((p) => p.status === 'out').length,
    injured: own.filter((p) => p.status === 'casualty' || p.status === 'ejected').length,
    markedOpponents: enemies.filter((e) => standing(e) && own.some((p) => exertsTackleZone(p) && distance(p.hex!, e.hex!) === 1)).length,
    leadLate: Math.max(0, lead) * matchOver,
    momentum: view.teams[team].momentum,
    doubleActivation: view.doubleActivation?.team === team ? view.doubleActivation.left : 0,
  }
}

/**
 * What a plain move (no rolls) by a player not carrying the ball can change
 * in the evaluation, as a key. Such a player only counts through which
 * opponents he ends up next to (marking them, being marked, marking their
 * carrier), being next to his own carrier, how near he is to a loose ball,
 * whether Sprinting leaves him Winded (no tackle zone), and three facts about
 * his hex: whether it screens his carrier, is a receiver's hex for him, or is
 * in the opposing carrier's lane. Having moved, he's activated, so he is no
 * threat to their carrier wherever he goes. Two such moves with the same key
 * score the same, so a search can try one of them only. null for a move whose
 * score depends on more: the carrier's, or onto the ball.
 */
export function plainMoveKey(view: AiView, playerId: string, to: Hex, sprint: boolean): string | null {
  const player = view.players[playerId]
  if (!player || view.ball.carrier === playerId) return null
  const ball = view.ball.hex
  if (ball && !view.ball.carrier && ball.q === to.q && ball.r === to.r) return null
  const next = Object.values(view.players)
    .filter((p) => p.hex !== null && p.id !== playerId && distance(p.hex, to) === 1 && (p.team !== player.team || p.id === view.ball.carrier))
    .map((p) => p.id)
    .sort()
    .join(',')
  const looseBall = ball && !view.ball.carrier ? Math.min(LOOSE_BALL_CAP, distance(ball, to)) : -1
  const carrier = view.ball.carrier ? view.players[view.ball.carrier] : undefined
  const placed = carrier?.hex ? (carrier as Placed) : null
  const mine = placed?.team === player.team ? placed : null
  const theirs = placed && placed.team !== player.team ? placed : null
  const screen = mine && screens(to, mine, threatsTo(view, mine)) ? 1 : 0
  const receiver = mine && receiverHex(view, to, mine) ? 1 : 0
  const lane = theirs && inLane(to, theirs) ? 1 : 0
  return `${playerId}|${next}|${looseBall}|${sprint ? 1 : 0}|${screen}${receiver}${lane}`
}
