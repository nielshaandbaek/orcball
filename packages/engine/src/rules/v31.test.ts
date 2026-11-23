import { describe, expect, it } from 'vitest'
import { rulesV30, rulesV31 } from '../config'

// Rules v31: v30 with no limit on Momentum per round (#265).

describe('rules v31 config', () => {
  it('is v30 without the one-token-a-round limit and with Amazon Guards for Blockers, and v30 is unchanged', () => {
    const { id: _a, momentum: m31, rosters: r31, ...rest31 } = rulesV31
    const { id: _b, momentum: m30, rosters: r30, ...rest30 } = rulesV30
    expect(rulesV31.id).toBe('rules-v31')
    expect(rest31).toEqual(rest30)
    const { amazons: a31, ...others31 } = r31
    const { amazons: a30, ...others30 } = r30
    expect(others31).toEqual(others30)
    const { blocker, ...rest } = a30!.positions
    expect(a31!.positions).toEqual({ ...rest, guard: { ...blocker!, name: 'Guard' } })
    expect(Object.keys(a31!.positions)).toEqual(['blitzer', 'guard', 'thrower', 'lineman'])
    expect({ ...a31!, positions: null }).toEqual({ ...a30!, positions: null })
    expect(m31).toEqual({ perHalf: 2 })
    expect(m30).toEqual({ perHalf: 2, maxPerRound: 1 })
  })
})
