import { useMatch } from '../store'
import { ReasonButton } from './ReasonButton'

/** Undo: always visible, greyed out with the reason as its tooltip when it isn't allowed. The rest is in the header's menu (#128). */
export function MatchTools() {
  const undoReason = useMatch((s) => s.undoReason)
  const undo = useMatch((s) => s.undo)
  return (
    <section className="tools">
      <div className="row">
        <ReasonButton id="undo" reason={undoReason} title="Undo the last action" onClick={undo}>
          Undo
        </ReasonButton>
      </div>
    </section>
  )
}
