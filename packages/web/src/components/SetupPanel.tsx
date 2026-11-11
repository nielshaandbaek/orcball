import { TEAM_SIDES } from '@orcball/engine'
import { useEffect, useState } from 'react'
import { playerName } from '../labels'
import { useMatch } from '../store'
import { ReasonButton } from './ReasonButton'

/** How long Peek hides the bench for. */
export const PEEK_MS = 2000

/**
 * Setup: the team's bench, back-to-reserves, and End setup (greyed out with
 * the engine's reason as its tooltip when it isn't allowed).
 *
 * On wide screens (#128) it lies over the other team's half of the board, see-through,
 * instead of in the bar under it, so the bar stays one size; Peek hides it for
 * a moment to see how the other team has set up.
 */
export function SetupPanel({ overlay = false }: { overlay?: boolean }) {
  const [peeking, setPeeking] = useState(false)
  useEffect(() => {
    if (!peeking) return
    const timer = setTimeout(() => setPeeking(false), PEEK_MS)
    return () => clearTimeout(timer)
  }, [peeking])
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
    <section
      className={`setup${overlay ? ` setup-overlay over-${TEAM_SIDES[team] === 'left' ? 'right' : 'left'}` : ''}${peeking ? ' peeking' : ''}`}
      data-setup-overlay={overlay || undefined}
    >
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
        {overlay && (
          <button type="button" className="quiet" data-peek onClick={() => setPeeking(true)} title="Hide this for a moment to see the pitch under it">
            Peek
          </button>
        )}
        {end && (
          <ReasonButton className="primary" reason={end.available ? null : end.reason} onClick={() => send(end.command)}>
            End setup
          </ReasonButton>
        )}
      </div>
    </section>
  )
}
