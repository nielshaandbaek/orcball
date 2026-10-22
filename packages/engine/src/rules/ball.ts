import { type Modifier, rollD6 } from '../dice'
import type { RuleContext, RuleModule } from '../engine'
import { type Direction, halfOf, type Hex, hexEquals, isHalfwayHex, neighbour, onPitch } from '../hex'
import { type BallMove, type GameState, otherTeam, type PendingDecision, type Player, TEAM_SIDES, type TeamId } from '../state'
import { offerReroll, resolveReroll } from './momentum'
import { endActivation, startDriveRound } from './round'
import { enemyTackleZones } from './zones'

// Ball physics (RULES.md §7): the ball moving on its own.
//
// - Scatter: 1 hex in a random D6 direction, as many times as the caller says.
// - Bounce: the same, once.
// - Landing: a standing player there tries to catch; otherwise the ball
//   bounces once. After a bounce it just settles.
// - Catch: AG at −1 per enemy tackle zone. Only an accurate pass or hand-off
//   to an unmarked player is automatic. A failed catch bounces from the
//   catcher, and can be re-rolled with Momentum.
// - Throw-in: when the ball leaves the pitch, it comes back from the last hex
//   it was in: a D6 direction (re-rolling any that point straight off) and
//   2D6 hexes. It then lands as above.
//
// Two readings where RULES.md only spells it out for kick-offs: a ball that
// lands on an empty hex after a scatter or throw-in bounces once, and a ball
// that lands or bounces onto a prone or stunned player bounces on.
//
// A catch re-roll pauses the chain, so the chain's state travels in the
// pending decision and picks up where it left off once the coach answers.

/** What happens once the ball comes to rest or is caught. Other rules add kinds as they need them. */
export type BallFollowUp =
  | { kind: 'none' }
  /** End the activation, as failed if `failed` or if the active team dropped a catch on the way. */
  | { kind: 'endActivation'; failed: boolean }
  /** End the activation as failed only if the active team dropped a catch on the way. */
  | { kind: 'endActivationIfDropped' }
  /** A kick-off: touchback if the ball goes out or ends outside the receiver's half; otherwise round 1 starts. */
  | { kind: 'kickOff' }
  /** Ask a decision once the ball is at rest, e.g. whether to follow up after a block. */
  | { kind: 'ask'; decision: PendingDecision }

type Chain = {
  then: BallFollowUp
  /** The team whose activation is under way, if any, when the chain started. */
  activeTeam: TeamId | null
  /** True once a player of the active team has failed a catch. */
  activeTeamDropped: boolean
}

function newChain(state: GameState, then: BallFollowUp): Chain {
  const activeTeam = state.activation ? state.players[state.activation.playerId]!.team : null
  return { then, activeTeam, activeTeamDropped: false }
}

function playerAt(state: GameState, hex: Hex): Player | null {
  return Object.values(state.players).find((p) => p.hex !== null && hexEquals(p.hex, hex)) ?? null
}

function placeBall(state: GameState, hex: Hex): void {
  state.ball = { hex, carrier: null }
}

function d6(ctx: RuleContext): number {
  const roll = rollD6(ctx.state.rng)
  ctx.state.rng = roll.rng
  return roll.value
}

const randomDirection = (ctx: RuleContext) => d6(ctx) as Direction

/** Move the ball one hex at a time; returns where it stopped, or the last hex on the pitch if it went off. */
function travel(ctx: RuleContext, from: Hex, direction: Direction, hexes: number, how: BallMove): { at: Hex; out: boolean } {
  let at = from
  for (let i = 0; i < hexes; i++) {
    const next = neighbour(at, direction)
    if (!onPitch(next)) {
      ctx.emit({ type: 'ballOut', lastHex: at })
      return { at, out: true }
    }
    ctx.emit({ type: 'ballMoved', from: at, to: next, how })
    at = next
    placeBall(ctx.state, at)
  }
  return { at, out: false }
}

