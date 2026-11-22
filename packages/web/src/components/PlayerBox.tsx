import { maxMovement } from '@orcball/engine'
import { ACTION_NAMES, playerName, skillsText } from '../labels'
import { useMatch } from '../store'

/**
 * The selected player under the board (#253), or the active one during an
 * activation: his team and name, then his stats, status and skills, and in
 * his activation the action and the MA he has used. Always two lines, so the
 * box never changes size.
 */
export function PlayerBox() {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const selected = useMatch((s) => s.selected)
  const activation = game.activation
  const player = activation ? game.players[activation.playerId]! : selected ? game.players[selected] : null
  if (!player) {
    return (
      <div className="card player-box empty">
        <span className="muted">Tap a player to see him here.</span>
      </div>
    )
  }
  const active = activation?.playerId === player.id
  const sprint = maxMovement(game, player) - player.ma
  return (
    <div className={`card player-box ${player.team}${active ? ' active' : ''}`}>
      <strong className="player-name">
        {game.teams[player.team].name} {playerName(file, player)}
        {active && `: ${ACTION_NAMES[activation!.action]}`}
      </strong>
      <span className="stats">
        {active && (
          <>
            MA used {activation!.maUsed} of {player.ma}
            {sprint > 0 && ` (+${sprint} Sprint)`}
            {activation!.stopped && ' · stopped in a tackle zone'}
            {' · '}
          </>
        )}
        MA {player.ma} · ST {player.st} · AG {player.ag}+ · TO {player.to}
        {player.status !== 'standing' && ` · ${player.status}`}
        {player.skills.length > 0 && ` · ${skillsText(file, player)}`}
      </span>
    </div>
  )
}
