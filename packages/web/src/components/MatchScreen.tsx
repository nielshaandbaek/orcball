import type { TeamId } from '@orcball/engine'
import type { CSSProperties } from 'react'
import { BOARD_HEIGHT, BOARD_WIDTH } from '../geometry'
import { computerToAct, LEVEL_LABELS, useMatch } from '../store'
import { Board } from './Board'
import { decisionOnBoard } from './BoardPrompt'
import { DecisionPrompt } from './DecisionPrompt'
import { FullscreenButton } from './FullscreenButton'
import { LogButton, LogDialog, LogTicker } from './LogPanel'
import { MatchMenu } from './MatchMenu'
import { MatchTools } from './MatchTools'
import { PlayPanel } from './PlayPanel'
import { RollPanel } from './RollPanel'
import { SetupPanel } from './SetupPanel'
import { TeamBoxes } from './TeamBoxes'
import { useWide } from '../wide'

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
  // A decision the ball brings waits until it has got there (#161).
  const ballMoving = useMatch((s) => s.ballMoving)
  const thinking = useMatch((s) => s.thinking)
  const { home, away } = game.teams
  // While the computer acts, the human's controls give way to a note saying so.
  const computerActs = computerToAct(game, computer)
  const inPlay = game.phase === 'Round' || game.phase === 'Activation'
  // On wide screens the bench lies over the board instead of in the bar.
  const wide = useWide()
  const setup = !computerActs && game.phase === 'Setup'

  return (
    <div className="match">
      <header className="scorebar">
        <span className="team home">
          {home.name}
          {computer?.team === 'home' && <span className="computer-tag"> (computer)</span>}
        </span>
        <MomentumTokens team="home" />
        <span className="score" data-score>
          {home.score} – {away.score}
        </span>
        <MomentumTokens team="away" />
        <span className="team away">
          {away.name}
          {computer?.team === 'away' && <span className="computer-tag"> (computer)</span>}
        </span>
        <span className="when" data-when>
          Rules {game.config.id.replace('rules-', '')}
          {/* No half to name in a match of one run of rounds (v20, #135). */}
          {game.config.match.halves > 1 && ` · Half ${game.half}`}
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
        <MatchMenu />
      </header>
      <div className="layout">
        {/* The board as big as fits its area (#128): the area is a size container, the board keeps its shape. */}
        <div className="board-area" style={{ '--board-ratio': BOARD_WIDTH / BOARD_HEIGHT } as CSSProperties}>
          <div className="board-wrap">
            <Board />
            {setup && wide && <SetupPanel overlay />}
          </div>
        </div>
        <div className="board-foot">
          <LogTicker />
          <TeamBoxes />
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
            </section>
          )}
          {!computerActs && !ballMoving && game.pending && !decisionOnBoard() && <DecisionPrompt />}
          {setup && !wide && <SetupPanel />}
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

/** A team's Momentum as tokens beside its score (#128): one per token left. */
function MomentumTokens({ team }: { team: TeamId }) {
  const { name, momentum, momentumUsedThisRound } = useMatch((s) => s.game!.teams[team])
  const label = `${name} Momentum: ${momentum}${momentumUsedThisRound ? ' (used this round)' : ''}`
  return (
    <span className={`momentum-tokens ${team}${momentumUsedThisRound ? ' used' : ''}`} role="img" aria-label={label} title={label} data-momentum={momentum}>
      {Array.from({ length: momentum }, (_, i) => (
        <span key={i} className="token-coin" />
      ))}
    </span>
  )
}
