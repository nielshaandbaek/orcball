import { useEffect, useMemo, useRef } from 'react'
import { describeEvent } from '../describe'
import { useMatch } from '../store'

type Line = { key: string; text: string; undone: boolean; big: boolean; team: string | null; reason?: boolean }

/**
 * The match so far in plain words, newest at the bottom. Undone actions are
 * struck through. Against the computer, its reason goes before the actions it
 * led to, once per plan: the later commands of the same plan don't repeat it.
 */
export function LogPanel() {
  const file = useMatch((s) => s.file)!
  const game = useMatch((s) => s.game)!
  const reasons = useMatch((s) => s.reasons)
  const box = useRef<HTMLElement>(null)

  const lines = useMemo(() => {
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

  // Keep the newest line in view by scrolling the log box itself, never the page.
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines.length])

  return (
    <section className="log" ref={box}>
      <h2>Match log</h2>
      <ol className="log-lines" aria-live="polite">
        {lines.length === 0 && <li className="muted">Nothing yet.</li>}
        {lines.map((line) => (
          <li
            key={line.key}
            className={`${line.undone ? 'undone' : ''}${line.big ? ' big' : ''}${line.team ? ` round-start ${line.team}` : ''}${line.reason ? ' reason' : ''}`}
          >
            {line.text}
          </li>
        ))}
      </ol>
    </section>
  )
}
