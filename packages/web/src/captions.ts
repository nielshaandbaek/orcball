import { type ActionType, type Command, type GameEvent, type GameState, type Hex, hexEquals, type MatchFile, type TeamId, toColRow } from '@orcball/engine'
import { ACTION_NAMES, playerName } from './labels'

// Saying what's happening (#126), worked out per command from the state
// before it, its events and the state after:
// - a caption by the acting player: the action and its target, then the
//   Shove or Tackle at the block;
// - roll results flashed by the player they happened to;
// - centre banners for the big moments, and for the computer's Wait.

/** Who or where an action is aimed at. */
export type CaptionTarget = { playerId: string } | { hex: Hex }
export type Caption = { playerId: string; action: ActionType; target: CaptionTarget | null; block: string | null }
export type Flash = { playerId: string; text: string; hex: Hex }
export type Notice = { title: string; sub: string; team: TeamId }

/** How long a result shows, and a centre banner. */
export const FLASH_MS = 1_400
/** How long the computer holds after starting an activation, so its caption can be read first. */
export const ACTIVATION_HOLD_MS = 1_000

/**
 * The caption after a command: a new one when a player activates (with the
 * computer's target, which it knows from its plan), the target filled in when
 * it's chosen, the Shove or Tackle at the block, gone when the activation is over.
 */
export function nextCaption(
  caption: Caption | null,
  before: GameState,
  command: Command,
  events: readonly GameEvent[],
  after: GameState,
  computerTarget: CaptionTarget | null = null,
): Caption | null {
  let next = caption
  for (const e of events) {
    if (e.type === 'activated') next = { playerId: e.playerId, action: e.action, target: computerTarget, block: null }
    if (!next) continue
    if (e.type === 'blockDeclared' && e.attackerId === next.playerId) next = { ...next, target: { playerId: e.defenderId } }
    if (e.type === 'handedOff' && e.playerId === next.playerId) next = { ...next, target: { playerId: e.toId } }
    if (e.type === 'fouled' && e.playerId === next.playerId) next = { ...next, target: { playerId: e.targetId } }
    if (e.type === 'passed' && e.playerId === next.playerId) next = { ...next, target: { hex: e.target } }
    if (e.type === 'blockChosen' && e.attackerId === next.playerId) {
      const label = before.pending?.choices.find((c) => c.id === e.choice)?.label
      next = { ...next, block: e.choice === 'tackle' ? (label ?? 'Tackle') : 'Shove' }
    }
  }
  if (command.type === 'endActivation' || command.type === 'cancelActivation') return null
  // A Blitz moves on after its block: the caption goes back to the Blitz.
  if (next && after.activation?.playerId === next.playerId && next.block && !after.pending && command.type !== 'decide') next = { ...next, block: null }
  return after.activation?.playerId === next?.playerId ? next : null
}

/** The caption's words: "Blitz → Catcher 1", then "Tackle (70%)" at the block. */
export function captionText(caption: Caption, game: GameState, file: MatchFile): string {
  if (caption.block) return caption.block
  const action = ACTION_NAMES[caption.action]
  if (!caption.target) return action
  if ('playerId' in caption.target) {
    const target = game.players[caption.target.playerId]
    return target ? `${action} → ${playerName(file, target)}` : action
  }
  const hex = caption.target.hex
  const there = Object.values(game.players).find((p) => p.hex && hexEquals(p.hex, hex))
  const { col, row } = toColRow(hex)
  return `${action} → ${there ? playerName(file, there) : `(${col}, ${row})`}`
}

const ROLL_RESULTS: Record<string, [string, string]> = {
  Dodge: ['Dodge ✓', 'Dodge ✗'],
  'Pick-up': ['Picked up', 'Pick-up ✗'],
  Pass: ['Pass ✓', 'Pass ✗'],
  Tackle: ['Tackle ✓', 'Missed'],
}

/** A failed roll that waits on a Momentum re-roll hasn't failed yet. */
const rerollOffered = (after: GameState) => (after.pending?.data as { failed?: unknown } | null | undefined)?.failed !== undefined

/** Results to flash by the players they happened to: rolls, catches, knock-downs. */
export function flashesOf(before: GameState, events: readonly GameEvent[], after: GameState): Flash[] {
  const found = new Map<string, string>()
  const actor = before.activation?.playerId ?? null
  for (const e of events) {
    if (e.type === 'rolled' && actor && ROLL_RESULTS[e.test] && (e.success || !rerollOffered(after))) {
      found.set(actor, ROLL_RESULTS[e.test]![e.success ? 0 : 1])
    }
    if (e.type === 'ballCaught') found.set(e.playerId, 'Caught')
    if (e.type === 'fumbled') found.set(e.playerId, 'Fumble!')
    if (e.type === 'knockedDown') found.set(e.playerId, 'Down!')
  }
  return [...found].flatMap(([playerId, text]) => {
    const hex = after.players[playerId]?.hex ?? before.players[playerId]?.hex
    return hex ? [{ playerId, text, hex }] : []
  })
}

/**
 * A centre banner for the big moments: a touchdown, a casualty, an
 * interception, a double activation gained after a failure, and the
 * computer's Wait (easy to miss when zoomed in on the pitch). One at a time,
 * the biggest.
 */
export function noticeOf(events: readonly GameEvent[], after: GameState, file: MatchFile, computerTeam: TeamId | null): Notice | null {
  const name = (id: string) => {
    const p = after.players[id]!
    return `${after.teams[p.team].name} ${playerName(file, p)}`
  }
  const notices: [number, Notice][] = []
  for (const e of events) {
    if (e.type === 'touchdown') notices.push([5, { title: 'Touchdown!', sub: `${name(e.playerId)} scores`, team: e.team }])
    if (e.type === 'injured' && e.result === 'casualty') {
      notices.push([4, { title: 'Casualty!', sub: `${name(e.playerId)} is out for the match`, team: after.players[e.playerId]!.team }])
    }
    if (e.type === 'intercepted') notices.push([3, { title: 'Intercepted!', sub: `by ${name(e.playerId)}`, team: after.players[e.playerId]!.team }])
    if (e.type === 'doubleActivationGained' && e.source === 'failure') {
      notices.push([2, { title: 'Double activation', sub: `${after.teams[e.team].name} activate two players in a row`, team: e.team }])
    }
    if (e.type === 'waited' && !e.forced && e.team === computerTeam) notices.push([1, { title: `${after.teams[e.team].name} wait`, sub: 'Keeping their players for later in the round', team: e.team }])
  }
  return notices.sort((a, b) => b[0] - a[0])[0]?.[1] ?? null
}
