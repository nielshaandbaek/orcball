import { type Hex, previewRolls } from '@orcball/engine'
import { BOARD_HEIGHT, BOARD_WIDTH, hexCenter } from '../geometry'
import { useMatch } from '../store'
import { rollSummary } from './RollLine'

/** Where to show a prompt: next to the active player, or the first hex the decision is about. */
function anchorHex(): Hex | null {
  const { game, confirm } = useMatch.getState()
  if (!game) return null
  if (confirm && game.activation) return game.players[game.activation.playerId]!.hex
  if (!game.pending) return null
  if (game.activation) return game.players[game.activation.playerId]!.hex
  return game.pending.choices.find((c) => c.hex)?.hex ?? null
}

/**
 * A small prompt next to the player on the board: a roll waiting for the
 * coach's go-ahead, or a pending decision. Never a modal: the board stays usable.
 */
export function BoardPrompt() {
  const game = useMatch((s) => s.game)!
  const confirm = useMatch((s) => s.confirm)
  const send = useMatch((s) => s.send)
  const go = useMatch((s) => s.confirmGo)
  const stop = useMatch((s) => s.confirmStop)
  const cancel = useMatch((s) => s.cancel)
  const hex = anchorHex()
  if (!hex || (!confirm && !game.pending)) return null

  const { x, y } = hexCenter(hex)
  const style = {
    left: `${(x / BOARD_WIDTH) * 100}%`,
    top: `${(y / BOARD_HEIGHT) * 100}%`,
  }
  const flip = x / BOARD_WIDTH > 0.6 ? ' flip' : ''

  if (confirm) {
    const label = confirm.command.type === 'move' ? (confirm.command.dodge ? 'Dodge' : 'Go') : confirm.previews[0]!.test
    return (
      <div className={`board-prompt${flip}`} style={style} role="dialog" aria-label="Roll">
        {confirm.previews.map((p, i) => (
          <div key={i} className="odds">
            {rollSummary(p)}
          </div>
        ))}
        <div className="choices">
          <button type="button" className="primary" onClick={go}>
            {label} ({confirm.previews.map((p) => `${Math.round(p.chance * 100)}%`).join(', then ')})
          </button>
          {confirm.stopInstead && (
            <button type="button" onClick={stop}>
              Stop here
            </button>
          )}
          <button type="button" className="quiet" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const pending = game.pending!
  return (
    <div className={`board-prompt${flip}`} style={style} role="dialog" aria-label={pending.prompt}>
      <div className="who">{game.teams[pending.team].name}</div>
      <div>{pending.prompt}</div>
      <div className="choices">
        {pending.choices.map((choice) => {
          const preview = previewRolls(game, { type: 'decide', choice: choice.id })[0]
          return (
            <button key={choice.id} type="button" onClick={() => send({ type: 'decide', choice: choice.id })} title={preview ? rollSummary(preview) : ''}>
              {choice.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** True when the pending decision has a place on the board, so the side panel doesn't repeat it. */
export function decisionOnBoard(): boolean {
  return anchorHex() !== null
}
