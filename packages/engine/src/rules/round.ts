import type { RuleContext, RuleModule } from '../engine'
import { type ActionType, type CommandOption, type GameState, otherTeam, type Player, type TeamId } from '../state'
import { endHalf } from './drive'

// Rounds and activations (RULES.md §3).
//
// Coaches alternate goes. On a go a coach activates one player or Waits. Two
// Waits in a row end the round, and so does every player on the pitch having
// activated. A coach with nobody left to activate Waits automatically.
//
// A double activation lets a team activate up to two players on one go. It
// comes from the opponent failing a roll (or a fumble or interception), or
// from spending Momentum. Choices where RULES.md is silent:
// - Waiting at the start of the go forfeits the double; Waiting after the
//   first of the two ends the go without counting as a Wait, since the team
//   did activate someone.
// - A failure during your own double ends the go, forfeiting the rest.
// - A double that hasn't been used when the round ends is lost.

export const ACTIONS: readonly ActionType[] = ['move', 'block', 'blitz', 'pass', 'handOff', 'foul']

/** Actions each team may take only a limited number of times per round. */
const LIMITED: Partial<Record<ActionType, 'blitz' | 'pass' | 'handOff' | 'foul'>> = {
  blitz: 'blitz',
  pass: 'pass',
  handOff: 'handOff',
  foul: 'foul',
}

const ACTION_NAMES: Record<ActionType, string> = {
  move: 'Move',
  block: 'Block',
  blitz: 'Blitz',
  pass: 'Pass',
  handOff: 'Hand-off',
  foul: 'Foul',
}

/** Players on the pitch who haven't activated yet this round. */
export function playersLeft(state: GameState, team: TeamId): Player[] {
  return Object.values(state.players).filter((p) => p.team === team && p.hex !== null && !p.activatedThisRound)
}

/** True when the turn owner may start a go: an activation, a Wait or Momentum. */
export function atStartOfGo(state: GameState): boolean {
  return state.phase === 'Round' && state.activation === null && state.pending === null
}

function actionOption(state: GameState, player: Player, action: ActionType): CommandOption {
  const command = { type: 'activate', playerId: player.id, action } as const
  if (player.activatedThisRound) {
    return { command, available: false, reason: 'This player has already activated this round' }
  }
  const limit = LIMITED[action]
  if (limit) {
    const allowed = state.config.activations.perRoundPerTeam[limit]
    if (state.teams[player.team].usedThisRound[limit] >= allowed) {
      return { command, available: false, reason: `Your team has already used its ${ACTION_NAMES[action]} this round` }
    }
  }
  return { command, available: true }
}

/**
 * Start the first round of a drive: the receiving team goes first. The round
 * count carries on through the half, so after a touchdown the next drive
 * starts a new round. Called by the kick-off rules.
 */
export function startDriveRound(ctx: RuleContext): void {
  const { state } = ctx
  const from = state.phase
  state.phase = 'Round'
  if (from !== 'Round') ctx.emit({ type: 'phaseChanged', from, to: 'Round' })
  state.round++
  state.firstGo = otherTeam(state.kickingTeam)
  state.lastGoWasWait = false
  ctx.emit({ type: 'roundStarted', half: state.half, round: state.round, firstGo: state.firstGo })
  giveGoTo(ctx, state.firstGo)
}

/**
 * End the current activation. Rule modules call this when an activation-ending
 * condition happens; `failed` gives the opponent a double activation.
 */
export function endActivation(ctx: RuleContext, { failed }: { failed: boolean }): void {
  const { state } = ctx
  const activation = state.activation
  if (!activation) throw new Error('endActivation: no activation in progress')
  const player = state.players[activation.playerId]!
  const team = player.team

  player.activatedThisRound = true
  state.activation = null
  state.phase = 'Round'
  ctx.emit({ type: 'activationEnded', playerId: player.id, failed })
  ctx.emit({ type: 'phaseChanged', from: 'Activation', to: 'Round' })

  if (failed) {
    if (state.doubleActivation?.team === team) forfeitDouble(ctx)
    state.doubleActivation = { team: otherTeam(team), left: 2 }
    ctx.emit({ type: 'doubleActivationGained', team: otherTeam(team), source: 'failure' })
    passGo(ctx, { waited: false })
    return
  }

  const double = state.doubleActivation
  if (double?.team === team) {
    double.left--
    if (double.left > 0 && playersLeft(state, team).length > 0) {
      // Same team goes again.
      state.lastGoWasWait = false
      return
    }
    state.doubleActivation = null
  }
  passGo(ctx, { waited: false })
}

