import { useEffect, useMemo, useRef } from 'react'
import { describeEvent } from '../describe'
import { useMatch } from '../store'

type Line = { key: string; text: string; undone: boolean; big: boolean; team: string | null; reason?: boolean }

/**
 * The match so far in plain words, newest last. Undone actions are struck
 * through. Against the computer, its reason goes before the actions it led
 * to, once per plan: the later commands of the same plan don't repeat it.
 */
function useLogLines(): Line[] {
  const file = useMatch((s) => s.file)!
  const game = useMatch((s) => s.game)!
  const reasons = useMatch((s) => s.reasons)
  return useMemo(() => {
    let lastPlan: string | null = null
    return file.entries.flatMap((entry, i) => {
      const out: Line[] = []
      const reason = reasons[i]
      if (reason && (reason.plan === undefined || reason.plan !== lastPlan)) {
        out.push({ key: `${i}.r`, text: `Computer: ${reason.text}`, undone: false, big: false, team: null, reason: true })
      }
      // Anyone else's command in between starts afresh.
      lastPlan = reason?.plan ?? null
      entry.events.forEach((event, j) => {
        const text = describeEvent(event, game, file)
        if (!text) return
        const big = event.type === 'touchdown' || event.type === 'roundEnded' || event.type === 'roundStarted'
        // A round's first line takes the colour of the team with the initiative.
        const team = event.type === 'roundStarted' ? event.firstGo : null
        out.push({ key: `${i}.${j}`, text, undone: entry.undone === true, big, team })
      })
      return out
    })
  }, [file, game, reasons])
}

const lineClass = (line: Line) =>
  `${line.undone ? 'undone' : ''}${line.big ? ' big' : ''}${line.team ? ` round-start ${line.team}` : ''}${line.reason ? ' reason' : ''}`

/**
 * The match log as a panel over the board (#127), opened from the header or
 * the ticker. It closes with its close button, Escape or a tap outside it.
 * While it's open the computer waits.
 */
export function LogDialog() {
  const open = useMatch((s) => s.logOpen)
  if (!open) return null
  return <LogDialogOpen />
}

function LogDialogOpen() {
  const close = useMatch((s) => s.closeLog)
  const lines = useLogLines()
  const box = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButton.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  // Keep the newest line in view by scrolling the log box itself, never the page.
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines.length])

  return (
    <div className="log-overlay" onClick={close} data-log-overlay>
      <section className="log-dialog" role="dialog" aria-modal="true" aria-labelledby="log-title" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id="log-title">Match log</h2>
          <button type="button" ref={closeButton} className="quiet" id="log-close" onClick={close} aria-label="Close the match log">
            Close
          </button>
        </header>
        <div className="log" ref={box}>
          <ol className="log-lines">
            {lines.length === 0 && <li className="muted">Nothing yet.</li>}
            {lines.map((line) => (
              <li key={line.key} className={lineClass(line)}>
                {line.text}
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  )
}

/** The newest log line under the board (#127); tapping it opens the log. */
export function LogTicker() {
  const lines = useLogLines()
  const openLog = useMatch((s) => s.openLog)
  const last = lines.findLast((line) => !line.undone)
  return (
    <button type="button" className="log-ticker" onClick={openLog} data-log-ticker title="Open the match log">
      <span className={last ? lineClass(last) : 'muted'} aria-live="polite">
        {last?.text ?? 'Nothing yet.'}
      </span>
    </button>
  )
}

/** The header's button for the match log. */
export function LogButton() {
  const openLog = useMatch((s) => s.openLog)
  return (
    <button type="button" className="quiet" id="log-button" onClick={openLog}>
      Log
    </button>
  )
}
