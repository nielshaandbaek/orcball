import { create } from 'zustand'

// Per-viewer display preferences, kept in localStorage. They never touch the
// match, so the app works the same without them.

const ICONS_KEY = 'orcball.icons'

function load(): boolean {
  try {
    return localStorage.getItem(ICONS_KEY) !== 'off'
  } catch {
    return true
  }
}

type Prefs = { icons: boolean; toggleIcons(): void }

export const usePrefs = create<Prefs>((set, get) => ({
  icons: load(),
  toggleIcons() {
    const icons = !get().icons
    try {
      localStorage.setItem(ICONS_KEY, icons ? 'on' : 'off')
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
    set({ icons })
  },
}))
