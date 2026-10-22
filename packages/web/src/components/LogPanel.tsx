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
          return text ? [{ key: `${i}.${j}`, text, undone: entry.undone === true, big: event.type === 'touchdown' || event.type === 'roundEnded' }] : []
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
          <li key={line.key} className={`${line.undone ? 'undone' : ''}${line.big ? ' big' : ''}`}>
            {line.text}
          </li>
        ))}
      </ol>
    </section>
  )
}
