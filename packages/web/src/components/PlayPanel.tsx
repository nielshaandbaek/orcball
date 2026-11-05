import { type ActionType, maxMovement, TEAMS } from '@orcball/engine'
import { playerName } from '../labels'
import { useMatch } from '../store'

export const ACTION_NAMES: Record<ActionType, string> = {
  move: 'Move',
  block: 'Block',
  blitz: 'Blitz',
  pass: 'Pass',
  handOff: 'Hand-off',
  foul: 'Foul',
}

const ACTIVATION_HINTS: Record<ActionType, string> = {
  move: 'Tap a shaded hex to move there.',
  block: 'Tap an adjacent opponent to block.',
  blitz: 'Move, then tap an adjacent opponent to block (1 hex of MA).',
  pass: 'Move, then aim and tap a hex to throw.',
  handOff: 'Move, then tap an adjacent teammate.',
  foul: 'Move, then tap an adjacent opponent who is down.',
}

/** Whose go it is, Momentum, the selected player's actions, and the active player's options. */
export function PlayPanel() {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const options = useMatch((s) => s.options)
  const selected = useMatch((s) => s.selected)
  const aiming = useMatch((s) => s.aiming)
  const dispatch = useMatch((s) => s.dispatch)
  const setAiming = useMatch((s) => s.setAiming)

  const team = game.turnOwner
  const double = game.doubleActivation
  const find = (type: string) => options.find((o) => o.command.type === type)

  return (
    <section className="play">
      <h2 className={`turn ${team}`}>{game.teams[team].name}’ go</h2>
      {double && (
        <p className="badge">
          {game.teams[double.team].name}: double activation{double.left < 2 ? ' (one more)' : ''}
        </p>
      )}
      <dl className="momentum">
        {TEAMS.map((t) => (
          <div key={t}>
            <dt>{game.teams[t].name} Momentum</dt>
            <dd>
              {game.teams[t].momentum}
              {game.teams[t].momentumUsedThisRound && ' (used this round)'}
            </dd>
          </div>
        ))}
      </dl>

      {game.activation ? activationControls() : goControls()}
    </section>
  )

  function goControls() {
    const player = selected ? game.players[selected] : null
    const actions = player ? options.filter((o) => o.command.type === 'activate' && o.command.playerId === player.id) : []
    const wait = find('wait')
    const momentum = find('spendMomentum')
    const left = Object.values(game.players).filter((p) => p.team === team && p.hex && !p.activatedThisRound).length
    return (
      <>
        <p className="hint">{left} player{left === 1 ? '' : 's'} left to activate. Tap one of yours to see its actions.</p>
        {player && (
          <div className="card">
            <strong>{playerName(file, player)}</strong>
            <span className="stats">
              {game.teams[player.team].name} · MA {player.ma} · ST {player.st} · AG {player.ag}+ · TO {player.to} · {player.status}
              {player.skills.length > 0 && ` · ${player.skills.join(', ')}`}
            </span>
            {actions.length > 0 && (
              <div className="actions">
                {actions.map((o) =>
                  o.command.type === 'activate' ? (
                    <button
                      key={o.command.action}
                      type="button"
                      disabled={!o.available}
                      title={o.available ? '' : o.reason}
                      onClick={() => dispatch(o.command)}
                    >
                      {ACTION_NAMES[o.command.action]}
                    </button>
                  ) : null,
                )}
              </div>
            )}
            {actions.some((o) => !o.available) && (
              <ul className="reasons">
                {actions.flatMap((o) => (!o.available && o.command.type === 'activate' ? [<li key={o.command.action}>{ACTION_NAMES[o.command.action]}: {o.reason}</li>] : []))}
              </ul>
            )}
          </div>
        )}
        <div className="row">
          {wait && (
            <button type="button" onClick={() => dispatch(wait.command)}>
              Wait
            </button>
          )}
          {momentum && (
            <button type="button" disabled={!momentum.available} title={momentum.available ? '' : momentum.reason} onClick={() => dispatch(momentum.command)}>
              Momentum: double activation
            </button>
          )}
        </div>
        {momentum && !momentum.available && <p className="reason">{momentum.reason}</p>}
      </>
    )
  }

  function activationControls() {
    const activation = game.activation!
    const player = game.players[activation.playerId]!
    const standUp = find('standUp')
    const end = find('endActivation')
    const canPass = options.some((o) => o.command.type === 'pass')
    return (
      <div className="card active">
        <strong>
          {playerName(file, player)}: {ACTION_NAMES[activation.action]}
        </strong>
        <span className="stats">
          MA used {activation.maUsed} of {player.ma}
          {maxMovement(game, player) > player.ma && ` (+${maxMovement(game, player) - player.ma} Sprint)`}
          {activation.stopped && ' · stopped in a tackle zone'}
        </span>
        <p className="hint">{ACTIVATION_HINTS[activation.action]}</p>
        <div className="actions">
          {standUp && (
            <button type="button" onClick={() => dispatch(standUp.command)}>
              Stand up
            </button>
          )}
          {canPass && (
            <button type="button" className={aiming ? 'selected' : ''} onClick={() => setAiming(!aiming)}>
              {aiming ? 'Stop aiming' : 'Aim pass'}
            </button>
          )}
          {end && (
            <button type="button" className="primary" onClick={() => dispatch(end.command)}>
              End activation
            </button>
          )}
        </div>
      </div>
    )
  }
}
