import type { RuleModule } from '../engine'
import { allPitchHexes, halfOf, type Hex, hexEquals, isHalfwayHex, wideZoneOf } from '../hex'
import { type CommandOption, type GameState, otherTeam, type Player, TEAM_SIDES, type TeamId } from '../state'
import { kickBall } from './ball'
import { startDriveRound } from './round'

// Setup and kick-off (RULES.md §2).
//
// The coin toss winner chooses to kick off or receive in the first half; the
// other team kicks off the second. Each drive the kicking team sets up first,
// then the receiving team, each in its own half: never on a halfway hex, at
// most one player per wide zone, and at most 7 on the pitch. The kicking coach
// then kicks at any hex in the receiver's half. The flight and touchbacks are
// in ball.ts.
//
// RULES.md says "up to 7", so a team may set up with fewer, but needs at
// least one player on the pitch to finish.

/** Players who can take the field: not Out or a Casualty. */
function available(player: Player): boolean {
  return player.status !== 'out' && player.status !== 'casualty'
}

function teamPlayers(state: GameState, team: TeamId): Player[] {
  return Object.values(state.players).filter((p) => p.team === team)
}

/** Why this player can't be set up on this hex, or null if they can. */
export function placementBlocked(state: GameState, player: Player, hex: Hex): string | null {
  if (isHalfwayHex(hex)) return "Halfway hexes can't be used at setup"
  if (halfOf(hex) !== TEAM_SIDES[player.team]) return 'Set up in your own half'
  const others = teamPlayers(state, player.team).filter((p) => p.id !== player.id && p.hex !== null)
  if (Object.values(state.players).some((p) => p.id !== player.id && p.hex && hexEquals(p.hex, hex))) {
    return 'There is already a player there'
  }
  const zone = wideZoneOf(hex)
  const max = state.config.setup.maxPlayersPerWideZone
  if (zone && others.filter((p) => wideZoneOf(p.hex!) === zone).length >= max) {
    return `At most ${max} player${max === 1 ? '' : 's'} per wide zone`
  }
  if (player.hex === null && others.length >= state.config.match.playersOnPitch) {
    return `Already ${state.config.match.playersOnPitch} players on the pitch`
  }
  return null
}

function setupOptions(state: GameState): CommandOption[] {
  const team = state.turnOwner
  const players = teamPlayers(state, team).filter(available)
  const pitch = allPitchHexes()
  const options: CommandOption[] = []
  for (const player of players) {
    for (const hex of pitch) {
      const command = { type: 'place', playerId: player.id, hex } as const
      if (player.hex && hexEquals(player.hex, hex)) continue
      const reason = placementBlocked(state, player, hex)
      options.push(reason ? { command, available: false, reason } : { command, available: true })
    }
    if (player.hex) options.push({ command: { type: 'unplace', playerId: player.id }, available: true })
  }
  const onPitch = players.filter((p) => p.hex !== null).length
  options.push(
    onPitch > 0
      ? { command: { type: 'endSetup' }, available: true }
      : { command: { type: 'endSetup' }, available: false, reason: 'Set up at least one player' },
  )
  return options
}

function kickOptions(state: GameState): CommandOption[] {
  const receivers = TEAM_SIDES[otherTeam(state.kickingTeam)]
  return allPitchHexes()
    .filter((hex) => halfOf(hex) === receivers)
    .map((hex) => ({ command: { type: 'kick', hex }, available: true }))
}

export const setup: RuleModule = {
  name: 'setup',

  options(state) {
    if (state.pending) return []
    if (state.phase === 'Setup') return setupOptions(state)
    if (state.phase === 'KickOff') return kickOptions(state)
    return []
  },

  commands: {
    place(ctx, { playerId, hex }) {
      ctx.state.players[playerId]!.hex = hex
      ctx.emit({ type: 'placed', playerId, hex })
    },

    unplace(ctx, { playerId }) {
      ctx.state.players[playerId]!.hex = null
      ctx.emit({ type: 'unplaced', playerId })
    },

    endSetup(ctx) {
      const { state } = ctx
      const team = state.turnOwner
      ctx.emit({ type: 'setupEnded', team })
      if (team === state.kickingTeam) {
        state.turnOwner = otherTeam(team)
        return
      }
      state.phase = 'KickOff'
      state.turnOwner = state.kickingTeam
      ctx.emit({ type: 'phaseChanged', from: 'Setup', to: 'KickOff' })
    },

    kick(ctx, { hex }) {
      ctx.emit({ type: 'kicked', team: ctx.state.kickingTeam, hex })
      kickBall(ctx, hex)
    },
  },

  decisions: {
    'setup.coinToss'(ctx, pending, choice) {
      const { state } = ctx
      const kicker = choice.id === 'kick' ? pending.team : otherTeam(pending.team)
      state.kickingTeam = kicker
      state.openingKicker = kicker
      state.turnOwner = kicker
      ctx.emit({ type: 'coinTossChoice', team: pending.team, choice: choice.id === 'kick' ? 'kick' : 'receive' })
    },

    'kickOff.touchback'(ctx, _pending, choice) {
      const player = ctx.state.players[choice.id]!
      ctx.state.ball = { hex: player.hex, carrier: player.id }
      ctx.emit({ type: 'ballGiven', playerId: player.id })
      startDriveRound(ctx)
    },
  },
}
