import { computerToAct, LEVEL_LABELS, useMatch } from '../store'
import { Board } from './Board'
import { decisionOnBoard } from './BoardPrompt'
import { DecisionPrompt } from './DecisionPrompt'
import { FullscreenButton } from './FullscreenButton'
import { LogButton, LogDialog, LogTicker } from './LogPanel'
import { MatchTools } from './MatchTools'
import { PlayPanel } from './PlayPanel'
import { RollPanel } from './RollPanel'
import { SetupPanel } from './SetupPanel'

const PHASES: Record<string, string> = {
  Setup: 'Setup',
  KickOff: 'Kick-off',
  HalfTime: 'Half time',
  FullTime: 'Full time',
  Touchdown: 'Touchdown',
}

export function MatchScreen() {
  const game = useMatch((s) => s.game)!
  const message = useMatch((s) => s.message)
  const quit = useMatch((s) => s.quit)
  const computer = useMatch((s) => s.computer)
  const thinking = useMatch((s) => s.thinking)
  const { home, away } = game.teams
  // While the computer acts, the human's controls give way to a note saying so.
  const computerActs = computerToAct(game, computer)
  const inPlay = game.phase === 'Round' || game.phase === 'Activation'

  return (
    <div className="match">
      <header className="scorebar">
        <span className="team home">
          {home.name}
          {computer?.team === 'home' && <span className="computer-tag"> (computer)</span>}
        </span>
        <span className="score" data-score>
          {home.score} – {away.score}
        </span>
        <span className="team away">
          {away.name}
          {computer?.team === 'away' && <span className="computer-tag"> (computer)</span>}
        </span>
        <span className="when" data-when>
          Rules {game.config.id.replace('rules-', '')} · Half {game.half}
          {game.round > 0 && (
            <>
              {' · '}
              <span className={`round ${game.firstGo}`} title={`${game.teams[game.firstGo].name} have the initiative`}>
                Round {game.round}
              </span>
            </>
          )}
          {!inPlay && ` · ${PHASES[game.phase]}`}
        </span>
        <LogButton />
        <FullscreenButton />
        <button type="button" className="quiet" onClick={quit}>
          New match
        </button>
      </header>
      <div className="layout">
        <div className="board-wrap">
          <Board />
          <LogTicker />
          <p className="message" role="status">
            {message ?? ' '}
          </p>
        </div>
        <aside className="panel">
          {computerActs && computer && (
            <section className="computer-turn" data-computer-turn>
              <h2>
                {game.teams[computer.team].name} ({LEVEL_LABELS[computer.level]}) {thinking ? 'thinking…' : 'playing'}
              </h2>
              <p className="hint">The computer is playing. Its reasons appear in the match log.</p>
            </section>
          )}
          {!computerActs && game.pending && !decisionOnBoard() && <DecisionPrompt />}
          {!computerActs && game.phase === 'Setup' && <SetupPanel />}
          {!computerActs && game.phase === 'KickOff' && !game.pending && (
            <section>
              <h2>{game.teams[game.kickingTeam].name} kick off</h2>
              <p className="hint">Tap a highlighted hex in the receiving team’s half.</p>
            </section>
          )}
          {!computerActs && inPlay && <PlayPanel />}
          {game.phase === 'FullTime' && (
            <section className="result">
              <h2>Full time</h2>
              <p>
                {game.winner === 'draw'
                  ? `A draw, ${home.score}–${away.score}.`
                  : `${game.teams[game.winner!].name} win ${Math.max(home.score, away.score)}–${Math.min(home.score, away.score)}.`}
              </p>
              <button type="button" className="primary" onClick={quit}>
                New match
              </button>
            </section>
          )}
          <RollPanel />
          <MatchTools />
        </aside>
      </div>
      <LogDialog />
    </div>
  )
}
