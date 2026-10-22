import { useEffect, useMemo, useRef } from 'react'
import { describeEvent } from '../describe'
import { useMatch } from '../store'

/** The match so far in plain words, newest at the bottom. Undone actions are struck through. */
export function LogPanel() {
  const file = useMatch((s) => s.file)!
  const game = useMatch((s) => s.game)!
  const end = useRef<HTMLDivElement>(null)

  const lines = useMemo(
    () =>
      file.entries.flatMap((entry, i) =>
        entry.events.flatMap((event, j) => {
          const text = describeEvent(event, game, file)
          return text ? [{ key: `${i}.${j}`, text, undone: entry.undone === true, big: event.type === 'touchdown' || event.type === 'roundEnded' }] : []
        }),
      ),
    [file, game],
  )

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [lines.length])

  return (
    <section className="log">
      <h2>Match log</h2>
      <ol className="log-lines" aria-live="polite">
        {lines.length === 0 && <li className="muted">Nothing yet.</li>}
        {lines.map((line) => (
          <li key={line.key} className={`${line.undone ? 'undone' : ''}${line.big ? ' big' : ''}`}>
            {line.text}
          </li>
        ))}
      </ol>
      <div ref={end} aria-hidden="true" />
    </section>
  )
}
