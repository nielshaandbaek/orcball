import { useRef } from 'react'
import { useMatch } from '../store'

/** Undo (always visible, disabled with the reason when not allowed), and saving the match to or from a file. */
export function MatchTools() {
  const undoReason = useMatch((s) => s.undoReason)
  const undo = useMatch((s) => s.undo)
  const exportJson = useMatch((s) => s.exportJson)
  const importJson = useMatch((s) => s.importJson)
  const file = useMatch((s) => s.file)
  const picker = useRef<HTMLInputElement>(null)

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

  return (
    <section className="tools">
      <div className="row">
        <button type="button" id="undo" disabled={undoReason !== null} title={undoReason ?? 'Undo the last action'} onClick={undo}>
          Undo
        </button>
        <button type="button" onClick={download}>
          Export match
        </button>
        <button type="button" onClick={() => picker.current?.click()}>
          Import match
        </button>
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
      {undoReason && <p className="reason" data-undo-reason>{undoReason}</p>}
    </section>
  )
}
