import { describe, expect, it } from 'vitest'
import { describeEngine } from './index'

describe('tools', () => {
  it('can import the engine', () => {
    expect(describeEngine()).toBe('OrcBall rules v12')
  })
})
