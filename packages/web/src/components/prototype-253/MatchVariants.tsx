// PROTOTYPE (#253), throwaway: three alternative match-screen layouts to
// compare with today's (variant A), switchable with ?variant=B|C|D and the
// floating bar. Same store, board, pop-ups and panels; only where the team
// and round information and the controls sit changes. Not for main.

import type { GameState, TeamId } from '@orcball/engine'
import type { CSSProperties, ReactNode } from 'react'
import { BOARD_HEIGHT, BOARD_WIDTH } from '../../geometry'
import { playerName, skillsText } from '../../labels'
import { computerToAct, LEVEL_LABELS, useMatch } from '../../store'
import { useWide } from '../../wide'
import { Board } from '../Board'
import { decisionOnBoard } from '../BoardPrompt'
import { DecisionPrompt } from '../DecisionPrompt'
import { FullscreenButton } from '../FullscreenButton'
import { lineClass, LogButton, LogDialog, LogTicker, useLogLines } from '../LogPanel'
import { MatchMenu } from '../MatchMenu'
import { MatchTools } from '../MatchTools'
import { PlayPanel } from '../PlayPanel'
import { ReplayPanel } from '../ReplayPanel'
import { RollPanel } from '../RollPanel'
import { SetupPanel } from '../SetupPanel'
import { ReasonButton } from '../ReasonButton'
import { stunnedToTurn } from '../../interaction'
import { useEffect, useState } from 'react'

type Action = 'blitz' | 'pass' | 'handOff' | 'foul'
const ACTIONS: { key: Action; label: string; short: string }[] = [
  { key: 'blitz', label: 'Blitz', short: 'Bz' },
  { key: 'pass', label: 'Pass', short: 'Ps' },
  { key: 'handOff', label: 'Hand-off', short: 'HO' },
  { key: 'foul', label: 'Foul', short: 'Fl' },
]

/** Everything about a team's round, in one place. */
function roundOf(game: GameState, team: TeamId) {
  const t = game.teams[team]
  const inRound = game.phase === 'Round' || game.phase === 'Activation'
  const left = Object.values(game.players).filter((p) => p.team === team && p.hex && !p.activatedThisRound)
  const limits = game.config.activations.perRoundPerTeam as Record<Action, number>
  const free = Object.fromEntries(ACTIONS.map(({ key }) => [key, t.usedThisRound[key] < limits[key]])) as Record<Action, boolean>
  return {
    name: t.name,
    score: t.score,
    momentum: t.momentum,
    momentumUsed: t.momentumUsedThisRound,
    onGo: inRound && game.turnOwner === team,
    inRound,
    left,
    free,
    double: game.doubleActivation?.team === team ? game.doubleActivation.left : 0,
  }
}

function useRound(team: TeamId) {
  const game = useMatch((s) => s.game)!
  return roundOf(game, team)
}

/** The round's once-per-round actions as four chips: lit while free, struck through once used. */
function ActionChips({ team, compact = false }: { team: TeamId; compact?: boolean }) {
  const r = useRound(team)
  return (
    <span className="p253-chips">
      {ACTIONS.map(({ key, label, short }) => (
        <span key={key} className={`p253-chip${r.free[key] ? '' : ' used'}`} title={`${label} ${r.free[key] ? 'free this round' : 'used this round'}`}>
          {compact ? short : label}
        </span>
      ))}
    </span>
  )
}

function Momentum({ team }: { team: TeamId }) {
  const r = useRound(team)
  return (
    <span className={`p253-momentum${r.momentumUsed ? ' used' : ''}`} title={`Momentum ${r.momentum}${r.momentumUsed ? ', used this round' : ''}`}>
      <span className="token-coin" /> {r.momentum}
    </span>
  )
}

function LeftDots({ team }: { team: TeamId }) {
  const r = useRound(team)
  return (
    <span className="p253-left" title={`${r.left.length} left to activate`}>
      {r.left.map((p) => (
        <span key={p.id} className="dot" />
      ))}
      <span className="p253-count">{r.left.length} left</span>
    </span>
  )
}

