import { useMatch } from '../store'
import { Board } from './Board'
import { decisionOnBoard } from './BoardPrompt'
import { DecisionPrompt } from './DecisionPrompt'
import { LogPanel } from './LogPanel'
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
  const { home, away } = game.teams
  const inPlay = game.phase === 'Round' || game.phase === 'Activation'

  return (
    <div className="match">
      <header className="scorebar">
        <span className="team home">{home.name}</span>
        <span className="score" data-score>
          {home.score} – {away.score}
        </span>
        <span className="team away">{away.name}</span>
        <span className="when" data-when>
          Rules {game.config.id.replace('rules-', '')} · Half {game.half}
          {game.round > 0 && ` · Round ${game.round}`}
          {!inPlay && ` · ${PHASES[game.phase]}`}
        </span>
        <button type="button" className="quiet" onClick={quit}>
          New match
        </button>
      </header>
      <div className="layout">
        <div className="board-wrap">
          <Board />
          <p className="message" role="status">
            {message ?? ' '}
          </p>
        </div>
        <aside className="panel">
          {game.pending && !decisionOnBoard() && <DecisionPrompt />}
          {game.phase === 'Setup' && <SetupPanel />}
          {game.phase === 'KickOff' && !game.pending && (
            <section>
              <h2>{game.teams[game.kickingTeam].name} kick off</h2>
              <p className="hint">Tap a highlighted hex in the receiving team’s half.</p>
            </section>
          )}
          {inPlay && <PlayPanel />}
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
          <LogPanel />
        </aside>
      </div>
    </div>
  )
}
