import { type GameEvent, previewRolls, type RollPreview } from '@orcball/engine'
import { useMatch } from '../store'

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`)

/**
 * The odds for one roll on one line: the test, its target and chance, and the
 * modifiers after it (cut short if they don't fit; all of them in the tooltip).
 */
function PreviewLine({ preview }: { preview: RollPreview }) {
  const modifiers = preview.modifiers.map((m) => `${m.name} ${signed(m.value)}`).join(', ')
  const title = `${preview.test}: ${preview.target}+${modifiers ? ` (${modifiers})` : ''}, ${Math.round(preview.chance * 100)}%`
  return (
    <li className="preview" title={title}>
      <span className="test">{preview.test}</span> <span className="target">{preview.target}+</span>{' '}
      <span className="chance">{Math.round(preview.chance * 100)}%</span>
      {modifiers && <span className="modifiers"> {modifiers}</span>}
    </li>
  )
}

function lastRolls(events: GameEvent[]): string[] {
  return events.flatMap((e) => {
    if (e.type === 'rolled') {
      const total = e.modifiers.reduce((s, m) => s + m.value, 0)
      const shown = total === 0 ? `${e.natural}` : `${e.natural}${total > 0 ? '+' : '−'}${Math.abs(total)}`
      return [`${e.test}: rolled ${shown} vs ${e.target}+ — ${e.success ? 'success' : 'failed'}`]
    }
    if (e.type === 'armourRolled') {
      const crushing = [...e.modifiers, ...(e.injuryModifiers ?? [])].some((m) => m.name === 'Crushing Blow') ? ' (Crushing Blow +1)' : ''
      return [`Armour: red ${e.red}, white ${e.white} — ${e.broken ? 'broken' : 'held'}${crushing}`]
    }
    if (e.type === 'injuryRolled') return [`Injury (crowd): white ${e.white}`]
    return []
  })
}

/** The odds for the roll about to happen (both coaches can see them), and the dice just rolled. */
export function RollPanel() {
  const game = useMatch((s) => s.game)!
  const confirm = useMatch((s) => s.confirm)
  const lastEvents = useMatch((s) => s.lastEvents)

  let previews: RollPreview[] = confirm?.previews ?? []
  if (previews.length === 0 && game.pending) {
    previews = game.pending.choices.flatMap((c) => previewRolls(game, { type: 'decide', choice: c.id }))
  }
  const rolled = lastRolls(lastEvents)
  if (previews.length === 0 && rolled.length === 0) return null

  return (
    <section className="rolls">
      {previews.length > 0 && (
        <>
          <h2>Roll preview</h2>
          <ul className="previews">
            {previews.map((p, i) => (
              <PreviewLine key={i} preview={p} />
            ))}
          </ul>
        </>
      )}
      {rolled.length > 0 && (
        <>
          <h2>Last roll</h2>
          <ul className="rolled">
            {rolled.map((r, i) => (
              <li key={i} title={r}>
                {r}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