/** The selected (or active) player in one line. */
function PlayerLine() {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const selected = useMatch((s) => s.selected)
  const id = game.activation?.playerId ?? selected
  const p = id ? game.players[id] : null
  if (!p) return <span className="p253-player muted">Tap a player</span>
  return (
    <span className="p253-player">
      <strong>
        {game.teams[p.team].name} {playerName(file, p)}
      </strong>{' '}
      <span className="muted">
        MA {p.ma} · ST {p.st} · AG {p.ag}+ · TO {p.to}
        {p.skills.length > 0 && ` · ${skillsText(file, p)}`}
        {p.status !== 'standing' && ` · ${p.status}`}
      </span>
    </span>
  )
}

/** Wait, Momentum and Undo, wherever a variant puts them: the existing panel's controls, laid out in a row. */
function Controls() {
  return (
    <div className="p253-controls">
      <PlayPanel />
      <MatchTools />
    </div>
  )
}

/** What the panel shows besides play: the computer's go, replay, decisions off the board, setup, kick-off, full time, rolls. */
function Extras() {
  const game = useMatch((s) => s.game)!
  const computer = useMatch((s) => s.computer)
  const replaying = useMatch((s) => s.replay !== null)
  const held = useMatch((s) => s.held !== null)
  const ballMoving = useMatch((s) => s.ballMoving)
  const thinking = useMatch((s) => s.thinking)
  const quit = useMatch((s) => s.quit)
  const wide = useWide()
  const computerActs = computerToAct(game, computer)
  const controls = !computerActs && !replaying && !held
  const { home, away } = game.teams
  return (
    <>
      {computerActs && computer && (
        <section className="computer-turn" data-computer-turn>
          <h2>
            {game.teams[computer.team].name} ({LEVEL_LABELS[computer.level]}) {thinking ? 'thinking…' : 'playing'}
          </h2>
        </section>
      )}
      {replaying && !document.querySelector('.p253-e') && <ReplayPanel />}
      {controls && !ballMoving && game.pending && !decisionOnBoard() && <DecisionPrompt />}
      {controls && game.phase === 'Setup' && !wide && <SetupPanel />}
      {controls && game.phase === 'KickOff' && !game.pending && (
        <section>
          <h2>{game.teams[game.kickingTeam].name} kick off</h2>
          <p className="hint">Tap a highlighted hex in the receiving team’s half.</p>
        </section>
      )}
      {game.phase === 'FullTime' && (
        <section className="result">
          <h2>Full time</h2>
          <p>
            {home.score}–{away.score}
          </p>
          <button type="button" className="primary" onClick={quit}>
            New match
          </button>
        </section>
      )}
      <RollPanel />
    </>
  )
}

function useControlsShown() {
  const game = useMatch((s) => s.game)!
  const computer = useMatch((s) => s.computer)
  const replaying = useMatch((s) => s.replay !== null)
  const held = useMatch((s) => s.held !== null)
  const inPlay = game.phase === 'Round' || game.phase === 'Activation'
  return inPlay && !computerToAct(game, computer) && !replaying && !held
}

function BoardArea() {
  const game = useMatch((s) => s.game)!
  const computer = useMatch((s) => s.computer)
  const replaying = useMatch((s) => s.replay !== null)
  const held = useMatch((s) => s.held !== null)
  const wide = useWide()
  const setup = !computerToAct(game, computer) && !replaying && !held && game.phase === 'Setup'
  return (
    <div className="board-area" style={{ '--board-ratio': BOARD_WIDTH / BOARD_HEIGHT } as CSSProperties}>
      <div className="board-wrap">
        <Board />
        {setup && wide && <SetupPanel overlay />}
      </div>
    </div>
  )
}

function When() {
  const game = useMatch((s) => s.game)!
  return (
    <span className="when">
      {game.config.match.halves > 1 ? `Half ${game.half}` : ''}
      {game.round > 0 && ` · Round ${game.round}`}
      {game.phase !== 'Round' && game.phase !== 'Activation' && ` · ${game.phase}`}
    </span>
  )
}

function Tools({ log = true }: { log?: boolean }) {
  return (
    <span className="p253-tools">
      {log && <LogButton />}
      <FullscreenButton />
      <MatchMenu />
    </span>
  )
}

/** A team's name in the score bar with its players still to activate as dots under it (D). */
function NameWithDots({ team }: { team: TeamId }) {
  const r = useRound(team)
  return (
    <span className={`p253-namedots ${team}${r.onGo ? ' on-go' : ''}`} title={`${r.name}: ${r.left.length} left to activate`}>
      <span className="p253-name">{r.name}</span>
      {r.inRound && (
        <span className="p253-left">
          {r.left.map((p) => (
            <span key={p.id} className="dot" />
          ))}
        </span>
      )}
    </span>
  )
}

