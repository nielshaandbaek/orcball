import { useMatch } from '../store'

/** Undo: always visible, disabled with the reason when it isn't allowed. The rest is in the header's menu (#128). */
export function MatchTools() {
  const undoReason = useMatch((s) => s.undoReason)
  const undo = useMatch((s) => s.undo)
  return (
    <section className="tools">
      <div className="row">
        <button type="button" id="undo" disabled={undoReason !== null} title={undoReason ?? 'Undo the last action'} onClick={undo}>
          Undo
        </button>
      </div>
      {undoReason && <p className="reason" data-undo-reason>{undoReason}</p>}
    </section>
  )
}
