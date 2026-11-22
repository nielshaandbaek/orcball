import { useEffect } from 'react'
import { useMatch } from '../store'

/**
 * A replay in the score bar (#188, #253): that it is one, the command it's at,
 * Play on at the end (carries on the match) and Leave. ← and → step, and the
 * space bar plays or pauses. The steps are in the command slots (ReplaySteps).
 */
export function ReplayHead() {
  const replay = useMatch((s) => s.replay)!
  const step = useMatch((s) => s.replayStep)
  const jump = useMatch((s) => s.replayJump)
  const play = useMatch((s) => s.replayPlay)
  const playOn = useMatch((s) => s.playOn)
  const quit = useMatch((s) => s.quit)
  const { at, playing, activations, rounds } = replay
  const total = replay.commands.length
  const atStart = at === 0
  const atEnd = at === total

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return
      const store = useMatch.getState()
      if (!store.replay || store.logOpen) return
      if (e.key === 'ArrowRight') store.replayStep(1)
      else if (e.key === 'ArrowLeft') store.replayStep(-1)
      else if (e.key === ' ') store.replayPlay(!store.replay.playing)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <span className="replay-head" data-replay>
      <strong>Replay</strong>{' '}
      <span className="replay-at" data-replay-at>
        Command {at} of {total}
      </span>
      {atEnd && (
        <button type="button" id="play-on" onClick={playOn} title="Carry on playing this match hot-seat">
          Play on
        </button>
      )}
      <button type="button" id="replay-leave" className="quiet" onClick={quit}>
        Leave
      </button>
    </span>
  )
}

/**
 * A replay's steps as symbols (#253), in the command slots under the board:
 * the previous round and activation, one command back, play or pause, one
 * forward, the next activation and round. Their names are in the tooltips.
 */
export function ReplaySteps() {
  const replay = useMatch((s) => s.replay)!
  const step = useMatch((s) => s.replayStep)
  const jump = useMatch((s) => s.replayJump)
  const play = useMatch((s) => s.replayPlay)
  const { at, playing, activations, rounds } = replay
  const atStart = at === 0
  const atEnd = at === replay.commands.length
  return (
    <div className="replay-steps" role="toolbar" aria-label="Replay">
      <button type="button" id="replay-prev-round" onClick={() => jump('round', -1)} disabled={atStart} title="To the start of this round, or the one before" aria-label="Round back">
        «
      </button>
      <button type="button" id="replay-prev-activation" onClick={() => jump('activation', -1)} disabled={!activations.some((m) => m < at)} title="To the start of the activation before" aria-label="Activation back">
        ‹‹
      </button>
      <button type="button" id="replay-back" onClick={() => step(-1)} disabled={atStart} title="One command back (←)" aria-label="Back">
        ‹
      </button>
      <button type="button" id="replay-play" className="primary" onClick={() => play(!playing)} disabled={atEnd} title="Play or pause (space)" aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button type="button" id="replay-forward" onClick={() => step(1)} disabled={atEnd} title="One command forward (→)" aria-label="Forward">
        ›
      </button>
      <button type="button" id="replay-next-activation" onClick={() => jump('activation', 1)} disabled={!activations.some((m) => m > at)} title="To the start of the next activation" aria-label="Activation forward">
        ››
      </button>
      <button type="button" id="replay-next-round" onClick={() => jump('round', 1)} disabled={!rounds.some((m) => m > at)} title="To the start of the next round" aria-label="Round forward">
        »
      </button>
    </div>
  )
}
