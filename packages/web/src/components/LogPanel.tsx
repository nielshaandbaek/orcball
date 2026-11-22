import { useEffect, useMemo, useRef, useState } from 'react'
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
        const text = describeEvent(event, game, file, entry.events[j + 1])
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

/**
 * The newest two log lines under the board (#127, #253), on one line, the
 * older first and dimmed, separated by a dot, cut short if need be (both in
 * the tooltip); tapping it opens the log.
 */
export function LogTicker() {
  const lines = useLogLines()
  const openLog = useMatch((s) => s.openLog)
  const shown = lines.filter((line) => !line.undone).slice(-2)
  const last = shown.at(-1)
  return (
    <button type="button" className="log-ticker" onClick={openLog} data-log-ticker title={shown.length > 0 ? `${shown.map((l) => l.text).join('\n')}\n(Open the match log)` : 'Open the match log'}>
      {shown.length === 0 && <span className="muted">Nothing yet.</span>}
      {shown.length === 2 && <span className={`${lineClass(shown[0]!)} older`}>{shown[0]!.text}</span>}
      {shown.length === 2 && <span className="sep"> · </span>}
      {last && (
        <span className={lineClass(last)} aria-live="polite">
          {last.text}
        </span>
      )}
    </button>
  )
}

/** How long a new log line stays over the board on a phone (#258). */
export const TOAST_MS = 4000

/**
 * The newest log line over the board's bottom edge, for a few seconds after
 * it comes (#258): on phones in landscape there's no log bar, and the full log
 * is in the menu. Shown only there (styles.css).
 */
export function LogToast() {
  const lines = useLogLines()
  const last = lines.findLast((line) => !line.undone)
  const [shown, setShown] = useState<string | null>(null)
  useEffect(() => {
    if (!last) return
    setShown(last.key)
    const timer = setTimeout(() => setShown(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [last?.key])
  if (!last || shown !== last.key) return null
  return (
    <div className="log-toast" role="status" data-log-toast>
      <span className={lineClass(last)}>{last.text}</span>
    </div>
  )
}
