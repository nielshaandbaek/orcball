import { fromColRow, type GameEvent } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { ballSteps } from './ballpath'

const h = (col: number, row: number) => fromColRow({ col, row })
const moved = (from: [number, number], to: [number, number], how: 'bounce' | 'scatter' | 'throwIn' | 'kick'): GameEvent => ({
  type: 'ballMoved',
  from: h(...from),
  to: h(...to),
  how,
})

describe('ballSteps (#161)', () => {
  it('is empty when the ball didn’t move', () => {
    expect(ballSteps([{ type: 'knockedDown', playerId: 'home-blitzer-1' }])).toEqual([])
  })

  it('follows a bounce chain hex by hex, from where it started', () => {
    // Match 601560: dropped at (7,5), onto (8,5), dropped, back to (7,5), on to (8,5).
    const events: GameEvent[] = [
      moved([7, 5], [8, 5], 'bounce'),
      { type: 'rolled', test: 'Catch', target: 4, modifiers: [], natural: 4, success: false },
      moved([8, 5], [7, 5], 'bounce'),
      moved([7, 5], [8, 5], 'bounce'),
    ]
    expect(ballSteps(events)).toEqual([h(7, 5), h(8, 5), h(7, 5), h(8, 5)])
  })

  it('carries on into a throw-in from the hex the ball went out from', () => {
    const events: GameEvent[] = [moved([2, 1], [1, 1], 'scatter'), { type: 'ballOut', lastHex: h(1, 1) }, moved([1, 1], [2, 2], 'throwIn'), moved([2, 2], [3, 2], 'throwIn')]
    expect(ballSteps(events)).toEqual([h(2, 1), h(1, 1), h(2, 2), h(3, 2)])
  })
})
