import { describe, expect, it } from 'vitest'
import { type Modifier, resolveTest, rollD6, rollD10, successChance } from './dice'
import { forcedRng, type RngState, seededRng } from './rng'

const mods = (...values: number[]): Modifier[] => values.map((value, i) => ({ name: `m${i}`, value }))

describe('rollD6 and rollD10', () => {
  it('roll the right sizes of die', () => {
    expect(rollD6(forcedRng([6])).value).toBe(6)
    expect(() => rollD6(forcedRng([10]))).toThrow()
    expect(rollD10(forcedRng([10])).value).toBe(10)
  })
})

describe('resolveTest', () => {
  it('succeeds when the natural roll plus modifiers reaches the target', () => {
    expect(resolveTest(forcedRng([5]), 'dodge', 6, mods(1)).event.success).toBe(true)
    expect(resolveTest(forcedRng([5]), 'dodge', 6, mods()).event.success).toBe(false)
    expect(resolveTest(forcedRng([6]), 'dodge', 6, mods()).event.success).toBe(true)
  })

  it('adds up several modifiers', () => {
    expect(resolveTest(forcedRng([7]), 'pass', 6, mods(-1, -1)).event.success).toBe(false)
    expect(resolveTest(forcedRng([8]), 'pass', 6, mods(-1, -1)).event.success).toBe(true)
  })

  it('always fails on a natural 1, whatever the modifiers', () => {
    expect(resolveTest(forcedRng([1]), 'pickup', 2, mods(5)).event.success).toBe(false)
  })

  it('always succeeds on a natural 10, whatever the modifiers', () => {
    expect(resolveTest(forcedRng([10]), 'intercept', 9, mods(-3, -1, -5)).event.success).toBe(true)
  })

  it('returns a rolled event with everything the log and UI need', () => {
    const modifiers = [
      { name: 'Short pass', value: -1 },
      { name: 'Enemy tackle zone', value: -1 },
    ]
    const { event, rng } = resolveTest(forcedRng([8, 3]), 'pass', 6, modifiers)
    expect(event).toEqual({ type: 'rolled', test: 'pass', target: 6, modifiers, natural: 8, success: true })
    expect(event.modifiers).not.toBe(modifiers)
    expect(rng).toEqual(forcedRng([3]))
  })
})

describe('successChance', () => {
  it('matches the rules: each modifier point is 10%', () => {
    expect(successChance(6, mods())).toBeCloseTo(0.5)
    expect(successChance(6, mods(1))).toBeCloseTo(0.6)
    expect(successChance(6, mods(-1, -1))).toBeCloseTo(0.3)
    // AG 4+ from the Blood Bowl conversion table: 70%.
    expect(successChance(4, mods())).toBeCloseTo(0.7)
  })

  it('stays between 10% and 90% however big the modifiers', () => {
    expect(successChance(6, mods(20))).toBeCloseTo(0.9)
    expect(successChance(6, mods(-20))).toBeCloseTo(0.1)
    expect(successChance(2, mods())).toBeCloseTo(0.9)
    expect(successChance(11, mods())).toBeCloseTo(0.1)
  })

  it('matches the Tackle table in RULES.md §5', () => {
    // 6+, +1 per point of strength difference.
    const table = { [-2]: 0.3, [-1]: 0.4, 0: 0.5, 1: 0.6, 2: 0.7, 3: 0.8 }
    for (const [diff, chance] of Object.entries(table)) {
      expect(successChance(6, mods(Number(diff)))).toBeCloseTo(chance)
    }
  })

  it('agrees with 10,000 seeded rolls for every modifier total', () => {
    let rng: RngState = seededRng(1234)
    for (let total = -6; total <= 6; total++) {
      const modifiers = mods(total)
      let wins = 0
      for (let i = 0; i < 10_000; i++) {
        const result = resolveTest(rng, 'check', 6, modifiers)
        rng = result.rng
        if (result.event.success) wins++
      }
      // 3 percentage points is about 6 standard deviations at 10,000 rolls.
      expect(Math.abs(wins / 10_000 - successChance(6, modifiers))).toBeLessThan(0.03)
    }
  })
})