function Message() {
  const message = useMatch((s) => s.message)
  return (
    <p className="message" role="status">
      {message ?? ' '}
    </p>
  )
}

// ── B: Team bar ─────────────────────────────────────────────────────────
// Each team's whole round in the score bar, flanking the score: Momentum,
// players left, the four once-per-round actions, a double. The team on its
// go lights up. Under the board one row: the player, then Wait, Momentum, Undo.

function TeamBlock({ team }: { team: TeamId }) {
  const r = useRound(team)
  return (
    <div className={`p253-teamblock ${team}${r.onGo ? ' on-go' : ''}`}>
      <div className="p253-teamhead">
        {r.onGo && <span className="p253-go">▶ Go</span>}
        <span className="p253-name">{r.name}</span>
        <Momentum team={team} />
        {r.double > 0 && <span className="p253-double">double{r.double < 2 ? ' · 1 more' : ''}</span>}
      </div>
      {r.inRound && (
        <div className="p253-teamround">
          <LeftDots team={team} />
          <ActionChips team={team} />
        </div>
      )}
    </div>
  )
}

export function VariantB() {
  const game = useMatch((s) => s.game)!
  const shown = useControlsShown()
  return (
    <div className="match p253 p253-b">
      <header className="p253-bar">
        <TeamBlock team="home" />
        <div className="p253-mid">
          <span className="score">
            {game.teams.home.score} – {game.teams.away.score}
          </span>
          <When />
        </div>
        <TeamBlock team="away" />
        <Tools />
      </header>
      <div className="p253-b-body">
        <BoardArea />
        <div className="p253-row">
          {shown ? (
            <>
              <PlayerLine />
              <Controls />
            </>
          ) : (
            <Extras />
          )}
        </div>
        {shown && (
          <div className="p253-row p253-sub">
            <LogTicker />
            <Message />
            <Extras />
          </div>
        )}
      </div>
      <LogDialog />
    </div>
  )
}

// ── C: Side columns ─────────────────────────────────────────────────────
// A column for each team beside the board, on its own side: name and score,
// Momentum, the round's actions, and the players still to activate by name.
// Under the board: the player and the controls.

