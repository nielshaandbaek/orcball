import { useMatch } from '../store'
import { Board } from './Board'
import { DecisionPrompt } from './DecisionPrompt'
import { SetupPanel } from './SetupPanel'

const PHASES: Record<string, string> = {
  Setup: 'Setup',
  KickOff: 'Kick-off',
  Round: 'Round',
  Activation: 'Round',
  HalfTime: 'Half time',
  FullTime: 'Full time',
  Touchdown: 'Touchdown',
}

export function MatchScreen() {
  const game = useMatch((s) => s.game)!
  const message = useMatch((s) => s.message)
  const quit = useMatch((s) => s.quit)
  const { home, away } = game.teams

  return (
    <div className="match">
      <header className="scorebar">
        <span className="team home">{home.name}</span>
        <span className="score">
          {home.score} – {away.score}
        </span>
        <span className="team away">{away.name}</span>
        <span className="when">
          Half {game.half}
          {game.round > 0 && ` · Round ${game.round}`}
          {game.phase !== 'Round' && game.phase !== 'Activation' && ` · ${PHASES[game.phase]}`}
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
          <DecisionPrompt />
          {game.phase === 'Setup' && <SetupPanel />}
          {game.phase === 'KickOff' && !game.pending && (
            <section>
              <h2>{game.teams[game.kickingTeam].name} kick off</h2>
              <p className="hint">Tap a highlighted hex in the receiving team’s half.</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
