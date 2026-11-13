import { type Hex, previewRolls, fromColRow, TEAM_SIDES, type TeamId, toColRow } from '@orcball/engine'
import { BOARD_HEIGHT, BOARD_WIDTH, hexCenter } from '../geometry'
import { playerName } from '../labels'
import { computerToAct, useMatch } from '../store'
import { ReasonButton } from './ReasonButton'
import { ACTION_NAMES } from './PlayPanel'
import { rollSummary } from './RollLine'

/** Where to show a prompt: next to the active player, or the first hex the decision is about. */
function anchorHex(): Hex | null {
  const { game, confirm } = useMatch.getState()
  if (!game) return null
  if (confirm && game.activation) return game.players[game.activation.playerId]!.hex
  if (!game.pending) return null
  // A catch is about the player the ball comes down on, whoever is activating.
  if (game.pending.kind === 'ball.catchOrLeave') return game.pending.choices.find((c) => c.hex)?.hex ?? null
  if (game.activation) return game.players[game.activation.playerId]!.hex
  return game.pending.choices.find((c) => c.hex)?.hex ?? null
}

/**
 * With nothing pending, a prompt next to the player the coach is playing
 * (#91), so a phone needn't scroll to the panel: the selected player's actions
 * on his team's go, or the active player's controls during his activation.
 */
function playerHex(): { hex: Hex; kind: 'actions' | 'activation' } | null {
  const { game, selected, options, controls } = useMatch.getState()
  if (!game || game.pending) return null
  if (game.phase === 'Activation' && game.activation) {
    // Open when the coach taps the player, or by itself once there's nothing left to do on the board.
    const onBoard = options.some((o) => o.available && (o.command.type === 'move' || o.command.type === 'pass' || 'targetId' in o.command))
    const hex = game.players[game.activation.playerId]!.hex
    return hex && (controls || !onBoard) ? { hex, kind: 'activation' } : null
  }
  if (game.phase !== 'Round' || !selected) return null
  const player = game.players[selected]!
  const canAct = options.some((o) => o.available && o.command.type === 'activate' && o.command.playerId === selected)
  return player.hex && player.team === game.turnOwner && canAct ? { hex: player.hex, kind: 'actions' } : null
}

/**
 * A small prompt next to the player on the board: a roll waiting for the
 * coach's go-ahead, a pending decision, or the player's actions and
 * controls. Never a modal: the board stays usable.
 */
