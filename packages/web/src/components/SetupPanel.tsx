import { useMatch } from '../store'
import { playerName } from '../labels'

/** Setup: the team's bench, back-to-reserves, and End setup with the engine's reason when it isn't allowed. */
export function SetupPanel() {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const options = useMatch((s) => s.options)
  const selected = useMatch((s) => s.selected)
  const select = useMatch((s) => s.select)
  const send = useMatch((s) => s.send)
  if (game.pending) return null

  const team = game.turnOwner
  const kicking = team === game.kickingTeam
  const bench = Object.values(game.players).filter(
    (p) => p.team === team && p.hex === null && options.some((o) => o.command.type === 'place' && o.command.playerId === p.id),
  )
  const onPitch = Object.values(game.players).filter((p) => p.team === team && p.hex !== null).length
  const end = options.find((o) => o.command.type === 'endSetup')
  const unplace = selected ? options.find((o) => o.command.type === 'unplace' && o.command.playerId === selected) : undefined

  return (
    <section className="setup">
      <h2>
        {game.teams[team].name} set up {kicking ? '(kicking)' : '(receiving)'}
      </h2>
      <p className="hint">
        Tap a player, then a highlighted hex in your half. {onPitch} of {game.config.match.playersOnPitch} on the pitch.
      </p>
      <ul className="bench">
        {bench.map((p) => (
          <li key={p.id}>
            <button type="button" className={p.id === selected ? 'selected' : ''} data-bench={p.id} onClick={() => select(p.id)}>
              {playerName(file, p)}
              <span className="stats">
                MA {p.ma} · ST {p.st} · AG {p.ag}+ · TO {p.to}
                {p.skills.length > 0 && ` · ${p.skills.join(', ')}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        {unplace && (
          <button type="button" onClick={() => send(unplace.command)}>
            Back to reserves
          </button>
        )}
        {end && (
          <button type="button" className="primary" disabled={!end.available} title={end.available ? '' : end.reason} onClick={() => send(end.command)}>
            End setup
          </button>
        )}
      </div>
      {end && !end.available && <p className="reason">{end.reason}</p>}
    </section>
  )
}
