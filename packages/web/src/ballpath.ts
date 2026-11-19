import { fromColRow, type GameEvent, type GameState, type Hex, neighbours, onPitch, TEAM_SIDES } from '@orcball/engine'
import { HEX_WIDTH, hexCenter, tokenCenter } from './geometry'

// The ball's way in one command, as segments for the board to play (#171,
// after #161 and #142). A ball in the air flies; a ball on the ground hops.
// The engine reports it all in order: `kicked`, a Pass roll and
// `intercepted`, `ballMoved` with its `how`, and `ballOut`.
//
// - Kick-off: one flight from the middle of the kicking team's half to where
//   it comes down. The drift (`how: 'kick'`) is where it lands, not a way it
//   travels, so it isn't shown hex by hex.
// - Pass: one flight from the thrower to the target, or to the interceptor.
//   A failed pass's scatters are its deviation in the air: one flight to
//   where they end.
// - Throw-in: a hop to the edge, a pause at the crowd, then a flight back in.
// - Bounce: a hop a hex, once the ball is on the ground.
// - Off the pitch in the air (a kick or pass drifting out, a throw-in going
//   out again): the flight ends at the crowd.

export type Point = { x: number; y: number }

export type SegmentKind = 'flight' | 'hop' | 'pause' | 'slide'

/**
 * One piece of the ball's way: from one point to another in `ms`, rising
 * `height` board units at its middle. `hex` is the hex it's heading for
 * (null for the crowd), for the board's data-ball.
 */
export type BallSegment = { kind: SegmentKind; from: Point; to: Point; ms: number; height: number; hex: Hex | null }

export const HOP_MS = 150
export const CROWD_PAUSE_MS = 400
const HOP_HEIGHT = 7

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

/** A flight from a point to another, timed and raised by its length. */
function flightBetween(from: Point, to: Point, hex: Hex | null): BallSegment {
  const hexes = Math.round(Math.hypot(to.x - from.x, to.y - from.y) / HEX_WIDTH)
  return { kind: 'flight', from, to, ms: flightMs(hexes), height: flightHeight(hexes), hex }
}

/** The ball's way through a command's events, given the position it was sent in. */
export function ballSegments(before: Pick<GameState, 'players' | 'pending' | 'activation'>, events: readonly GameEvent[]): BallSegment[] {
  const segments: BallSegment[] = []
  const thrower = before.activation ? (before.players[before.activation.playerId]?.hex ?? null) : null
  // A Pass roll waiting to see whether the ball leaves his hands (not on a fumble, nor while a re-roll is offered).
  // Answering the re-roll offer counts too: taking the failure throws the ball with no new roll.
  let passRolled = before.pending?.kind === 'passing.throw'
  // The ball in the air: where it was thrown or kicked from, and the hex it will come down on so far.
  let air: { from: Point; to: Hex } | null = null

  const last = () => segments.at(-1)?.to ?? null
  /** The ball comes down: one flight to where it lands, or to the crowd if it went out. */
  const land = (crowd: Point | null = null) => {
    if (!air) return
    segments.push(flightBetween(air.from, crowd ?? tokenCenter(air.to), crowd ? null : air.to))
    air = null
  }
  const throwFrom = (): Point | null => (thrower ? tokenCenter(thrower) : null)

  for (const e of events) {
    if (e.type === 'kicked') {
      air = { from: tokenCenter(kickFrom(e.team)), to: e.hex }
    } else if (e.type === 'rolled' && e.test === 'Pass') {
      passRolled = true
    } else if (e.type === 'fumbled') {
      // A fumble never leaves his hands: it bounces from his hex.
      passRolled = false
    } else if (e.type === 'intercepted') {
      passRolled = false
      const interceptor = before.players[e.playerId]?.hex
      const from = throwFrom()
      if (from && interceptor) segments.push(flightBetween(from, tokenCenter(interceptor), interceptor))
    } else if (e.type === 'ballMoved') {
      if (e.how === 'kick' || e.how === 'scatter') {
        // Still in the air: a kick-off's drift, or a failed pass's deviation. Only where it ends is shown.
        if (!air) {
          const from = passRolled ? throwFrom() : null
          passRolled = false
          air = { from: from ?? tokenCenter(e.from), to: e.to }
        }
        air.to = e.to
        continue
      }
      if (e.how === 'throwIn') {
        if (!air) {
          // From the crowd, after a moment there.
          const from = last() ?? tokenCenter(e.from)
          if (segments.length > 0 && segments.at(-1)!.hex === null) segments.push({ kind: 'pause', from, to: from, ms: CROWD_PAUSE_MS, height: 0, hex: null })
          air = { from, to: e.to }
        }
        air.to = e.to
        continue
      }
      // On the ground: an accurate pass to an empty hex lands first, then it bounces.
      if (passRolled) flyPass()
      land()
      segments.push({ kind: 'hop', from: tokenCenter(e.from), to: tokenCenter(e.to), ms: HOP_MS, height: HOP_HEIGHT, hex: e.to })
    } else if (e.type === 'ballOut') {
      if (air) {
        land(crowdPoint(e.lastHex))
        continue
      }
      // Bounced off the pitch: a hop to the crowd.
      const from = last() ?? tokenCenter(e.lastHex)
      segments.push({ kind: 'hop', from, to: crowdPoint(e.lastHex), ms: HOP_MS, height: HOP_HEIGHT, hex: null })
    } else if (passRolled && (e.type === 'ballCaught' || e.type === 'catchDeclined' || (e.type === 'rolled' && e.test === 'Catch'))) {
      flyPass()
    } else if (air && (e.type === 'ballCaught' || e.type === 'catchDeclined' || (e.type === 'rolled' && e.test === 'Catch') || e.type === 'ballSettled' || e.type === 'touchback')) {
      // It comes down on a player, or on the ground, before anything else happens.
      land()
    }
  }
  land()
  return segments

  function flyPass() {
    passRolled = false
    const target = passTarget(before, events)
    const from = throwFrom()
    if (from && target) segments.push(flightBetween(from, tokenCenter(target), target))
  }
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
