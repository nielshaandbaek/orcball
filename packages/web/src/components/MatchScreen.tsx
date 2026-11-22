import type { CSSProperties } from 'react'
import { useState } from 'react'
import { BOARD_HEIGHT, BOARD_WIDTH } from '../geometry'
import { computerToAct, LEVEL_LABELS, useMatch } from '../store'
import { Board } from './Board'
import { decisionOnBoard } from './BoardPrompt'
import { Commands } from './Commands'
import { DecisionPrompt } from './DecisionPrompt'
import { FullscreenButton } from './FullscreenButton'
import { LogDialog, LogTicker, LogToast } from './LogPanel'
import { MatchMenu } from './MatchMenu'
import { PlayerBox } from './PlayerBox'
import { ReplayHead, ReplaySteps } from './ReplayPanel'
import { SetupPanel } from './SetupPanel'
import { TeamBlock } from './TeamBoxes'
import { useWide } from '../wide'
import { usePrefs } from '../prefs'

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
  const computer = useMatch((s) => s.computer)
  const replaying = useMatch((s) => s.replay !== null)
  const held = useMatch((s) => s.held !== null)
  // A decision the ball brings waits until it has got there (#161).
  const ballMoving = useMatch((s) => s.ballMoving)
  const thinking = useMatch((s) => s.thinking)
  // What the Wait button is asking, on the message line so the commands keep their size (#253).
  const [asking, setAsking] = useState<string | null>(null)
  const { home, away } = game.teams
  // While the computer acts, the human's controls give way to a note saying so.
  // In a replay (#188) nothing is played: its controls take the place of the coach's.
  const computerActs = computerToAct(game, computer)
  const controls = !computerActs && !replaying && !held
  const inPlay = game.phase === 'Round' || game.phase === 'Activation'
  // On wide screens the bench lies over the board instead of under it.
  const wide = useWide()
  const setup = controls && game.phase === 'Setup'

  return (
    <div className="match">
      {/*
        The score bar (#253): each team's block (Momentum, players left, its once-a-round actions,
        a double) either side of the score and the time; a replay says so; then Full screen and the menu.
      */}
      <header className="scorebar">
        <TeamBlock team="home" />
        <div className="scoreline">
          <span className="score" data-score>
            {home.score} – {away.score}
          </span>
          <span className="when" data-when title={`Rules ${game.config.id.replace('rules-', '')}`}>
            <span className="rules">Rules {game.config.id.replace('rules-', '')}</span>
            {/* No half to name in a match of one run of rounds (v20, #135). */}
            {game.config.match.halves > 1 && (
              <>
                <span className="rules"> · </span>Half {game.half}
              </>
            )}
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
        </div>
        <TeamBlock team="away" />
        <span className="bar-tools">
          {/* The computer's go (#253 follow-up): an hourglass, turning while it thinks; what it does goes to the log. */}
          {computerActs && computer && (
            <span
              className={`computer-turn${thinking ? ' thinking' : ''}`}
              data-computer-turn
              role="status"
              aria-label={`${game.teams[computer.team].name} (${LEVEL_LABELS[computer.level]}) ${thinking ? 'thinking' : 'playing'}`}
              title={`${game.teams[computer.team].name} (${LEVEL_LABELS[computer.level]}) ${thinking ? 'thinking…' : 'playing'}`}
            >
              ⏳
            </span>
          )}
          {replaying && <ReplayHead />}
          <FullscreenButton />
          <MatchMenu />
        </span>
      </header>
      <div className="layout">
        {/*
          The board as big as fits its area (#128): the area is a size container, the board keeps its shape.
          The row under it is as wide as the board and sits right under it (#253).
        */}
        <div className="board-area" style={{ '--board-ratio': BOARD_WIDTH / BOARD_HEIGHT } as CSSProperties}>
          <div className="board-wrap">
            <Board />
            {setup && wide && <SetupPanel overlay />}
            {/* On phones in landscape (#258): the newest log line for a moment, and a hint where Wait is. */}
            <LogToast />
            {controls && inPlay && <GoHint />}
          </div>
          {/* Under the board, three columns of fixed size (#253): the commands, the player, the log. */}
          <div className="board-foot">
            {replaying ? <ReplaySteps /> : <Commands onAsk={setAsking} />}
            <PlayerBox />
            <div className="log-box">
              <LogTicker />
              <p className="message" role="status">
                {asking ?? message ?? '\u00a0'}
              </p>
            </div>
          </div>
        </div>
        {/* What has no place on the board, only while it's needed. */}
        <aside className="panel">
          {controls && !ballMoving && game.pending && !decisionOnBoard() && <DecisionPrompt />}
          {setup && !wide && <SetupPanel />}
          {controls && game.phase === 'KickOff' && !game.pending && (
            <section>
              <h2>{game.teams[game.kickingTeam].name} kick off</h2>
              <p className="hint">Tap a highlighted hex in the receiving team’s half.</p>
            </section>
          )}
        </aside>
      </div>
      <LogDialog />
    </div>
  )
}

/**
 * On a phone in landscape there's no row under the board (#258): while it's
 * the coach's go and nothing is selected, a line over the board says where
 * Wait and Momentum are, until he has opened that pop-up once. Shown only
 * there (styles.css).
 */
function GoHint() {
  const game = useMatch((s) => s.game)!
  const selected = useMatch((s) => s.selected)
  const goMenu = useMatch((s) => s.goMenu)
  const seen = usePrefs((s) => s.goMenuSeen)
  if (seen || goMenu || selected || game.activation || game.pending || game.phase !== 'Round') return null
  return (
    <div className="go-hint" data-go-hint>
      Tap the pitch to Wait or use Momentum
    </div>
  )
}
