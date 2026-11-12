import { type Command, type GameEvent, type GameState, type Hex, hexEquals } from '@orcball/engine'

// Event icons (art/icons/events): a symbol shown over a player for a moment
// when something happens to him: POW! over a tackled defender, a skull over an
// attacker who rolled a natural 1, and so on. Worked out from one command:
// the state before it, its events and the state after, since the events alone
// don't always say who was acting (a Tackle's knock-down comes a decision or
// two after the Tackle itself).

export type EventIcon = 'pow' | 'skull' | 'both-down' | 'fumble' | 'shove' | 'stumble'
/** `hex` is where it happened: a player hurt badly enough leaves the pitch in the same command. */
export type EventIconAt = { playerId: string; icon: EventIcon; hex: Hex }

/** How long an event icon shows. */
export const EVENT_ICON_MS = 1_500

/** Where a player has more than one, the one that shows. */
const PRIORITY: readonly EventIcon[] = ['both-down', 'skull', 'pow', 'stumble', 'fumble', 'shove']

/** A failed roll that waits on a Momentum re-roll hasn't failed yet. */
function rerollOffered(after: GameState): boolean {
  return (after.pending?.data as { failed?: unknown } | null | undefined)?.failed !== undefined
}

export function eventIconsOf(before: GameState, command: Command, events: readonly GameEvent[], after: GameState): EventIconAt[] {
  const found = new Map<string, EventIcon>()
  const add = (playerId: string, icon: EventIcon) => {
    const now = found.get(playerId)
    if (!now || PRIORITY.indexOf(icon) < PRIORITY.indexOf(now)) found.set(playerId, icon)
  }
  const actor = before.activation?.playerId ?? null
  const rolled = (test: string) => events.filter((e): e is Extract<GameEvent, { type: 'rolled' }> => e.type === 'rolled' && e.test === test)
  const bothDown = events.some((e) => e.type === 'tackleMissChosen' && e.choice === 'bothDown')
  // A Tackle rolled now, or (#140) one rolled earlier whose Momentum re-roll the coach just turned down.
  const declined =
    command.type === 'decide' && command.choice !== 'reroll' && before.pending?.kind === 'blocking.tackle'
      ? (before.pending.data as { failed?: { natural: number } }).failed
      : undefined
  const naturalOne = rolled('Tackle').some((e) => e.natural === 1) || declined?.natural === 1

  events.forEach((e, i) => {
    if (e.type === 'knockedDown') {
      if (bothDown) add(e.playerId, 'both-down')
      else if (e.playerId !== actor) add(e.playerId, 'pow')
      else add(e.playerId, naturalOne ? 'skull' : 'stumble')
    }
    if (e.type === 'fumbled') add(e.playerId, 'fumble')
    if (e.type === 'rolled' && !e.success && !rerollOffered(after)) {
      // A dropped ball bounces from the catcher's hex; a pick-up is the mover's.
      if (e.test === 'Catch') {
        const bounce = events.slice(i + 1).find((b) => b.type === 'ballMoved')
        const catcher = bounce?.type === 'ballMoved' ? Object.values(after.players).find((p) => p.hex && hexEquals(p.hex, bounce.from)) : undefined
        if (catcher) add(catcher.id, 'fumble')
      }
      if (e.test === 'Pick-up' && actor) add(actor, 'fumble')
    }
  })

  // A Shove that moves the defender: he's pushed now, or the attacker picks where next.
  if (command.type === 'decide' && command.choice === 'shove' && before.pending?.kind === 'blocking.shoveOrTackle') {
    const pushes = events.some((e) => e.type === 'pushed') || after.pending?.kind === 'blocking.push'
    if (pushes) add((before.pending.data as { defenderId: string }).defenderId, 'shove')
  }
  // Where he is now, else where the command last pushed him, else where he was.
  const hexOf = (playerId: string): Hex | null => {
    const pushed = events.findLast((e) => e.type === 'pushed' && e.playerId === playerId && e.to !== null)
    return after.players[playerId]?.hex ?? (pushed?.type === 'pushed' ? pushed.to : null) ?? before.players[playerId]?.hex ?? null
  }
  return [...found].flatMap(([playerId, icon]) => {
    const hex = hexOf(playerId)
    return hex ? [{ playerId, icon, hex }] : []
  })
}