function TeamColumn({ team }: { team: TeamId }) {
  const r = useRound(team)
  const file = useMatch((s) => s.file)!
  const select = useMatch((s) => s.select)
  return (
    <aside className={`p253-col ${team}${r.onGo ? ' on-go' : ''}`}>
      <div className="p253-colhead">
        <span className="p253-name">{r.name}</span>
        <span className="p253-colscore">{r.score}</span>
      </div>
      {r.onGo && <div className="p253-go">▶ Their go{r.double > 0 ? ` · double${r.double < 2 ? ', 1 more' : ''}` : ''}</div>}
      <Momentum team={team} />
      {r.inRound && (
        <>
          <div className="p253-chips-col">
            <ActionChips team={team} />
          </div>
          <div className="p253-sub-h">{r.left.length} to activate</div>
          <ul className="p253-names">
            {r.left.map((p) => (
              <li key={p.id}>
                <button type="button" className="quiet" onClick={() => select(p.id)}>
                  {playerName(file, p)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}

export function VariantC() {
  const shown = useControlsShown()
  return (
    <div className="match p253 p253-c">
      <header className="p253-bar slim">
        <When />
        <Tools />
      </header>
      <div className="p253-c-body">
        <TeamColumn team="home" />
        <div className="p253-c-mid">
          <BoardArea />
          <div className="p253-row">
            {shown && <PlayerLine />}
            {shown && <Controls />}
          </div>
          <div className="p253-row p253-sub">
            <LogTicker />
            <Message />
            <Extras />
          </div>
        </div>
        <TeamColumn team="away" />
      </div>
      <LogDialog />
    </div>
  )
}

// ── D: Turn strip ───────────────────────────────────────────────────────
// One strip under the board about the team whose go it is, in its colour and
// large: what it can still do, then its buttons. The other team is a small
// summary at the end. The selected player is a card over the board's corner.

function Strip({ children, team }: { children: ReactNode; team: TeamId }) {
  return <div className={`p253-strip ${team}`}>{children}</div>
}

export function VariantD() {
  const game = useMatch((s) => s.game)!
  const shown = useControlsShown()
  const team = game.turnOwner
  const other: TeamId = team === 'home' ? 'away' : 'home'
  const r = roundOf(game, team)
  const o = roundOf(game, other)
  return (
    <div className="match p253 p253-d">
      <header className="scorebar p253-d-bar">
        <NameWithDots team="home" />
        <span className="score">
          {game.teams.home.score} – {game.teams.away.score}
        </span>
        <NameWithDots team="away" />
        <When />
        <Tools log={false} />
      </header>
      <div className="p253-d-body">
        <div className="p253-d-board">
          <BoardArea />
          {shown && (
            <div className="p253-d-card">
              <PlayerLine />
            </div>
          )}
        </div>
        {r.inRound && (
          <Strip team={team}>
            <span className="p253-strip-title">{r.name}’ go</span>
            {r.double > 0 && <span className="p253-double">double{r.double < 2 ? ' · 1 more' : ''}</span>}
            <ActionChips team={team} />
            <Momentum team={team} />
            {shown && <Controls />}
            <span className={`p253-other ${other}`}>
              {o.name}: <ActionChips team={other} compact /> · <Momentum team={other} />
            </span>
          </Strip>
        )}
        <div className="p253-row p253-sub">
          <LogTicker />
          <Message />
          <Extras />
        </div>
      </div>
      <LogDialog />
    </div>
  )
}

// ── E: B's team bar, three columns under the board ─────────────────────
// The header is B's team bar, without the Log button (the log bar opens the
// log). Under the board three columns: the commands (Undo, always there,
// then Wait and Momentum on the team's go), the selected player, and the
// log bar with the message. Everything else is a pop-up on the board; what
// has no place there (a decision with no hex, setup on narrow screens, the
// replay, full time, the computer's go) shows in a strip below, only then.

function Commands({ onAsk }: { onAsk: (text: string | null) => void }) {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const options = useMatch((s) => s.options)
  const dispatch = useMatch((s) => s.dispatch)
  const undoReason = useMatch((s) => s.undoReason)
  const undo = useMatch((s) => s.undo)
  const shown = useControlsShown()
  const [askWait, setAskWait] = useState(false)
  useEffect(() => {
    setAskWait(false)
    onAsk(null)
  }, [game, onAsk])
  const wait = shown && !game.activation ? options.find((o) => o.command.type === 'wait') : undefined
  const momentum = shown && !game.activation ? options.find((o) => o.command.type === 'spendMomentum') : undefined
  const stunned = stunnedToTurn(game, options).map((id) => playerName(file, game.players[id]!))
  const ask = (on: boolean) => {
    setAskWait(on)
    onAsk(on ? `${stunned.join(' and ')} ${stunned.length === 1 ? 'is' : 'are'} still stunned: Wait anyway?` : null)
  }
  // Three fixed slots, each as wide as the widest button it holds; an empty slot keeps its space.
  return (
    <div className="p253-commands">
      <span className="p253-slot">
        <ReasonButton id="undo" reason={undoReason} title="Undo the last action" onClick={undo}>
          Undo
        </ReasonButton>
      </span>
      <span className="p253-slot">
        {wait &&
          (askWait ? (
            <button type="button" onClick={() => dispatch(wait.command)}>
              Wait anyway
            </button>
          ) : (
            <button type="button" onClick={() => (stunned.length > 0 ? ask(true) : dispatch(wait.command))}>
              Wait
            </button>
          ))}
      </span>
      <span className="p253-slot">
        {wait && askWait ? (
          <button type="button" className="quiet" onClick={() => ask(false)}>
            Cancel
          </button>
        ) : (
          momentum && (
            <ReasonButton reason={momentum.available ? null : momentum.reason} onClick={() => dispatch(momentum.command)}>
              Momentum
            </ReasonButton>
          )
        )}
      </span>
    </div>
  )
}

/** The selected (or active) player: name, and his stats and skills under it. */
function PlayerColumn() {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const selected = useMatch((s) => s.selected)
  const id = game.activation?.playerId ?? selected
  const p = id ? game.players[id] : null
  if (!p) return <div className="p253-playercol muted">Tap a player to see him here.</div>
  return (
    <div className={`p253-playercol ${p.team}`}>
      <strong className="p253-name">
        {game.teams[p.team].name} {playerName(file, p)}
        {game.activation?.playerId === p.id && ` · ${game.activation.action}`}
      </strong>
      <span className="muted">
        MA {p.ma} · ST {p.st} · AG {p.ag}+ · TO {p.to}
        {p.skills.length > 0 && ` · ${skillsText(file, p)}`}
        {p.status !== 'standing' && ` · ${p.status}`}
        {game.activation?.playerId === p.id && ` · MA used ${game.activation.maUsed}`}
      </span>
    </div>
  )
}


/** The last two log lines on one line, the older first, separated by a dot; tapping opens the log. */
function LogTwo() {
  const lines = useLogLines().filter((l) => !l.undone)
  const openLog = useMatch((s) => s.openLog)
  const shown = lines.slice(-2)
  return (
    <button type="button" className="log-ticker p253-logtwo" onClick={openLog} data-log-ticker title={`${shown.map((l) => l.text).join('\n')}\n(Open the match log)`}>
      {shown.length === 0 && <span className="muted">Nothing yet.</span>}
      {shown.map((l, i) => (
        <span key={l.key} className={`${lineClass(l)}${i < shown.length - 1 ? ' p253-older' : ''}`}>
          {i > 0 && <span className="p253-sep"> · </span>}
          {l.text}
        </span>
      ))}
    </button>
  )
}

/** A replay's steps as symbols, in the command slots (no Undo, Wait or Momentum in a replay). */
function ReplaySteps() {
  const replay = useMatch((s) => s.replay)!
  const step = useMatch((s) => s.replayStep)
  const jump = useMatch((s) => s.replayJump)
  const play = useMatch((s) => s.replayPlay)
  const { at, playing, activations, rounds } = replay
  const atStart = at === 0
  const atEnd = at === replay.commands.length
  return (
    <div className="p253-replaysteps">
      <button type="button" onClick={() => jump('round', -1)} disabled={atStart} title="To the start of this round, or the one before">«</button>
      <button type="button" onClick={() => jump('activation', -1)} disabled={!activations.some((m) => m < at)} title="To the start of the activation before">‹‹</button>
      <button type="button" onClick={() => step(-1)} disabled={atStart} title="One command back (←)">‹</button>
      <button type="button" className="primary" onClick={() => play(!playing)} disabled={atEnd} title="Play or pause (space)">{playing ? '❚❚' : '▶'}</button>
      <button type="button" onClick={() => step(1)} disabled={atEnd} title="One command forward (→)">›</button>
      <button type="button" onClick={() => jump('activation', 1)} disabled={!activations.some((m) => m > at)} title="To the start of the next activation">››</button>
      <button type="button" onClick={() => jump('round', 1)} disabled={!rounds.some((m) => m > at)} title="To the start of the next round">»</button>
    </div>
  )
}

/** In a replay, the score bar says so, with Play on (at the end) and Leave. */
function ReplayHead() {
  const replay = useMatch((s) => s.replay)
  const playOn = useMatch((s) => s.playOn)
  const quit = useMatch((s) => s.quit)
  if (!replay) return null
  const total = replay.commands.length
  return (
    <span className="p253-replayhead">
      <strong>Replay</strong> <span className="muted">{replay.at} / {total}</span>
      {replay.at === total && (
        <button type="button" onClick={playOn} title="Carry on playing this match hot-seat">
          Play on
        </button>
      )}
      <button type="button" className="quiet" onClick={quit}>
        Leave
      </button>
    </span>
  )
}

export function VariantE() {
  const game = useMatch((s) => s.game)!
  // What the Wait button is asking, shown on the message line so the commands keep their size.
  const [ask, setAsk] = useState<string | null>(null)
  const replaying = useMatch((s) => s.replay !== null)
  return (
    <div className="match p253 p253-b p253-e">
      <header className="p253-bar">
        <TeamBlock team="home" />
        <div className="p253-mid">
          <span className="score">
            {game.teams.home.score} – {game.teams.away.score}
          </span>
          <When />
        </div>
        <TeamBlock team="away" />
        <ReplayHead />
        <Tools log={false} />
      </header>
      <div className="p253-b-body p253-e-body">
        <BoardArea />
        <div className="p253-e-cols">
          {replaying ? <ReplaySteps /> : <Commands onAsk={setAsk} />}
          <PlayerColumn />
          <div className="p253-logcol">
            <LogTwo />
            {ask ? <p className="message">{ask}</p> : <Message />}
          </div>
        </div>
        <div className="p253-e-extras">
          <Extras />
        </div>
      </div>
      <LogDialog />
    </div>
  )
}
