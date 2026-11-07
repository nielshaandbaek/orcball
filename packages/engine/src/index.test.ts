import { describe, expect, it } from 'vitest'
import { RULES_VERSION } from './index'

describe('engine', () => {
  it('targets the newest rules', () => {
    expect(RULES_VERSION).toBe('v15')
  })
})