function catchModifiers(state: GameState, player: Player): Modifier[] {
  const zones = enemyTackleZones(state, player.hex!, player.team)
  if (zones === 0) return []
  return [{ name: `${zones} tackle zone${zones > 1 ? 's' : ''}`, value: zones * state.config.ball.catchModifierPerTackleZone }]
}

function finish(ctx: RuleContext, chain: Chain): void {
  const { then } = chain
  if (then.kind === 'none') return
  if (then.kind === 'kickOff') return finishKickOff(ctx)
  if (then.kind === 'ask') {
    // A drop by the active team on the way still ends the activation.
    if (chain.activeTeamDropped && ctx.state.activation) return endActivation(ctx, { failed: true })
    return ctx.ask(then.decision)
  }
  if (!ctx.state.activation) return
  if (then.kind === 'endActivation') endActivation(ctx, { failed: then.failed || chain.activeTeamDropped })
  else if (chain.activeTeamDropped) endActivation(ctx, { failed: true })
}

/** Run a follow-up straight away, for a rule whose ball didn't need to move. */
export function runFollowUp(ctx: RuleContext, then: BallFollowUp): void {
  finish(ctx, newChain(ctx.state, then))
}

function settle(ctx: RuleContext, hex: Hex, chain: Chain): void {
  placeBall(ctx.state, hex)
  ctx.emit({ type: 'ballSettled', hex })
  finish(ctx, chain)
}

function caught(ctx: RuleContext, player: Player, chain: Chain): void {
  ctx.state.ball = { hex: player.hex, carrier: player.id }
  ctx.emit({ type: 'ballCaught', playerId: player.id })
  finish(ctx, chain)
}

function dropped(ctx: RuleContext, player: Player, chain: Chain): void {
  if (player.team === chain.activeTeam) chain.activeTeamDropped = true
  bounce(ctx, player.hex!, chain)
}

/** A catch attempt. An accurate pass or hand-off to an unmarked player is automatic. */
function attemptCatch(ctx: RuleContext, player: Player, chain: Chain, { accurate }: { accurate: boolean }): void {
  const modifiers = catchModifiers(ctx.state, player)
  if (accurate && modifiers.length === 0) return caught(ctx, player, chain)
  const event = ctx.test('Catch', player.ag, modifiers)
  if (event.success) return caught(ctx, player, chain)
  if (!offerReroll(ctx, { kind: 'ball.catch', team: player.team, failed: event, data: { playerId: player.id, chain } })) {
    dropped(ctx, player, chain)
  }
}

function bounce(ctx: RuleContext, from: Hex, chain: Chain): void {
  const result = travel(ctx, from, randomDirection(ctx), ctx.state.config.ball.bounceDistance, 'bounce')
  if (result.out) return chain.then.kind === 'kickOff' ? touchback(ctx) : throwInFrom(ctx, result.at, chain)
  const player = playerAt(ctx.state, result.at)
  if (!player) return settle(ctx, result.at, chain)
  if (player.status === 'standing') return attemptCatch(ctx, player, chain, { accurate: false })
  bounce(ctx, result.at, chain)
}

/** The ball comes down in a hex after a kick, scatter, throw-in or pass. */
function land(ctx: RuleContext, at: Hex, chain: Chain, { accurate }: { accurate: boolean }): void {
  placeBall(ctx.state, at)
  const player = playerAt(ctx.state, at)
  if (player?.status === 'standing') return attemptCatch(ctx, player, chain, { accurate })
  bounce(ctx, at, chain)
}

function throwInFrom(ctx: RuleContext, lastHex: Hex, chain: Chain): void {
  let direction = randomDirection(ctx)
  while (!onPitch(neighbour(lastHex, direction))) direction = randomDirection(ctx)
  let distance = 0
  for (let i = 0; i < ctx.state.config.ball.throwInDistanceDice; i++) distance += d6(ctx)
  const result = travel(ctx, lastHex, direction, distance, 'throwIn')
  if (result.out) return throwInFrom(ctx, result.at, chain)
  land(ctx, result.at, chain, { accurate: false })
}

