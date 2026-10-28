import { type GameEvent, type GameState, type Hex, type MatchFile, toColRow } from '@orcball/engine'
import { playerName } from './labels'

// Events in plain words for the log panel. Some events (each hex of a move,
// the ball's path) are left out to keep the log readable.

const at = (hex: Hex) => {
  const { col, row } = toColRow(hex)
  return `(${col}, ${row})`
}

function signed(total: number): string {
  return total === 0 ? '' : ` ${total > 0 ? '+' : '−'}${Math.abs(total)}`
}

export function describeEvent(event: GameEvent, state: GameState, file: MatchFile): string | null {
  const name = (id: string) => {
    const p = state.players[id]
    return p ? `${state.teams[p.team].name} ${playerName(file, p)}` : id
  }
  const team = (t: 'home' | 'away') => state.teams[t].name

  switch (event.type) {
    case 'coinTossChoice':
      return `${team(event.team)} won the toss and chose to ${event.choice === 'kick' ? 'kick off' : 'receive'}`
    case 'setupEnded':
      return `${team(event.team)} have set up`
    case 'kicked':
      return `${team(event.team)} kick off at ${at(event.hex)}`
    case 'touchback':
      return `Touchback: ${team(event.team)} choose who gets the ball`
    case 'ballGiven':
      return `${name(event.playerId)} gets the ball`
    case 'ballCaught':
      return `${name(event.playerId)} catches the ball`
    case 'ballSettled':
      return `The ball comes to rest at ${at(event.hex)}`
    case 'ballOut':
      return 'The ball goes out of bounds'
    case 'activated':
      return `${name(event.playerId)}: ${event.action === 'handOff' ? 'Hand-off' : event.action[0]!.toUpperCase() + event.action.slice(1)}`
    case 'activationEnded':
      return event.failed ? `${name(event.playerId)}'s activation ends in failure` : null
    case 'waited':
      return event.forced ? `${team(event.team)} have nobody left and Wait` : `${team(event.team)} Wait`
    case 'doubleActivationGained':
      return `${team(event.team)} get a double activation`
    case 'doubleActivationForfeited':
      return `${team(event.team)} give up their double activation`
    case 'momentumSpent':
      return `${team(event.team)} spend Momentum on ${event.use === 'reroll' ? 'a re-roll' : 'a double activation'}`
    case 'roundStarted':
      return `Round ${event.round}: ${team(event.firstGo)} go first`
    case 'roundEnded':
      return `End of round ${event.round}`
    case 'rolled': {
      const total = event.modifiers.reduce((s, m) => s + m.value, 0)
      return `${event.test} ${event.target}+${signed(total)}: rolled ${event.natural}, ${event.success ? 'success' : 'failed'}`
    }
    case 'disengaged':
      return `${name(event.playerId)} disengages to ${at(event.to)}`
    case 'catchDeclined':
      return `${name(event.playerId)} lets the ball bounce`
    case 'stoodUp':
      return `${name(event.playerId)} stands up`
    case 'winded':
      return `${name(event.playerId)} sprints and is Winded`
    case 'blockDeclared':
      return `${name(event.attackerId)} blocks ${name(event.defenderId)}: ${event.attack} against ${event.defence}`
    case 'blockChosen':
      return `${name(event.attackerId)} goes for a ${event.choice === 'tackle' ? 'Tackle' : 'Shove'}`
    case 'pushed':
      return event.to ? `${name(event.playerId)} is pushed to ${at(event.to)}` : `${name(event.playerId)} is pushed into the crowd`
    case 'followedUp':
      return `${name(event.playerId)} follows up`
    case 'knockedDown':
      return `${name(event.playerId)} is knocked down`
    case 'armourRolled': {
      const total = event.modifiers.reduce((s, m) => s + m.value, 0)
      return `Armour: red ${event.red}${signed(total)}, ${event.broken ? 'broken' : 'holds'}${event.broken ? `, white ${event.white}` : ''}`
    }
    case 'injuryRolled':
      return `Crowd: white ${event.white}`
    case 'injured':
      return `${name(event.playerId)} is ${event.result === 'casualty' ? 'a Casualty' : event.result === 'out' ? 'Out for the drive' : 'Stunned'}`
    case 'toReserves':
      return `${name(event.playerId)} goes to the reserves`
    case 'turnedFaceUp':
      return `${name(event.playerId)} turns face up`
    case 'fouled':
      return `${name(event.playerId)} fouls ${name(event.targetId)}`
    case 'ejected':
      return `${name(event.playerId)} is sent off`
    case 'pickedUp':
      return `${name(event.playerId)} picks up the ball`
    case 'passed':
      return `${name(event.playerId)} passes to ${at(event.target)}`
    case 'fumbled':
      return `${name(event.playerId)} fumbles`
    case 'intercepted':
      return `${name(event.playerId)} intercepts!`
    case 'handedOff':
      return `${name(event.playerId)} hands off to ${name(event.toId)}`
    case 'touchdown':
      return `TOUCHDOWN for ${team(event.team)}! (${name(event.playerId)})`
    case 'halfEnded':
      return event.half === 1 ? 'Half time' : null
    case 'matchEnded':
      return `Full time: ${team('home')} ${event.score.home} – ${event.score.away} ${team('away')}`
    default:
      return null
  }
}
