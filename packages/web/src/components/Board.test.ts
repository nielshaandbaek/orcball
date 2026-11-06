import { describe, expect, it } from 'vitest'
import { spriteTransform } from './Board'

describe('spriteTransform', () => {
  it('leaves a standing home sprite as it is', () => {
    expect(spriteTransform(false, false, 50, 80)).toBe('')
  })

  it('mirrors an away sprite about its centre, and turns a down one on its side', () => {
    expect(spriteTransform(true, false, 50, 80)).toBe('translate(100 0) scale(-1 1)')
    expect(spriteTransform(false, true, 50, 80)).toBe('rotate(-90 50 80)')
    expect(spriteTransform(true, true, 50, 80)).toBe('translate(100 0) scale(-1 1) rotate(-90 50 80)')
  })
})
