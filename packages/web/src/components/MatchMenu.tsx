import { useEffect, useRef, useState } from 'react'
import { usePrefs } from '../prefs'
import { useMatch } from '../store'

/**
 * The header's "⋯" menu (#128): the rarely used tools, saving the match to
 * or from a file and icons or initials. It closes on a choice, Escape or a
 * tap anywhere else.
 */
export function MatchMenu() {
  const exportJson = useMatch((s) => s.exportJson)
  const importJson = useMatch((s) => s.importJson)
  const file = useMatch((s) => s.file)
  const icons = usePrefs((s) => s.icons)
  const toggleIcons = usePrefs((s) => s.toggleIcons)
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const download = () => {
    const json = exportJson()
    if (!json || !file) return
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `orcball-${file.seed}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <div className="match-menu" ref={menu}>
      <button type="button" className="quiet" id="menu-button" aria-haspopup="menu" aria-expanded={open} aria-label="More" onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div className="menu" role="menu">
          <button type="button" role="menuitem" onClick={choose(download)}>
            Export match
          </button>
          <button type="button" role="menuitem" onClick={choose(() => picker.current?.click())}>
            Import match
          </button>
          <button type="button" role="menuitem" id="icons" aria-pressed={icons} onClick={choose(toggleIcons)} title="Show players as icons or as initials">
            {icons ? 'Show initials' : 'Show icons'}
          </button>
        </div>
      )}
      <input
        ref={picker}
        id="import"
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const chosen = e.target.files?.[0]
          if (chosen) importJson(await chosen.text())
          e.target.value = ''
        }}
      />
    </div>
  )
}