export function BoardPrompt() {
  const game = useMatch((s) => s.game)!
  const confirm = useMatch((s) => s.confirm)
  const send = useMatch((s) => s.send)
  const go = useMatch((s) => s.confirmGo)
  const stop = useMatch((s) => s.confirmStop)
  const cancel = useMatch((s) => s.cancel)
  const computer = useMatch((s) => s.computer)
  // A decision the ball brings (a catch) waits until the ball has got there (#161).
  const ballMoving = useMatch((s) => s.ballMoving)
  // Subscribed so the prompt follows the selection, the options and aiming.
  useMatch((s) => s.selected)
  useMatch((s) => s.options)
  useMatch((s) => s.aiming)
  useMatch((s) => s.leaping)
  useMatch((s) => s.controls)
  if (computerToAct(game, computer) || ballMoving) return null
  const hex = anchorHex()
  if (!hex || (!confirm && !game.pending)) {
    const player = confirm ? null : playerHex()
    return player ? <PlayerPrompt hex={player.hex} kind={player.kind} /> : null
  }

  // Open on the side away from the hexes the prompt is about, so they stay tappable.
  const { style, flip } = placeBeside(hex, subjectHexes())

  if (confirm) {
    const label = confirm.command.type === 'move' ? (confirm.command.dodge ? 'Dodge' : 'Go') : confirm.previews[0]!.test
    return (
      <div ref={(el) => keepOnScreen(el)} className={`board-prompt${flip}`} style={style} role="dialog" aria-label="Roll">
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
  // Many choices that are all on the board (a touchback's players): a button
  // each would make a tall box over the very players to tap, so just say so.
  const tapOnly = pending.choices.length > 3 && pending.choices.every((c) => c.hex)
  return (
    <div ref={(el) => keepOnScreen(el)} className={`board-prompt${flip}`} style={style} role="dialog" aria-label={pending.prompt}>
      <div className="who">{game.teams[pending.team].name}</div>
      <div>{pending.prompt}</div>
      {tapOnly ? (
        <div className="hint" data-tap-only>
          Tap one of the marked players.
        </div>
      ) : (
        <div className="choices">
          {pending.choices.map((choice) => {
            const preview = previewRolls(game, { type: 'decide', choice: choice.id })[0]
            return (
              <button key={choice.id} type="button" onClick={() => send({ type: 'decide', choice: choice.id })} title={preview ? rollSummary(preview) : ''}>
                {choice.label}
                {choice.hex && pending.kind === 'blocking.push' ? ` ${at(choice.hex)}` : ''}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Shifts a prompt so it stays on the screen: on a phone a prompt beside a
 * player near an edge would otherwise be cut off, sideways or above the page
 * where no scrolling reaches it. A callback ref, passed as a new arrow each
 * render so it runs after every layout.
 */
function keepOnScreen(el: HTMLDivElement | null): void {
  if (!el) return
  el.style.marginLeft = '0px'
  el.style.marginTop = '0px'
  const { left, right, top, bottom } = el.getBoundingClientRect()
  el.style.marginLeft = `${shiftInto(left, right, document.documentElement.clientWidth)}px`
  el.style.marginTop = `${shiftInto(top, bottom, window.innerHeight)}px`
}

/** How far to move a span from..to so it lies within 0..size, less a margin; the start wins if it can't fit. */
export function shiftInto(from: number, to: number, size: number, margin = 4): number {
  if (from < margin) return margin - from
  if (to > size - margin) return Math.max(margin - from, size - margin - to)
  return 0
}

/** Where the prompt goes beside a hex: the CSS position, and whether it opens to the left. */
function placeBeside(hex: Hex, subjects: Hex[]): { style: { left: string; top: string }; flip: string } {
  const { x, y } = hexCenter(hex)
  const xs = subjects.map((h) => hexCenter(h).x)
  return { style: { left: `${(x / BOARD_WIDTH) * 100}%`, top: `${(y / BOARD_HEIGHT) * 100}%` }, flip: opensLeft(x, xs) ? ' flip' : '' }
}

/**
 * Whether a prompt beside a hex at x opens to the left: away from its subjects
 * (the hexes it is about), or with none, towards the wider side of the board.
 */
export function opensLeft(x: number, subjectXs: number[]): boolean {
  if (subjectXs.length === 0) return x > BOARD_WIDTH / 2
  return subjectXs.reduce((a, b) => a + b, 0) / subjectXs.length > x
}

/**
 * Where a player's prompt goes: behind him, towards his own end, since play
 * mostly goes forwards and the hexes ahead (up to the end zone) must stay
 * tappable. Away from any targets instead, and forwards when he's too close
 * to his own end for it to fit.
 */
function placeBehind(hex: Hex, team: TeamId, targets: Hex[]): { style: { left: string; top: string }; flip: string } {
  if (targets.length > 0) return placeBeside(hex, targets)
  const { x } = hexCenter(hex)
  const ownEndLeft = TEAM_SIDES[team] === 'left'
  const room = ownEndLeft ? x / BOARD_WIDTH : 1 - x / BOARD_WIDTH
  const left = room > 0.25 ? ownEndLeft : !ownEndLeft
  // placeBeside opens left (flip) when its subjects lie to the right.
  return placeBeside(hex, [hexAt(left ? 1 : -1, hex)])
}

/** A point to one side of a hex, as a subject for placeBeside: +1 to the right, −1 to the left. */
function hexAt(side: 1 | -1, hex: Hex): Hex {
  const { col, row } = toColRow(hex)
  return fromColRow({ col: col + side, row })
}

/** The selected player's actions, or the active player's controls (Stand up, Aim pass, Leap, End activation, Cancel). */
function PlayerPrompt({ hex, kind }: { hex: Hex; kind: 'actions' | 'activation' }) {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const options = useMatch((s) => s.options)
  const selected = useMatch((s) => s.selected)
  const aiming = useMatch((s) => s.aiming)
  const leaping = useMatch((s) => s.leaping)
  const dispatch = useMatch((s) => s.dispatch)
  const setAiming = useMatch((s) => s.setAiming)
  const setLeaping = useMatch((s) => s.setLeaping)
  const find = (type: string) => options.find((o) => o.available && o.command.type === type)

  if (kind === 'actions') {
    const player = game.players[selected!]!
    // Every action he could take, the ones not allowed now greyed out with the reason as a tooltip (#128).
    const actions = options.filter((o) => o.command.type === 'activate' && o.command.playerId === player.id)
    const { style, flip } = placeBehind(hex, player.team, [])
    return (
      <div ref={(el) => keepOnScreen(el)} className={`board-prompt player-prompt${flip}`} style={style} role="dialog" aria-label={`${playerName(file, player)}: actions`} data-player-prompt="actions">
        <div className="who">{playerName(file, player)}</div>
        <div className="choices">
          {actions.map((o) =>
            o.command.type === 'activate' ? (
              <ReasonButton key={o.command.action} reason={o.available ? null : o.reason} onClick={() => dispatch(o.command)}>
                {ACTION_NAMES[o.command.action]}
              </ReasonButton>
            ) : null,
          )}
        </div>
      </div>
    )
  }

  const activation = game.activation!
  const standUp = find('standUp')
  // End activation shows greyed out too, with the reason as a tooltip, as in the bar.
  const end = options.find((o) => o.command.type === 'endActivation')
  const cancel = find('cancelActivation')
  const canPass = options.some((o) => o.command.type === 'pass')
  const canLeap = options.some((o) => o.available && o.command.type === 'leap')
  if (!standUp && !end && !cancel && !canPass && !canLeap) return null
  // Clear of the players he can block, foul or hand off to.
  const targets = options.flatMap((o) => ('targetId' in o.command ? [game.players[o.command.targetId]?.hex ?? null] : [])).filter((h): h is Hex => h !== null)
  const { style, flip } = placeBehind(hex, game.players[activation.playerId]!.team, targets)
  return (
    <div ref={(el) => keepOnScreen(el)} className={`board-prompt player-prompt${flip}`} style={style} role="dialog" aria-label="Activation" data-player-prompt="activation">
      <div className="choices">
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

/** The hexes the prompt is about, which it must not cover: decision choices, or the confirmed move or pass target. */
function subjectHexes(): Hex[] {
  const { game, confirm } = useMatch.getState()
  if (confirm?.command.type === 'move' || confirm?.command.type === 'leap') return [confirm.command.to]
  if (confirm?.command.type === 'pass') return [confirm.command.target]
  return game?.pending?.choices.flatMap((c) => (c.hex ? [c.hex] : [])) ?? []
}

const at = (hex: Hex) => {
  const { col, row } = toColRow(hex)
  return `(${col}, ${row})`
}

/** True when the pending decision has a place on the board, so the side panel doesn't repeat it. */
export function decisionOnBoard(): boolean {
  return anchorHex() !== null
}
