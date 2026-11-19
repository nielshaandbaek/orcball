import { distance, fromColRow, type GameEvent, type GameState, type Hex, neighbours, onPitch, TEAM_SIDES } from '@orcball/engine'
import { hexCenter, tokenCenter } from './geometry'

// The ball's way in one command, as segments for the board to play (#171,
// after #161 and #142). A ball in the air flies: a kick-off, a pass, a
// throw-in. A ball on the ground hops: a bounce, a scatter. The engine
// reports it all in order: `kicked`, a Pass roll and `intercepted`,
// `ballMoved` with its `how`, and `ballOut`.
//
// - Kick-off: a flight from the middle of the kicking team's half to the hex
//   aimed at, then a low glide along the drift (still in the air).
// - Pass: a flight from the thrower to the target, or to the interceptor.
// - Throw-in: a hop to the edge, a pause at the crowd, then a flight back in.
// - Bounce, scatter: a hop a hex.

export type Point = { x: number; y: number }

export type SegmentKind = 'flight' | 'glide' | 'hop' | 'pause' | 'slide'

/**
 * One piece of the ball's way: from one point to another in `ms`, rising
 * `height` board units at its middle. `hex` is the hex it's heading for
 * (null for the crowd), for the board's data-ball.
 */
export type BallSegment = { kind: SegmentKind; from: Point; to: Point; ms: number; height: number; hex: Hex | null }

export const HOP_MS = 150
export const GLIDE_MS = 150
export const CROWD_PAUSE_MS = 400
const HOP_HEIGHT = 7
const GLIDE_HEIGHT = 12

/** A flight's time by its length in hexes: about 0.6 s for a short one up to 1 s. */
export function flightMs(hexes: number): number {
  return Math.min(1000, Math.max(600, 400 + 50 * hexes))
}

/** How high a flight rises at its middle: higher the longer it is. */
export function flightHeight(hexes: number): number {
  return Math.min(70, 12 + 5 * hexes)
}

/** Where a kick-off is kicked from: the middle of the kicking team's half. */
function kickFrom(team: 'home' | 'away'): Hex {
  return fromColRow({ col: TEAM_SIDES[team] === 'left' ? 5 : 14, row: 5 })
}

/** Just past the touchline next to a hex the ball went out from: where the crowd is. */
function crowdPoint(lastHex: Hex): Point {
  const at = hexCenter(lastHex)
  const off = neighbours(lastHex).find((n) => !onPitch(n))
  if (!off) return at
  const out = hexCenter(off)
  return { x: at.x + (out.x - at.x) * 0.6, y: at.y + (out.y - at.y) * 0.6 }
}

/** Where a pass in these events is aimed: the `passed` event, or the pass waiting on an interceptor or a re-roll. */
function passTarget(before: Pick<GameState, 'pending'>, events: readonly GameEvent[]): Hex | null {
  const passed = events.find((e) => e.type === 'passed')
  if (passed?.type === 'passed') return passed.target
  const data = before.pending?.data as { target?: Hex; data?: { target?: Hex } } | null | undefined
  return data?.target ?? data?.data?.target ?? null
}

const flight = (from: Hex, to: Hex): BallSegment => {
  const hexes = distance(from, to)
  return { kind: 'flight', from: tokenCenter(from), to: tokenCenter(to), ms: flightMs(hexes), height: flightHeight(hexes), hex: to }
}

