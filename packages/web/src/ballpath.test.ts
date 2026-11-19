import { fromColRow, type GameEvent, type GameState, type Hex } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { ballAt, ballSegments, CROWD_PAUSE_MS, flightMs, HOP_MS, stillSegments, totalMs } from './ballpath'
import { tokenCenter } from './geometry'

const h = (col: number, row: number) => fromColRow({ col, row })
const moved = (from: [number, number], to: [number, number], how: 'bounce' | 'scatter' | 'throwIn' | 'kick'): GameEvent => ({
  type: 'ballMoved',
  from: h(...from),
  to: h(...to),
  how,
})
const roll = (test: string, success: boolean): GameEvent => ({ type: 'rolled', test, target: 5, modifiers: [], natural: success ? 7 : 2, success })

/** The position a command was sent in: a thrower at (5,5) activating, unless said otherwise. */
function before(extra: Partial<Pick<GameState, 'pending'>> = {}, players: Record<string, Hex> = {}): Pick<GameState, 'players' | 'pending' | 'activation'> {
  const all = { 'home-thrower-1': h(5, 5), ...players }
  return {
    players: Object.fromEntries(Object.entries(all).map(([id, hex]) => [id, { hex }])) as unknown as GameState['players'],
    pending: (extra.pending ?? null) as GameState['pending'],
    activation: { playerId: 'home-thrower-1' } as GameState['activation'],
  }
}

const kinds = (events: GameEvent[], b = before()) => ballSegments(b, events).map((s) => s.kind)

describe('ballSegments: the ball on the ground hops (#161, #171)', () => {
  it('nothing when the ball didn’t move', () => {
    expect(ballSegments(before(), [{ type: 'knockedDown', playerId: 'home-blitzer-1' }])).toEqual([])
  })

  it('a bounce chain: a hop a hex, from where it was', () => {
    // Match 601560: dropped at (7,5), onto (8,5), dropped, back to (7,5), on to (8,5).
    const segments = ballSegments(before(), [moved([7, 5], [8, 5], 'bounce'), roll('Catch', false), moved([8, 5], [7, 5], 'bounce'), moved([7, 5], [8, 5], 'bounce')])
    expect(segments.map((s) => [s.kind, s.hex])).toEqual([
      ['hop', h(8, 5)],
      ['hop', h(7, 5)],
      ['hop', h(8, 5)],
    ])
    expect(segments[0]).toMatchObject({ from: tokenCenter(h(7, 5)), to: tokenCenter(h(8, 5)), ms: HOP_MS })
  })
})

describe('ballSegments: a kick-off flies, then glides along its drift (#142, #171)', () => {
  it('from the middle of the kicking team’s half to the hex aimed at, the drift in the air, then a bounce', () => {
    const events: GameEvent[] = [
      { type: 'kicked', team: 'away', hex: h(4, 5) },
      moved([4, 5], [3, 5], 'kick'),
      moved([3, 5], [2, 5], 'kick'),
      moved([2, 5], [1, 5], 'kick'),
      moved([1, 5], [2, 5], 'bounce'),
    ]
    const segments = ballSegments(before(), events)
    expect(segments.map((s) => s.kind)).toEqual(['flight', 'glide', 'glide', 'glide', 'hop'])
    // The Elves (away) kick from the right half.
    expect(segments[0]).toMatchObject({ from: tokenCenter(h(14, 5)), to: tokenCenter(h(4, 5)), ms: flightMs(10), hex: h(4, 5) })
    expect(segments[0]!.height).toBeGreaterThan(segments[1]!.height)
  })

  it('a drift off the pitch glides to the crowd, and that’s the end (a touchback)', () => {
    const segments = ballSegments(before(), [{ type: 'kicked', team: 'home', hex: h(16, 1) }, moved([16, 1], [17, 1], 'kick'), { type: 'ballOut', lastHex: h(17, 1) }])
    expect(segments.map((s) => [s.kind, s.hex])).toEqual([
      ['flight', h(16, 1)],
      ['glide', h(17, 1)],
      ['glide', null],
    ])
  })
})

describe('ballSegments: a throw-in comes back from the crowd in the air (#171)', () => {
  it('match 702642: out at the top touchline, thrown in three times, then a bounce', () => {
    // Dropped on (10,1), bounced out; thrown in along the touchline and out at the corner,
    // across the pitch and out at the bottom, back to (10,1), then it bounced to (11,1).
    const events: GameEvent[] = [
      { type: 'ballOut', lastHex: h(10, 1) },
      ...[11, 12, 13, 14, 15, 16, 17, 18].map((col) => moved([col - 1, 1], [col, 1], 'throwIn')),
      { type: 'ballOut', lastHex: h(18, 1) },
      moved([18, 1], [17, 2], 'throwIn'),
      moved([17, 2], [17, 3], 'throwIn'),
      moved([17, 3], [14, 9], 'throwIn'),
      { type: 'ballOut', lastHex: h(14, 9) },
      moved([14, 9], [13, 8], 'throwIn'),
      moved([13, 8], [10, 1], 'throwIn'),
      moved([10, 1], [11, 1], 'bounce'),
    ]
    const segments = ballSegments(before(), events)
    // It bounces out (a hop), and each throw-in that goes out again sails on to the crowd in the air (a glide).
    expect(segments.map((s) => s.kind)).toEqual(['hop', 'pause', 'flight', 'glide', 'pause', 'flight', 'glide', 'pause', 'flight', 'hop'])
    // Each flight from the crowd, where the ball paused, to where that throw-in ended.
    expect(segments.filter((s) => s.kind === 'flight').map((s) => s.hex)).toEqual([h(18, 1), h(14, 9), h(10, 1)])
    expect(segments[2]!.from).toEqual(segments[1]!.to)
    expect(segments[1]).toMatchObject({ ms: CROWD_PAUSE_MS, hex: null })
    // Off the top touchline: the crowd is above the hex.
    expect(segments[0]!.to.y).toBeLessThan(tokenCenter(h(10, 1)).y)
    // Three throw-ins with their pauses in about 3 s, not the 5 s of a step a hex.
    expect(totalMs(segments)).toBeLessThan(4000)
  })
})

