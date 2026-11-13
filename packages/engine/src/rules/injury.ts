import { type Modifier, modifierTotal, rollD10 } from '../dice'
import type { RuleContext, RuleModule } from '../engine'
import { distance, type Hex, hexEquals } from '../hex'
import { type CommandOption, type GameState, type InjuryResult, matchRound, type Player } from '../state'
import { type BallFollowUp, bounceBall, runFollowUp, throwIn } from './ball'
import { countAssists } from './zones'

// Knock-downs, armour and injury, fouls (RULES.md §6 and §8).
//
// A knocked-down player is placed prone and the opponent throws the red armour
// die and the white injury die together. Red ≥ TO breaks the armour (natural 1
// always holds, natural 10 always breaks) and the white die is read:
// 1–7 Stunned, 8–9 Out, 10 Casualty; a natural 1 is always Stunned and a
// natural 10 always a Casualty. A ball carrier drops the ball, which bounces
// from where they went down.
//
// Stunned players lie face down; turning face up is their next activation
// (handled in round.ts). Out players leave the pitch for the drive, Casualties
// for the match.
//
// A player pushed into the crowd rolls only the white die. RULES.md doesn't
// say where a Stunned crowd-pushed player goes, since they're off the pitch:
// as in Blood Bowl, they go to the reserves and come back at the next kick-off.
//
// Fouls kick a prone or stunned opponent next to the fouler: the red die gets
// +1 per assist, minus the defender's assists. A natural 1 or 10 on the red
// die gets the fouler ejected, after the armour is resolved. The foul ends the
// activation.

function d10(ctx: RuleContext): number {
  const roll = rollD10(ctx.state.rng)
  ctx.state.rng = roll.rng
  return roll.value
}

export function injuryResult(state: GameState, white: number): InjuryResult {
  if (white === 1) return 'stunned'
  if (white === 10) return 'casualty'
  if (white <= state.config.injury.stunnedMax) return 'stunned'
  if (white <= state.config.injury.outMax) return 'out'
  return 'casualty'
}

function armourBreaks(red: number, modifiers: readonly Modifier[], to: number): boolean {
  if (red === 1) return false
  if (red === 10) return true
  return red + modifierTotal(modifiers) >= to
}

function applyInjury(ctx: RuleContext, player: Player, result: InjuryResult): void {
  ctx.emit({ type: 'injured', playerId: player.id, result })
  if (result === 'stunned') {
    player.status = 'stunned'
    return
  }
  player.status = result
  player.hex = null
  if (result === 'out') player.offInRound = matchRound(ctx.state)
}

/** Throw the red and white dice for a player who is down. Returns the red die for foul ejections. */
function armourAndInjury(ctx: RuleContext, player: Player, modifiers: Modifier[]): number {
  const red = d10(ctx)
  const white = d10(ctx)
  const broken = armourBreaks(red, modifiers, player.to)
  ctx.emit({ type: 'armourRolled', playerId: player.id, red, white, modifiers, broken })
  if (broken) applyInjury(ctx, player, injuryResult(ctx.state, white))
  return red
}

/**
 * Knock a player down: prone, armour and injury, and the ball bounces if they
 * had it or fell on it.
 * `then` runs once that's all settled, e.g. to end a failed activation.
 */
export function knockDown(ctx: RuleContext, playerId: string, then: BallFollowUp): void {
  const { state } = ctx
  const player = state.players[playerId]!
  const hex = player.hex!
  // A carrier drops the ball; a loose ball under someone falling on it bounces too.
  const ballHere = state.ball.carrier === playerId || (state.ball.carrier === null && state.ball.hex !== null && hexEquals(state.ball.hex, hex))
  player.status = 'prone'
  ctx.emit({ type: 'knockedDown', playerId })
  armourAndInjury(ctx, player, [])
  if (ballHere) bounceBall(ctx, hex, then)
  else runFollowUp(ctx, then)
}

/**
 * A player pushed off the pitch: only the white die. A carrier's ball is
 * thrown in from the hex they were pushed from.
 */
/** A player pushed into the crowd from `edge`, the last hex he stood on: injury, and a throw-in from there if he had the ball. */
export function pushedIntoCrowd(ctx: RuleContext, playerId: string, edge: Hex, then: BallFollowUp): void {
  const { state } = ctx
  const player = state.players[playerId]!
  const hadBall = state.ball.carrier === playerId
  const white = d10(ctx)
  ctx.emit({ type: 'injuryRolled', playerId, white })
  const result = injuryResult(state, white)
  if (result === 'stunned') {
    player.hex = null
    player.status = 'standing'
    player.offInRound = matchRound(state)
    ctx.emit({ type: 'toReserves', playerId })
  } else {
    applyInjury(ctx, player, result)
  }
  if (hadBall) throwIn(ctx, edge, then)
  else runFollowUp(ctx, then)
}

/** Prone or stunned opponents next to the fouler. */
function foulTargets(state: GameState, fouler: Player): Player[] {
  return Object.values(state.players).filter(
    (p) =>
      p.team !== fouler.team &&
      p.hex !== null &&
      (p.status === 'prone' || p.status === 'stunned') &&
      distance(p.hex, fouler.hex!) === 1,
  )
}

export function foulModifiers(state: GameState, fouler: Player, target: Player): Modifier[] {
  const net = countAssists(state, fouler, target) - countAssists(state, target, fouler)
  if (net === 0) return []
  return [{ name: 'Net assists', value: net * state.config.fouls.assistValue }]
}

export const injury: RuleModule = {
  name: 'injury',

  options(state) {
    if (state.phase !== 'Activation' || state.pending || state.activation?.action !== 'foul') return []
    const fouler = state.players[state.activation.playerId]!
    if (fouler.status !== 'standing' || !fouler.hex) return []
    return foulTargets(state, fouler).map((target): CommandOption => ({
      command: { type: 'foul', targetId: target.id },
      available: true,
    }))
  },

  commands: {
    foul(ctx, { targetId }) {
      const { state } = ctx
      const fouler = state.players[state.activation!.playerId]!
      const target = state.players[targetId]!
      ctx.emit({ type: 'fouled', playerId: fouler.id, targetId })
      const red = armourAndInjury(ctx, target, foulModifiers(state, fouler, target))
      const then: BallFollowUp = { kind: 'endActivation', failed: false }
      if (!state.config.fouls.ejectOnNaturals.includes(red)) return runFollowUp(ctx, then)
      const hex = fouler.hex!
      const hadBall = state.ball.carrier === fouler.id
      fouler.status = 'ejected'
      fouler.hex = null
      ctx.emit({ type: 'ejected', playerId: fouler.id })
      // A fouler holding the ball drops it where they stood.
      if (hadBall) bounceBall(ctx, hex, then)
      else runFollowUp(ctx, then)
    },
  },
}
