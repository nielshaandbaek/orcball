import { useEffect, useMemo, useRef } from 'react'
import { describeEvent } from '../describe'
import { playerName } from '../labels'
import { useMatch } from '../store'

type Line = { key: string; text: string; undone: boolean; big: boolean; team: string | null; reason?: boolean }

/**
 * The match so far in plain words, newest at the bottom. Undone actions are
 * struck through. Against the computer, its reason goes before the actions it
 * led to, once per plan: a reason the same as its last one isn't repeated.
 */
export function LogPanel() {
  const file = useMatch((s) => s.file)!
  const game = useMatch((s) => s.game)!
  const reasons = useMatch((s) => s.reasons)
  const box = useRef<HTMLElement>(null)

  const lines = useMemo(() => {
    // Player ids in a reason read as names, as in the rest of the log.
    const named = (reason: string) =>
      reason.replace(/\b(home|away)-[a-z-]+-\d+\b/g, (id) => {
        const p = game.players[id]
        return p ? playerName(file, p) : id
      })
    let lastReason: string | null = null
    return file.entries.flatMap((entry, i) => {
      const out: Line[] = []
      const reason = reasons[i]
      if (reason !== undefined && reason !== lastReason) out.push({ key: `${i}.r`, text: `Computer: ${named(reason)}`, undone: false, big: false, team: null, reason: true })
      if (reason !== undefined) lastReason = reason
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