/** The ball's way through a command's events, given the position it was sent in. */
export function ballSegments(before: Pick<GameState, 'players' | 'pending' | 'activation'>, events: readonly GameEvent[]): BallSegment[] {
  const segments: BallSegment[] = []
  const thrower = before.activation ? (before.players[before.activation.playerId]?.hex ?? null) : null
  // A Pass roll waiting to see whether the ball leaves his hands (not on a fumble, nor while a re-roll is offered).
  // Answering the re-roll offer counts too: taking the failure throws the ball with no new roll.
  let passRolled = before.pending?.kind === 'passing.throw'
  // A throw-in in the air: from the crowd to the last hex it has flown over so far.
  let throwIn: { from: Point; to: Hex; hexes: number } | null = null

  const last = () => segments.at(-1)?.to ?? null
  const flushThrowIn = () => {
    if (!throwIn) return
    const { from, to, hexes } = throwIn
    segments.push({ kind: 'flight', from, to: tokenCenter(to), ms: flightMs(hexes), height: flightHeight(hexes), hex: to })
    throwIn = null
  }
  const flyPass = () => {
    passRolled = false
    const target = passTarget(before, events)
    if (thrower && target) segments.push(flight(thrower, target))
  }

  for (const e of events) {
    if (e.type === 'kicked') {
      segments.push(flight(kickFrom(e.team), e.hex))
    } else if (e.type === 'rolled' && e.test === 'Pass') {
      passRolled = true
    } else if (e.type === 'fumbled') {
      // A fumble never leaves his hands: it bounces from his hex.
      passRolled = false
    } else if (e.type === 'intercepted') {
      passRolled = false
      const interceptor = before.players[e.playerId]?.hex
      if (thrower && interceptor) segments.push(flight(thrower, interceptor))
    } else if (e.type === 'ballMoved') {
      // The pass came down: it flew to the target first.
      if (passRolled) flyPass()
      if (e.how === 'throwIn') {
        if (!throwIn) {
          // From the crowd, after a moment there.
          const from = last() ?? tokenCenter(e.from)
          if (segments.length > 0 && segments.at(-1)!.hex === null) segments.push({ kind: 'pause', from, to: from, ms: CROWD_PAUSE_MS, height: 0, hex: null })
          throwIn = { from, to: e.to, hexes: 0 }
        }
        throwIn.to = e.to
        throwIn.hexes++
        continue
      }
      flushThrowIn()
      if (e.how === 'kick') segments.push({ kind: 'glide', from: last() ?? tokenCenter(e.from), to: tokenCenter(e.to), ms: GLIDE_MS, height: GLIDE_HEIGHT, hex: e.to })
      else segments.push({ kind: 'hop', from: tokenCenter(e.from), to: tokenCenter(e.to), ms: HOP_MS, height: HOP_HEIGHT, hex: e.to })
    } else if (e.type === 'ballOut') {
      flushThrowIn()
      // Off to the crowd: a hop, or the end of a kick-off's glide.
      const from = last() ?? tokenCenter(e.lastHex)
      const kind = segments.at(-1)?.kind
      const inAir = kind === 'glide' || kind === 'flight'
      segments.push({ kind: inAir ? 'glide' : 'hop', from, to: crowdPoint(e.lastHex), ms: inAir ? GLIDE_MS : HOP_MS, height: inAir ? GLIDE_HEIGHT : HOP_HEIGHT, hex: null })
    } else if (passRolled && (e.type === 'ballCaught' || e.type === 'catchDeclined' || (e.type === 'rolled' && e.test === 'Catch'))) {
      flyPass()
    }
  }
  flushThrowIn()
  return segments
}

/** With reduced motion: no arcs, no pauses, one short slide from where the ball starts to where it ends. */
export function stillSegments(segments: readonly BallSegment[]): BallSegment[] {
  const first = segments[0]
  const end = segments.at(-1)
  if (!first || !end) return []
  return [{ kind: 'slide', from: first.from, to: end.to, ms: 250, height: 0, hex: end.hex }]
}

/** Where the ball is `elapsed` ms into its way: the segment, its progress (0–1), the point under it and its height. */
export function ballAt(segments: readonly BallSegment[], elapsed: number): { segment: BallSegment; t: number; at: Point; lift: number } | null {
  let start = 0
  for (const segment of segments) {
    if (elapsed < start + segment.ms) {
      const t = Math.max(0, (elapsed - start) / segment.ms)
      const at = { x: segment.from.x + (segment.to.x - segment.from.x) * t, y: segment.from.y + (segment.to.y - segment.from.y) * t }
      return { segment, t, at, lift: segment.height * 4 * t * (1 - t) }
    }
    start += segment.ms
  }
  return null
}

export const totalMs = (segments: readonly BallSegment[]) => segments.reduce((sum, s) => sum + s.ms, 0)
