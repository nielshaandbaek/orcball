import { useMatch } from '../store'

/** The pending decision's prompt and its answers, as buttons. Hex choices can also be tapped on the board. */
export function DecisionPrompt() {
  const game = useMatch((s) => s.game)!
  const send = useMatch((s) => s.send)
  const pending = game.pending
  if (!pending) return null
  const team = game.teams[pending.team].name
  return (
    <section className="decision" aria-live="polite">
      <div className="decision-team">{team} to answer</div>
      <p>{pending.prompt}</p>
      <div className="choices">
        {pending.choices.map((choice) => (
          <button key={choice.id} type="button" onClick={() => send({ type: 'decide', choice: choice.id })}>
            {choice.label}
          </button>
        ))}
      </div>
    </section>
  )
}
