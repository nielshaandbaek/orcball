import { describe, expect, it } from 'vitest'
import { fullscreenSupport } from './fullscreen'

describe('fullscreenSupport', () => {
  it('offers the Fullscreen API where it works: iPad, Android, desktop', () => {
    expect(fullscreenSupport({ apiEnabled: true, standalone: false, iPhone: false })).toBe('api')
  })

  it('points an iPhone to Add to Home Screen, since Safari there has no page fullscreen', () => {
    expect(fullscreenSupport({ apiEnabled: false, standalone: false, iPhone: true })).toBe('homeScreen')
  })

  it('shows nothing when opened from the Home Screen, or where nothing works', () => {
    expect(fullscreenSupport({ apiEnabled: true, standalone: true, iPhone: false })).toBe('none')
    expect(fullscreenSupport({ apiEnabled: false, standalone: true, iPhone: true })).toBe('none')
    expect(fullscreenSupport({ apiEnabled: false, standalone: false, iPhone: false })).toBe('none')
  })
})
