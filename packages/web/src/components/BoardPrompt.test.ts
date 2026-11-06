import { describe, expect, it } from 'vitest'
import { BOARD_WIDTH } from '../geometry'
import { opensLeft, shiftInto } from './BoardPrompt'

describe('opensLeft', () => {
  it('with nothing on the board to keep clear, opens towards the wider side', () => {
    // A block's dice or follow-up: a player at the left edge must not open off the screen.
    expect(opensLeft(BOARD_WIDTH * 0.05, [])).toBe(false)
    expect(opensLeft(BOARD_WIDTH * 0.95, [])).toBe(true)
  })

  it('opens away from the hexes it is about', () => {
    expect(opensLeft(100, [200, 300])).toBe(true)
    expect(opensLeft(300, [100])).toBe(false)
  })
})

describe('shiftInto', () => {
  it('leaves a span that fits alone', () => {
    expect(shiftInto(10, 100, 400)).toBe(0)
  })

  it('moves a span over the start or past the end back inside', () => {
    expect(shiftInto(-50, 40, 400)).toBe(54)
    expect(shiftInto(350, 420, 400)).toBe(-24)
  })

  it('keeps the start in view when the span is larger than the space', () => {
    expect(shiftInto(-10, 500, 400)).toBe(14)
    expect(shiftInto(100, 600, 400)).toBe(-96)
  })
})
