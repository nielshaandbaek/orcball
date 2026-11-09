import { type ActionType, type GameState, maxMovement, type TeamId } from '@orcball/engine'
import { playerName } from '../labels'
import { useMatch } from '../store'
import { ReasonButton } from './ReasonButton'

export const ACTION_NAMES: Record<ActionType, string> = {
  move: 'Move',
  block: 'Block',
  blitz: 'Blitz',
  pass: 'Pass',
  handOff: 'Hand-off',
  foul: 'Foul',
}

/**
 * Whose go it is, Wait and Momentum, the selected player's card, and the
 * active player's controls. Kept to what fits the bar (#128): the selected
 * player's actions are in his pop-up, and a greyed-out button's reason is its
 * tooltip.
 */
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
      <div className="play-status">
        <h2 className={`turn ${team}`}>{game.teams[team].name}’ go</h2>
        {double && (
          <p className="badge">
            {game.teams[double.team].name}: double activation{double.left < 2 ? ' (one more)' : ''}
          </p>
        )}
        {!game.activation && <LeftToActivate game={game} team={team} />}
        {!game.activation && goButtons()}
      </div>

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

/** One dot per player the team still has to activate this round (#128). */
function LeftToActivate({ game, team }: { game: GameState; team: TeamId }) {
  const left = Object.values(game.players).filter((p) => p.team === team && p.hex && !p.activatedThisRound).length
  const label = `${left} player${left === 1 ? '' : 's'} left to activate`
  return (
    <p className={`left-dots ${team}`} role="img" aria-label={label} title={label} data-left={left}>
      {Array.from({ length: left }, (_, i) => (
        <span key={i} className="dot" />
      ))}
    </p>
  )
}
