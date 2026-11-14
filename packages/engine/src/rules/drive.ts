import type { RuleContext, RuleModule } from '../engine'
import { endZoneOf } from '../hex'
import { type GameState, otherTeam, type Player, TEAM_SIDES, TEAMS, type TeamId } from '../state'

// Drives, touchdowns, half time and full time (RULES.md §3 "Touchdowns" and §11).
//
// A standing player holding the ball in the opponent's end zone scores, at
// whatever point that happens: running in, catching, picking up, or being
// pushed in. That ends the activation, the round and the drive. Everyone
// leaves the pitch, Out players are available again, and the scoring team
// kicks off the next drive. The round count carries on through the half, so
// a touchdown in the last round of a half ends the half.
//
// After the last round of the first half the teams reset the same way, each
// gets a fresh half of Momentum, and the team that received first kicks off.
// After the second half, full time: most touchdowns wins, and a draw stays a
// draw (no overtime in the MVP).

function scorer(state: GameState): Player | null {
  const carrierId = state.ball.carrier
  if (!carrierId) return null
  const player = state.players[carrierId]!
  if (player.status !== 'standing' || !player.hex) return null
  const scoresIn = TEAM_SIDES[otherTeam(player.team)]
  return endZoneOf(player.hex) === scoresIn ? player : null
}

/** Clear the pitch for a new setup: Out players come back, Casualties and ejections don't. */
function clearPitch(state: GameState): void {
  for (const player of Object.values(state.players)) {
    player.hex = null
    player.winded = false
    player.activatedThisRound = false
    if (player.status === 'prone' || player.status === 'stunned' || player.status === 'out') player.status = 'standing'
    delete player.offInRound
  }
  for (const team of Object.values(state.teams)) {
    team.usedThisRound = { blitz: 0, pass: 0, handOff: 0, foul: 0 }
    team.momentumUsedThisRound = false
  }
  state.ball = { hex: null, carrier: null }
  state.activation = null
  state.doubleActivation = null
  state.lastGoWasWait = false
}

function startSetup(ctx: RuleContext, kickingTeam: TeamId): void {
  const { state } = ctx
  clearPitch(state)
  state.kickingTeam = kickingTeam
  state.turnOwner = kickingTeam
  ctx.emit({ type: 'driveEnded', kickingTeam })
  const from = state.phase
  state.phase = 'Setup'
  ctx.emit({ type: 'phaseChanged', from, to: 'Setup' })
}

/** The last round of a half is over: half time, or full time after the second half. */
export function endHalf(ctx: RuleContext): void {
  const { state } = ctx
  ctx.emit({ type: 'halfEnded', half: state.half })

  if (state.half >= state.config.match.halves) {
    const { home, away } = { home: state.teams.home.score, away: state.teams.away.score }
    state.winner = home > away ? 'home' : away > home ? 'away' : 'draw'
    clearPitch(state)
    ctx.emit({ type: 'phaseChanged', from: state.phase, to: 'FullTime' })
    state.phase = 'FullTime'
    ctx.emit({ type: 'matchEnded', score: { home, away }, winner: state.winner })
    return
  }

  ctx.emit({ type: 'phaseChanged', from: state.phase, to: 'HalfTime' })
  state.phase = 'HalfTime'
  state.half++
  state.round = 0
  for (const team of TEAMS) state.teams[team].momentum = state.config.momentum.perHalf
  startSetup(ctx, otherTeam(state.openingKicker ?? state.kickingTeam))
}

function scoreTouchdown(ctx: RuleContext, player: Player): void {
  const { state } = ctx
  state.teams[player.team].score++
  ctx.emit({ type: 'touchdown', playerId: player.id, team: player.team })
  if (state.activation) {
    ctx.emit({ type: 'activationEnded', playerId: state.activation.playerId, failed: false })
    state.players[state.activation.playerId]!.activatedThisRound = true
  }
  ctx.emit({ type: 'roundEnded', half: state.half, round: state.round })
  if (state.round >= state.config.match.roundsPerHalf) return endHalf(ctx)
  startSetup(ctx, player.team)
}

export const drive: RuleModule = {
  name: 'drive',

  afterCommand(ctx) {
    const { phase } = ctx.state
    if (phase !== 'Round' && phase !== 'Activation') return
    const player = scorer(ctx.state)
    if (player) scoreTouchdown(ctx, player)
  },
}
