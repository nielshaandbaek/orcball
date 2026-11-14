import type { RuleContext, RuleModule } from '../engine'
import { allPitchHexes, endZoneOf, type Hex, hexEquals, hexKey } from '../hex'
import { type ActionType, type CommandOption, type GameState, matchRound, otherTeam, type Player, TEAM_SIDES, type TeamId } from '../state'
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
//
// From v16 (noEmptyActivation, #103) an activation can't end before the player
// has done something, so activating a player and ending at once can't keep the
// round from ending on two Waits; and Waiting instead of the second activation
// of a double counts as a Wait. Until the player has done something his coach
// may cancel the activation instead (cancelBeforeActing, #121): the player
// hasn't activated, a once-per-round action is free again, and the go and any
// double activation are as they were.

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

/**
 * True while the active player hasn't done anything yet: no step, no standing
 * up and no block. (Turning face up, a pass, hand-off or foul end the
 * activation, so they never leave one open.)
 */
export function activationIsEmpty(state: GameState): boolean {
  const a = state.activation
  return a !== null && !a.moved && !a.blocked && a.maUsed === 0
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
  if (action === 'block' && player.status !== 'standing' && state.config.blocking.blockNeedsStanding === true) {
    return { command, available: false, reason: 'Only a standing player can Block; a player who is down can Blitz instead' }
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
  askReturn(ctx)
}

// Out players back after a few rounds (v21, #177): at the start of the round
// injury.outReturnsAfterRounds after the one a player went off the pitch in
// (Out, or Stunned in the crowd), his coach places him on an empty hex of his
// own end zone, the team with the first go first. With no empty hex there he
// waits another round. A kick-off before then brings him back as before.

/** Players due back this round, the team with the first go first. */
function dueBack(state: GameState): Player[] {
  const after = state.config.injury.outReturnsAfterRounds
  if (after === undefined) return []
  const now = matchRound(state)
  const due = Object.values(state.players).filter((p) => p.hex === null && p.offInRound !== undefined && now - p.offInRound >= after)
  return [...due.filter((p) => p.team === state.firstGo), ...due.filter((p) => p.team !== state.firstGo)]
}

/** The empty hexes of a team's own end zone, without the ball. */
function returnHexes(state: GameState, team: TeamId): Hex[] {
  const taken = Object.values(state.players).flatMap((p) => (p.hex ? [p.hex] : []))
  return allPitchHexes().filter(
    (h) => endZoneOf(h) === TEAM_SIDES[team] && !taken.some((t) => hexEquals(t, h)) && !(state.ball.hex && hexEquals(state.ball.hex, h)),
  )
}

/** Ask for the next returning player's hex, or with none left, give the first go. */
function askReturn(ctx: RuleContext): void {
  const { state } = ctx
  for (const player of dueBack(state)) {
    const hexes = returnHexes(state, player.team)
    if (hexes.length === 0) continue
    ctx.ask({
      kind: 'round.returnPlayer',
      team: player.team,
      prompt: 'Back from the reserves: tap a hex in your end zone.',
      choices: hexes.map((h) => ({ id: hexKey(h), label: 'Here', hex: h })),
      data: { playerId: player.id },
    })
    return
  }
  giveGoTo(ctx, state.firstGo)
}

export const round: RuleModule = {
  name: 'round',

  decisions: {
    'round.returnPlayer'(ctx, pending, choice) {
      const player = ctx.state.players[(pending.data as { playerId: string }).playerId]!
      player.hex = choice.hex!
      player.status = 'standing'
      player.winded = false
      delete player.offInRound
      ctx.emit({ type: 'playerReturned', playerId: player.id, hex: choice.hex! })
      askReturn(ctx)
    },
  },

  options(state) {
    if (state.phase === 'Activation' && state.activation && state.pending === null) {
      const { noEmptyActivation, cancelBeforeActing } = state.config.activations
      const empty = activationIsEmpty(state)
      const options: CommandOption[] = []
      if (empty && noEmptyActivation) {
        const reason = cancelBeforeActing ? 'The player hasn’t done anything yet: act, or Cancel' : 'The player hasn’t done anything yet'
        options.push({ command: { type: 'endActivation' }, available: false, reason })
      } else options.push({ command: { type: 'endActivation' }, available: true })
      if (empty && cancelBeforeActing) options.push({ command: { type: 'cancelActivation' }, available: true })
      return options
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
      const windedBefore = state.players[playerId]!.winded
      state.players[playerId]!.winded = false
      state.activation = { playerId, action, maUsed: 0, stopped: false, moved: false, freeLeave: null, blocked: false }
      if (windedBefore && state.config.activations.cancelBeforeActing) state.activation.windedBefore = true
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
      if (double?.team === team && double.left < 2 && !state.config.activations.noEmptyActivation) {
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

    cancelActivation(ctx) {
      const { state } = ctx
      const activation = state.activation!
      const player = state.players[activation.playerId]!
      const limit = LIMITED[activation.action]
      if (limit) state.teams[player.team].usedThisRound[limit]--
      if (activation.windedBefore) player.winded = true
      state.activation = null
      state.phase = 'Round'
      ctx.emit({ type: 'activationCancelled', playerId: player.id })
      ctx.emit({ type: 'phaseChanged', from: 'Activation', to: 'Round' })
    },
  },
}
