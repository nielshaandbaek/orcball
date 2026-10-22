import { describe, expect, it } from 'vitest'
import { RULES_VERSION } from './index'

describe('engine', () => {
  it('targets rules v10', () => {
    expect(RULES_VERSION).toBe('v10')
  })
})
