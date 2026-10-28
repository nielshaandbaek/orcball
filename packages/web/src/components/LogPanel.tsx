import { useEffect, useMemo, useRef } from 'react'
import { describeEvent } from '../describe'
import { useMatch } from '../store'

/** The match so far in plain words, newest at the bottom. Undone actions are struck through. */
export function LogPanel() {
  const file = useMatch((s) => s.file)!
  const game = useMatch((s) => s.game)!
  const box = useRef<HTMLElement>(null)

  const lines = useMemo(
    () =>
      file.entries.flatMap((entry, i) =>
        entry.events.flatMap((event, j) => {
          const text = describeEvent(event, game, file)
          if (!text) return []
          const big = event.type === 'touchdown' || event.type === 'roundEnded' || event.type === 'roundStarted'
          // A round's first line takes the colour of the team with the initiative.
          const team = event.type === 'roundStarted' ? event.firstGo : null
          return [{ key: `${i}.${j}`, text, undone: entry.undone === true, big, team }]
        }),
      ),
    [file, game],
  )

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
            className={`${line.undone ? 'undone' : ''}${line.big ? ' big' : ''}${line.team ? ` round-start ${line.team}` : ''}`}
          >
            {line.text}
          </li>
        ))}
      </ol>
    </section>
  )
}
