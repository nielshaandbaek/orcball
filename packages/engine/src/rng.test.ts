import { describe, expect, it } from 'vitest'
import { forcedRng, rollDie, type RngState, seededRng } from './rng'

function rollMany(rng: RngState, sides: number, count: number): number[] {
  const values: number[] = []
  let state = rng
  for (let i = 0; i < count; i++) {
    const roll = rollDie(state, sides)
    values.push(roll.value)
    state = roll.rng
  }
  return values
}

describe('seeded RNG', () => {
  it('gives the same sequence for the same seed', () => {
    expect(rollMany(seededRng(42), 10, 50)).toEqual(rollMany(seededRng(42), 10, 50))
  })

  it('gives different sequences for different seeds', () => {
    expect(rollMany(seededRng(42), 10, 50)).not.toEqual(rollMany(seededRng(43), 10, 50))
  })

  it('never mutates the state it is given', () => {
    const rng = seededRng(7)
    const copy = { ...rng }
    rollDie(rng, 10)
    expect(rng).toEqual(copy)
  })

  it('carries on the same after a JSON round trip', () => {
    let rng: RngState = seededRng(99)
    for (let i = 0; i < 10; i++) rng = rollDie(rng, 6).rng
    const restored = JSON.parse(JSON.stringify(rng)) as RngState
    expect(rollMany(restored, 10, 20)).toEqual(rollMany(rng, 10, 20))
  })

  it.each([6, 10])('rolls every face of a D%i about equally often', (sides) => {
    const rolls = 60_000
    const counts = new Array<number>(sides + 1).fill(0)
    for (const v of rollMany(seededRng(2026), sides, rolls)) counts[v]!++
    expect(counts[0]).toBe(0)
    for (let face = 1; face <= sides; face++) {
      // Within 5% of the expected count; about 8 standard deviations here.
      expect(Math.abs(counts[face]! - rolls / sides)).toBeLessThan((rolls / sides) * 0.05)
    }
  })
})

describe('forced RNG', () => {
  it('returns the given faces in order', () => {
    expect(rollMany(forcedRng([3, 10, 1]), 10, 3)).toEqual([3, 10, 1])
  })

  it('can mix dice sizes', () => {
    const d6 = rollDie(forcedRng([4, 9]), 6)
    expect(d6.value).toBe(4)
    expect(rollDie(d6.rng, 10).value).toBe(9)
  })

  it('throws when it runs out', () => {
    expect(() => rollDie(forcedRng([]), 10)).toThrow(/no faces left/)
  })

  it('carries on with a seeded RNG once the faces run out, if given one', () => {
    const after = seededRng(7)
    const forced = rollMany(forcedRng([3, 4], after), 10, 5)
    expect(forced.slice(0, 2)).toEqual([3, 4])
    expect(forced.slice(2)).toEqual(rollMany(after, 10, 3))
  })

  it('throws on a face the die does not have', () => {
    expect(() => rollDie(forcedRng([7]), 6)).toThrow(/not a valid D6/)
    expect(() => rollDie(forcedRng([0]), 10)).toThrow(/not a valid D10/)
  })

  it('survives a JSON round trip', () => {
    const rng = rollDie(forcedRng([2, 5]), 6).rng
    expect(JSON.parse(JSON.stringify(rng))).toEqual(rng)
  })
})