function forfeitDouble(ctx: RuleContext): void {
  const double = ctx.state.doubleActivation
  if (!double) return
  ctx.state.doubleActivation = null
  ctx.emit({ type: 'doubleActivationForfeited', team: double.team })
}

/** Hand the go to the other team, or end the round. */
function passGo(ctx: RuleContext, { waited }: { waited: boolean }): void {
  const { state } = ctx
  if (waited && state.lastGoWasWait) {
    endRound(ctx)
    return
  }
  state.lastGoWasWait = waited
  if (playersLeft(state, 'home').length === 0 && playersLeft(state, 'away').length === 0) {
    endRound(ctx)
    return
  }
  giveGoTo(ctx, otherTeam(state.turnOwner))
}

/** Give a team its go. With nobody left to activate, it Waits automatically. */
function giveGoTo(ctx: RuleContext, team: TeamId): void {
  const { state } = ctx
  state.turnOwner = team
  if (playersLeft(state, team).length > 0) return
  ctx.emit({ type: 'waited', team, forced: true })
  if (state.doubleActivation?.team === team) forfeitDouble(ctx)
  passGo(ctx, { waited: true })
}

function endRound(ctx: RuleContext): void {
  const { state } = ctx
  forfeitDouble(ctx)
  ctx.emit({ type: 'roundEnded', half: state.half, round: state.round })
  for (const player of Object.values(state.players)) player.activatedThisRound = false
  for (const team of Object.values(state.teams)) {
    team.usedThisRound = { blitz: 0, pass: 0, handOff: 0, foul: 0 }
    team.momentumUsedThisRound = false
  }
  state.lastGoWasWait = false

  if (state.round >= state.config.match.roundsPerHalf) return endHalf(ctx)

  state.round++
  state.firstGo = otherTeam(state.firstGo)
  ctx.emit({ type: 'roundStarted', half: state.half, round: state.round, firstGo: state.firstGo })
  giveGoTo(ctx, state.firstGo)
}

export const round: RuleModule = {
  name: 'round',

  options(state) {
    if (state.phase === 'Activation' && state.activation && state.pending === null) {
      return [{ command: { type: 'endActivation' }, available: true }]
    }
    if (!atStartOfGo(state)) return []
    const team = state.turnOwner
    const options: CommandOption[] = []
    for (const player of Object.values(state.players)) {
      if (player.team !== team || player.hex === null) continue
      // A stunned player's activation is only turning face up, so it's offered as a Move.
      if (player.activatedThisRound || player.status === 'stunned') options.push(actionOption(state, player, 'move'))
      else for (const action of ACTIONS) options.push(actionOption(state, player, action))
    }
    options.push({ command: { type: 'wait' }, available: true })
    return options
  },

  commands: {
    activate(ctx, { playerId, action }) {
      const { state } = ctx
      const limit = LIMITED[action]
      if (limit) state.teams[state.turnOwner].usedThisRound[limit]++
      // Winded lasts until the player's next activation (RULES.md §4).
      state.players[playerId]!.winded = false
      state.activation = { playerId, action, maUsed: 0, stopped: false, moved: false, freeLeave: null, blocked: false }
      state.phase = 'Activation'
      ctx.emit({ type: 'phaseChanged', from: 'Round', to: 'Activation' })
      ctx.emit({ type: 'activated', playerId, action })

      // A stunned player spends the activation turning face up (RULES.md §6).
      const player = state.players[playerId]!
      if (player.status === 'stunned') {
        player.status = 'prone'
        ctx.emit({ type: 'turnedFaceUp', playerId })
        endActivation(ctx, { failed: false })
      }
    },

    wait(ctx) {
      const { state } = ctx
      const team = state.turnOwner
      const double = state.doubleActivation
      if (double?.team === team && double.left < 2) {
        // Stopping after the first of a double: the go ends, but it isn't a Wait.
        forfeitDouble(ctx)
        passGo(ctx, { waited: false })
        return
      }
      if (double?.team === team) forfeitDouble(ctx)
      ctx.emit({ type: 'waited', team, forced: false })
      passGo(ctx, { waited: true })
    },

    endActivation(ctx) {
      endActivation(ctx, { failed: false })
    },
  },
}
