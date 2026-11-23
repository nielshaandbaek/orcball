import { describe, expect, it } from 'vitest'
import { rulesV30, rulesV31 } from '../config'

// Rules v31: v30 with no limit on Momentum per round (#265).

describe('rules v31 config', () => {
  it('is v30 without the one-token-a-round limit, and v30 is unchanged', () => {
    const { id: _a, momentum: m31, ...rest31 } = rulesV31
    const { id: _b, momentum: m30, ...rest30 } = rulesV30
    expect(rulesV31.id).toBe('rules-v31')
    expect(rest31).toEqual(rest30)
    expect(m31).toEqual({ perHalf: 2 })
    expect(m30).toEqual({ perHalf: 2, maxPerRound: 1 })
  })
})
