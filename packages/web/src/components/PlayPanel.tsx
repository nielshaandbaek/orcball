import { maxMovement } from '@orcball/engine'
import { ACTION_NAMES, playerName } from '../labels'
import { useMatch } from '../store'
import { ReasonButton } from './ReasonButton'

export { ACTION_NAMES }

/**
 * Wait and Momentum, the selected player's card, and the active player's
 * controls. Whose go it is, the players left and a double activation are in
 * the team boxes under the board (TeamBoxes, #178). Kept to what fits the bar (#128): the selected
 * player's actions are in his pop-up, and a greyed-out button's reason is its
 * tooltip.
 */
export function PlayPanel() {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const options = useMatch((s) => s.options)
  const selected = useMatch((s) => s.selected)
  const aiming = useMatch((s) => s.aiming)
  const leaping = useMatch((s) => s.leaping)
  const dispatch = useMatch((s) => s.dispatch)
  const setAiming = useMatch((s) => s.setAiming)
  const setLeaping = useMatch((s) => s.setLeaping)

  const find = (type: string) => options.find((o) => o.command.type === type)
  const buttons = game.activation ? null : goButtons()

  return (
    <section className="play">
      {buttons && <div className="play-status">{buttons}</div>}

      {game.activation ? activationControls() : goControls()}
    </section>
  )

  function goControls() {
    const player = selected ? game.players[selected] : null
    if (!player) return <p className="hint">Tap one of your players for his actions.</p>
    return (
      <div className="card">
        <strong>{playerName(file, player)}</strong>
        <span className="stats">
          {game.teams[player.team].name} · MA {player.ma} · ST {player.st} · AG {player.ag}+ · TO {player.to} · {player.status}
          {player.skills.length > 0 && ` · ${player.skills.join(', ')}`}
        </span>
      </div>
    )
  }

  /** Wait and Momentum, for the team whose go it is. */
  function goButtons() {
    const wait = find('wait')
    const momentum = find('spendMomentum')
    if (!wait && !momentum) return null
    return (
      <div className="row">
        {wait && (
          <button type="button" onClick={() => dispatch(wait.command)}>
            Wait
          </button>
        )}
        {momentum && (
          <ReasonButton reason={momentum.available ? null : momentum.reason} onClick={() => dispatch(momentum.command)}>
            Momentum: double activation
          </ReasonButton>
        )}
      </div>
    )
  }

  function activationControls() {
    const activation = game.activation!
    const player = game.players[activation.playerId]!
    const standUp = find('standUp')
    const end = find('endActivation')
    const cancel = find('cancelActivation')
    const canPass = options.some((o) => o.command.type === 'pass')
    const canLeap = options.some((o) => o.available && o.command.type === 'leap')
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
          {canLeap && (
            <button type="button" className={leaping ? 'selected' : ''} onClick={() => setLeaping(!leaping)}>
              {leaping ? 'Stop leaping' : 'Leap'}
            </button>
          )}
          {end && (
            <ReasonButton className="primary" reason={end.available ? null : end.reason} onClick={() => dispatch(end.command)}>
              End activation
            </ReasonButton>
          )}
          {cancel && (
            <button type="button" onClick={() => dispatch(cancel.command)}>
              Cancel
            </button>
          )}
        </div>
      </div>
    )
  }
}