function inReceiversHalf(state: GameState, hex: Hex): boolean {
  return halfOf(hex) === TEAM_SIDES[otherTeam(state.kickingTeam)]
}

function finishKickOff(ctx: RuleContext): void {
  const { ball } = ctx.state
  const hex = ball.carrier ? ctx.state.players[ball.carrier]!.hex : ball.hex
  if (!hex || !inReceiversHalf(ctx.state, hex)) return touchback(ctx)
  startDriveRound(ctx)
}

/** The kick went wrong: the receiving coach gives the ball to one of their players. */
function touchback(ctx: RuleContext): void {
  const { state } = ctx
  const team = otherTeam(state.kickingTeam)
  state.ball = { hex: null, carrier: null }
  ctx.emit({ type: 'touchback', team })
  const players = Object.values(state.players).filter((p) => p.team === team && p.hex !== null && p.status === 'standing')
  ctx.ask({
    kind: 'kickOff.touchback',
    team,
    prompt: 'Touchback: give the ball to one of your players',
    choices: players.map((p) => ({ id: p.id, label: p.id, hex: p.hex! })),
    data: null,
  })
}

/**
 * Kick off at a hex in the receiver's half: the ball deviates a D6 direction
 * by D6 hexes, flying over anyone on the way, then lands. Landing on a
 * halfway hex or off the pitch is a touchback straight away; anything else
 * is checked once the ball is at rest.
 */
export function kickBall(ctx: RuleContext, target: Hex): void {
  const chain = newChain(ctx.state, { kind: 'kickOff' })
  placeBall(ctx.state, target)
  const direction = randomDirection(ctx)
  let distance = 0
  for (let i = 0; i < ctx.state.config.kickOff.scatterDistanceDice; i++) distance += d6(ctx)
  const result = travel(ctx, target, direction, distance, 'kick')
  if (result.out || isHalfwayHex(result.at)) return touchback(ctx)
  land(ctx, result.at, chain, { accurate: false })
}

/** Scatter the ball from a hex, one random hex at a time, then let it land. */
export function scatterBall(ctx: RuleContext, from: Hex, times: number, then: BallFollowUp): void {
  const chain = newChain(ctx.state, then)
  let at = from
  placeBall(ctx.state, at)
  for (let i = 0; i < times; i++) {
    const result = travel(ctx, at, randomDirection(ctx), 1, 'scatter')
    if (result.out) return throwInFrom(ctx, result.at, chain)
    at = result.at
  }
  land(ctx, at, chain, { accurate: false })
}

/** Bounce the ball once from a hex: a dropped ball, a failed pick-up, a fumble. */
export function bounceBall(ctx: RuleContext, from: Hex, then: BallFollowUp): void {
  placeBall(ctx.state, from)
  bounce(ctx, from, newChain(ctx.state, then))
}

/**
 * The ball arrives in a hex from a kick or a pass. `accurate` for a pass or
 * hand-off that hit its target; a kick is never accurate.
 */
export function ballArrives(ctx: RuleContext, at: Hex, then: BallFollowUp, { accurate }: { accurate: boolean }): void {
  land(ctx, at, newChain(ctx.state, then), { accurate })
}

/** The ball went off the pitch from `lastHex`: throw it back in. */
export function throwIn(ctx: RuleContext, lastHex: Hex, then: BallFollowUp): void {
  throwInFrom(ctx, lastHex, newChain(ctx.state, then))
}

export const ball: RuleModule = {
  name: 'ball',

  decisions: {
    'ball.catch'(ctx, pending, choice) {
      const { event, data } = resolveReroll(ctx, pending, choice)
      const { playerId, chain } = data as { playerId: string; chain: Chain }
      const player = ctx.state.players[playerId]!
      if (event.success) caught(ctx, player, chain)
      else dropped(ctx, player, chain)
    },
  },
}
