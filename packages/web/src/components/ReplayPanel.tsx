import { useEffect } from 'react'
import { useMatch } from '../store'

/**
 * The controls of a replay (#188): one command back or forward, the previous
 * or next activation and round, Auto-play, and leaving it. ← and → step, and
 * the space bar plays or pauses. At the end, Play on carries on the match.
 */
export function ReplayPanel() {
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
    <section className="replay" data-replay>
      <div className="replay-head">
        <h2>
          Replay <span className="replay-at" data-replay-at>Command {at} of {total}</span>
        </h2>
        {atEnd && (
          <button type="button" id="play-on" onClick={playOn} title="Carry on playing this match hot-seat">
            Play on
          </button>
        )}
        <button type="button" id="replay-leave" className="quiet" onClick={quit}>
          Leave replay
        </button>
      </div>
      <div className="row replay-steps">
        <button type="button" id="replay-prev-round" onClick={() => jump('round', -1)} disabled={atStart} title="To the start of this round, or the one before">
          « Round
        </button>
        <button type="button" id="replay-prev-activation" onClick={() => jump('activation', -1)} disabled={!activations.some((m) => m < at)} title="To the start of the activation before">
          ‹ Activation
        </button>
        <button type="button" id="replay-back" onClick={() => step(-1)} disabled={atStart} title="One command back (←)" aria-label="Back">
          ‹
        </button>
        <button type="button" id="replay-play" className="primary" onClick={() => play(!playing)} disabled={atEnd} title="Play or pause (space)">
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" id="replay-forward" onClick={() => step(1)} disabled={atEnd} title="One command forward (→)" aria-label="Forward">
          ›
        </button>
        <button type="button" id="replay-next-activation" onClick={() => jump('activation', 1)} disabled={!activations.some((m) => m > at)} title="To the start of the next activation">
          Activation ›
        </button>
        <button type="button" id="replay-next-round" onClick={() => jump('round', 1)} disabled={!rounds.some((m) => m > at)} title="To the start of the next round">
          Round »
        </button>
      </div>
    </section>
  )
}