describe('ballSegments: a pass flies (#171)', () => {
  it('to the target, when it lands: an accurate pass caught there', () => {
    const segments = ballSegments(before(), [
      { type: 'passed', playerId: 'home-thrower-1', target: h(9, 5) },
      roll('Pass', true),
      roll('Catch', true),
      { type: 'ballCaught', playerId: 'home-catcher-1' },
    ])
    expect(segments).toEqual([expect.objectContaining({ kind: 'flight', from: tokenCenter(h(5, 5)), to: tokenCenter(h(9, 5)), hex: h(9, 5) })])
  })

  it('to the target and then scatters, when it’s inaccurate', () => {
    expect(kinds([{ type: 'passed', playerId: 'home-thrower-1', target: h(9, 5) }, roll('Pass', false), moved([9, 5], [9, 4], 'scatter'), moved([9, 4], [10, 4], 'scatter'), moved([10, 4], [10, 3], 'scatter')])).toEqual([
      'flight',
      'hop',
      'hop',
      'hop',
    ])
  })

  it('to an empty hex: a flight, then the bounce', () => {
    expect(kinds([{ type: 'passed', playerId: 'home-thrower-1', target: h(9, 5) }, roll('Pass', true), moved([9, 5], [10, 5], 'bounce')])).toEqual(['flight', 'hop'])
  })

  it('never leaves his hands on a fumble: it bounces from him', () => {
    expect(kinds([{ type: 'passed', playerId: 'home-thrower-1', target: h(9, 5) }, roll('Pass', false), { type: 'fumbled', playerId: 'home-thrower-1' }, moved([5, 5], [6, 5], 'bounce')])).toEqual(['hop'])
  })

  it('to the interceptor, when he takes it', () => {
    const b = before({}, { 'away-lineman-1': h(7, 5) })
    expect(ballSegments(b, [{ type: 'passed', playerId: 'home-thrower-1', target: h(9, 5) }, roll('Interception', true), { type: 'intercepted', playerId: 'away-lineman-1' }])).toEqual([
      expect.objectContaining({ kind: 'flight', to: tokenCenter(h(7, 5)), hex: h(7, 5) }),
    ])
  })

  it('not while a re-roll is offered; then from the decision, to the target the pass was aimed at', () => {
    expect(kinds([{ type: 'passed', playerId: 'home-thrower-1', target: h(9, 5) }, roll('Pass', false)])).toEqual([])
    const offered = before({ pending: { kind: 'passing.throw', data: { failed: roll('Pass', false), data: { throwerId: 'home-thrower-1', target: h(9, 5) } } } as unknown as GameState['pending'] })
    expect(ballSegments(offered, [roll('Pass', true), roll('Catch', true), { type: 'ballCaught', playerId: 'home-catcher-1' }])).toEqual([expect.objectContaining({ kind: 'flight', hex: h(9, 5) })])
    // Taking the failure: no new roll, the inaccurate pass flies to the target and scatters.
    expect(kinds([moved([9, 5], [9, 4], 'scatter')], offered)).toEqual(['flight', 'hop'])
  })
})

describe('playing the segments', () => {
  const segments = ballSegments(before(), [{ type: 'kicked', team: 'away', hex: h(4, 5) }, moved([4, 5], [3, 5], 'kick')])

  it('ballAt: the segment, how far along, the point under the ball and how high it is', () => {
    const start = ballAt(segments, 0)!
    expect(start).toMatchObject({ t: 0, at: tokenCenter(h(14, 5)), lift: 0 })
    const top = ballAt(segments, segments[0]!.ms / 2)!
    expect(top.lift).toBeCloseTo(segments[0]!.height)
    expect(ballAt(segments, segments[0]!.ms + 1)!.segment.kind).toBe('glide')
    expect(ballAt(segments, totalMs(segments))).toBeNull()
  })

  it('with reduced motion, one short slide from the start to the end', () => {
    expect(stillSegments(segments)).toEqual([{ kind: 'slide', from: tokenCenter(h(14, 5)), to: tokenCenter(h(3, 5)), ms: 250, height: 0, hex: h(3, 5) }])
    expect(stillSegments([])).toEqual([])
  })
})
