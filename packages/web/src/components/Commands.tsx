import { useEffect, useState } from 'react'
import { stunnedToTurn } from '../interaction'
import { playerName } from '../labels'
import { computerToAct, useMatch } from '../store'
import { ReasonButton } from './ReasonButton'

/**
 * The commands under the board (#253), in three fixed slots so they never
 * move: Undo (always there, greyed out with the reason when it can't be
 * used), then on the team's go Wait and Momentum. Everything else is a
 * pop-up on the board. Wait asks first while a stunned player could still
 * turn face up: it becomes "Wait anyway" and Momentum's slot "Cancel", and
 * the question goes to the message line (`onAsk`), so the slots keep their size.
 * In the pop-up on an empty hex (#258, `inPopup`) the question shows in the
 * pop-up itself, and Undo has no id (the row under the board has #undo).
 */
export function Commands({ onAsk, inPopup = false }: { onAsk?: (question: string | null) => void; inPopup?: boolean }) {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const options = useMatch((s) => s.options)
  const dispatch = useMatch((s) => s.dispatch)
  const undoReason = useMatch((s) => s.undoReason)
  const undo = useMatch((s) => s.undo)
  const computer = useMatch((s) => s.computer)
  const held = useMatch((s) => s.held !== null)
  const [asking, setAsking] = useState(false)
  const [question, setQuestion] = useState<string | null>(null)
  const say = (text: string | null) => (onAsk ? onAsk(text) : setQuestion(text))
  // Anything else happening (an activation, the other team's go) drops the question.
  useEffect(() => {
    setAsking(false)
    setQuestion(null)
    onAsk?.(null)
  }, [game, onAsk])

  const onGo = (game.phase === 'Round' || game.phase === 'Activation') && !game.activation && !computerToAct(game, computer) && !held
  const wait = onGo ? options.find((o) => o.command.type === 'wait') : undefined
  const momentum = onGo ? options.find((o) => o.command.type === 'spendMomentum') : undefined
  const ask = (on: boolean) => {
    setAsking(on)
    if (!on) return say(null)
    const names = stunnedToTurn(game, options).map((id) => playerName(file, game.players[id]!))
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    say(`${list} ${names.length === 1 ? 'is' : 'are'} still stunned: Wait anyway?`)
  }

  return (
    <div className={`commands${inPopup ? ' in-popup' : ''}`} role="toolbar" aria-label="Commands">
      {inPopup && question && <p className="ask">{question}</p>}
      <span className="slot">
        <ReasonButton {...(inPopup ? {} : { id: 'undo' })} className="undo" reason={undoReason} title="Undo the last action" onClick={undo}>
          Undo
        </ReasonButton>
      </span>
      <span className="slot">
        {wait &&
          (asking ? (
            <button type="button" data-ask-wait onClick={() => dispatch(wait.command)}>
              Wait anyway
            </button>
          ) : (
            <button type="button" onClick={() => (stunnedToTurn(game, options).length > 0 ? ask(true) : dispatch(wait.command))}>
              Wait
            </button>
          ))}
      </span>
      <span className="slot">
        {wait && asking ? (
          <button type="button" className="quiet" onClick={() => ask(false)}>
            Cancel
          </button>
        ) : (
          momentum && (
            <ReasonButton reason={momentum.available ? null : momentum.reason} title="Spend Momentum: a double activation" onClick={() => dispatch(momentum.command)}>
              Momentum
            </ReasonButton>
          )
        )}
      </span>
    </div>
  )
}
