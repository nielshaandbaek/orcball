import { useEffect, useState } from 'react'

// Fullscreen, where the platform allows it (#88):
// - iPad (Safari 16.4+, or prefixed before), Android, desktop: the Fullscreen
//   API puts the whole page fullscreen; the button toggles it.
// - iPhone Safari: the API only works for video. The nearest thing is Add to
//   Home Screen (the manifest opens the app standalone), so the button shows
//   how instead.
// - Opened from the Home Screen (standalone): already as full as it gets, no button.

export type FullscreenSupport = 'api' | 'homeScreen' | 'none'

/** What the platform reports, as plain facts, so the choice can be tested. */
export type Platform = {
  /** document.fullscreenEnabled, or webkitFullscreenEnabled. */
  apiEnabled: boolean
  /** The app runs standalone or fullscreen from the Home Screen. */
  standalone: boolean
  /** iPhone or iPod: no Fullscreen API for pages, but Add to Home Screen. */
  iPhone: boolean
}

export function fullscreenSupport(p: Platform): FullscreenSupport {
  if (p.standalone) return 'none'
  if (p.apiEnabled) return 'api'
  if (p.iPhone) return 'homeScreen'
  return 'none'
}

type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }

function platform(): Platform {
  const doc = document as WebkitDocument
  return {
    apiEnabled: Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled),
    standalone:
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.matchMedia?.('(display-mode: fullscreen)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    iPhone: /iPhone|iPod/.test(navigator.userAgent),
  }
}

function fullscreenElement(): Element | null {
  const doc = document as WebkitDocument
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

export async function toggleFullscreen(): Promise<void> {
  const doc = document as WebkitDocument
  try {
    if (fullscreenElement()) {
      await (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.())
    } else {
      const root = document.documentElement as WebkitElement
      await (root.requestFullscreen ? root.requestFullscreen() : root.webkitRequestFullscreen?.())
    }
  } catch {
    // Refused (no user gesture, or blocked by the browser): nothing changes, and the button still shows the real state.
  }
}

/** Whether the page is fullscreen now, kept up to date however it enters or leaves (button, Esc, a swipe). */
export function useFullscreen(): { support: FullscreenSupport; active: boolean } {
  const [support] = useState(() => fullscreenSupport(platform()))
  const [active, setActive] = useState(() => fullscreenElement() !== null)
  useEffect(() => {
    const update = () => setActive(fullscreenElement() !== null)
    document.addEventListener('fullscreenchange', update)
    document.addEventListener('webkitfullscreenchange', update)
    return () => {
      document.removeEventListener('fullscreenchange', update)
      document.removeEventListener('webkitfullscreenchange', update)
    }
  }, [])
  return { support, active }
}
