import { useState } from 'react'
import { toggleFullscreen, useFullscreen } from '../fullscreen'

/** Fullscreen on and off; on an iPhone, how to get the app full-screen from the Home Screen instead. */
export function FullscreenButton() {
  const { support, active } = useFullscreen()
  const [hint, setHint] = useState(false)
  if (support === 'none') return null
  if (support === 'homeScreen') {
    return (
      <span className="fullscreen">
        <button type="button" className="quiet" id="fullscreen" aria-expanded={hint} onClick={() => setHint(!hint)}>
          Full screen
        </button>
        {hint && (
          <span className="fullscreen-hint" role="note" data-fullscreen-hint>
            On iPhone: Share → Add to Home Screen, then open OrcBall from there.
          </span>
        )}
      </span>
    )
  }
  return (
    <button type="button" className="quiet" id="fullscreen" aria-pressed={active} onClick={toggleFullscreen}>
      {active ? 'Exit full screen' : 'Full screen'}
    </button>
  )
}
