import { type GameEvent, type Hex, hexEquals } from '@orcball/engine'

// The ball's way through the hexes in one command (#161): bounces, scatters,
// a kick-off's drift and throw-ins, one `ballMoved` per hex. The board shows
// the ball in each in turn, at the pace a player walks, before it comes to
// rest; a pass in flight isn't a ballMoved, so it isn't stepped.

/** Every hex the ball passes through in these events, where it started first; empty if it didn't move. */
export function ballSteps(events: readonly GameEvent[]): Hex[] {
  const hexes: Hex[] = []
  for (const e of events) {
    if (e.type !== 'ballMoved') continue
    // A throw-in starts again from the hex the ball went out from, where it already is.
    if (hexes.length === 0 || !hexEquals(hexes.at(-1)!, e.from)) hexes.push(e.from)
    hexes.push(e.to)
  }
  return hexes
}
