import { type GameEvent, previewRolls, type RollPreview } from '@orcball/engine'
import { useMatch } from '../store'

function PreviewTable({ preview }: { preview: RollPreview }) {
  const total = preview.modifiers.reduce((sum, m) => sum + m.value, 0)
  return (
    <div className="preview">
      <div className="preview-head">
        <span>{preview.test}</span>
        <span className="chance">{Math.round(preview.chance * 100)}%</span>
      </div>
      <table>
        <tbody>
          <tr>
            <td>Target</td>
            <td>{preview.target}+</td>
          </tr>
          {preview.modifiers.map((m) => (
            <tr key={m.name}>
              <td>{m.name}</td>
              <td>{m.value > 0 ? `+${m.value}` : `−${Math.abs(m.value)}`}</td>
            </tr>
          ))}
          {preview.modifiers.length > 1 && (
            <tr className="total">
              <td>Total</td>
              <td>{total >= 0 ? `+${total}` : `−${Math.abs(total)}`}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function lastRolls(events: GameEvent[]): string[] {
  return events.flatMap((e) => {
    if (e.type === 'rolled') {
      const total = e.modifiers.reduce((s, m) => s + m.value, 0)
      const shown = total === 0 ? `${e.natural}` : `${e.natural}${total > 0 ? '+' : '−'}${Math.abs(total)}`
      return [`${e.test}: rolled ${shown} vs ${e.target}+ — ${e.success ? 'success' : 'failed'}`]
    }
    if (e.type === 'armourRolled') return [`Armour: red ${e.red}, white ${e.white} — ${e.broken ? 'broken' : 'held'}`]
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
          {previews.map((p, i) => (
            <PreviewTable key={i} preview={p} />
          ))}
        </>
      )}
      {rolled.length > 0 && (
        <>
          <h2>Last roll</h2>
          <ul className="rolled">
            {rolled.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
