import { create } from 'zustand'

// Per-viewer display preferences, kept in localStorage. They never touch the
// match, so the app works the same without them.

const ICONS_KEY = 'orcball.icons'
/** The grass on the pitch (#163), on unless switched off. */
const GRASS_KEY = 'orcball.grass'
/** Whether the coach has opened the pop-up on an empty hex (#258): the hint saying so stops then. */
const GO_MENU_KEY = 'orcball.goMenuSeen'

function loadSeen(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'yes'
  } catch {
    return false
  }
}

function load(key: string): boolean {
  try {
    return localStorage.getItem(key) !== 'off'
  } catch {
    return true
  }
}

function save(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off')
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}

type Prefs = { icons: boolean; toggleIcons(): void; grass: boolean; toggleGrass(): void; goMenuSeen: boolean; markGoMenuSeen(): void }

export const usePrefs = create<Prefs>((set, get) => ({
  icons: load(ICONS_KEY),
  toggleIcons() {
    const icons = !get().icons
    save(ICONS_KEY, icons)
    set({ icons })
  },
  goMenuSeen: loadSeen(GO_MENU_KEY),
  markGoMenuSeen() {
    if (get().goMenuSeen) return
    try {
      localStorage.setItem(GO_MENU_KEY, 'yes')
    } catch {
      // Storage blocked: the hint comes back after a reload.
    }
    set({ goMenuSeen: true })
  },
  grass: load(GRASS_KEY),
  toggleGrass() {
    const grass = !get().grass
    save(GRASS_KEY, grass)
    set({ grass })
  },
}))
