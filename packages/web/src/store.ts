import {
  availableCommands,
  type Command,
  type CommandOption,
  createMatch,
  exportMatch,
  importMatch,
  type GameEvent,
  type GameState,
  type Hex,
  hexEquals,
  type MatchFile,
  MATCH_FILE_FORMAT,
  newMatchFile,
  previewRolls,
  type RollPreview,
  type Roster,
  type RuleConfig,
  record,
  replay,
  type ReplaySteps,
  replaySteps,
  rulesV10,
  rulesV11,
  rulesV12,
  rulesV13,
  rulesV14,
  rulesV15,
  rulesV16,
  rulesV17,
  rulesV18,
  rulesV19,
  rulesV20,
  rulesV21,
  rulesV22,
  rulesV23,
  rulesV24,
  rulesV25,
  rulesV26,
  rulesV27,
  rulesV28,
  rulesV29,
  rulesV30,
  rulesV31,
  rulesV32,
  type TeamId,
  undo,
  undoBlocked,
} from '@orcball/engine'
import { actingTeam, type AiLevel, viewOf } from '@orcball/ai'
import { create } from 'zustand'
import { ACTIVATION_HOLD_MS, type Caption, type CaptionTarget, type Flash, flashesOf, nextCaption, type Notice, noticeOf } from './captions'
import { type BallSegment, ballSegments, stillSegments, totalMs } from './ballpath'
import { scoredPosition } from './held'
import { type Cue, withCues as playing } from './sprites'
import { type EventIconAt, eventIconsOf } from './effects'
import { askComputer } from './computer'
import { nextStep, type Route, routeTo, setupSelection, tapHex } from './interaction'
import { type Declared, type DeclaredChoice, declaredOdds } from './odds'
import { clearMatch, loadComputer, loadMatch, saveComputer, saveMatch } from './storage'

// The app's one store: the rule config, the match file (the log) and the
// engine state it produces, the command options for that state, and view
// state: the selected player, a path being walked, and a roll waiting for
// confirmation. Every command goes through record(), so the match file is
// always complete.
//
// Any command that rolls dice is held back until the coach has seen the odds:
// it waits in `confirm` and is sent by confirmGo().
//
// Against the computer, `computer` says which team it plays and at what level.
// Whenever its team must act (its go, its activation, a decision addressed to
// it), the store asks the worker for a command and sends it after a short
// pause, one command at a time. Its reasons are kept by match-file entry, next
// to the match but not in the match file. There's no undo against it.
//
// An imported match opens as a replay (#188): `replay` holds every position of
// it, and `file` and `game` show the one stepped to. Nothing can be played
// then, and nothing is saved: the match file never changes.

/** Newest first: the start screen offers the first one. */
export const CONFIGS: RuleConfig[] = [rulesV32, rulesV31, rulesV30, rulesV29, rulesV28, rulesV27, rulesV26, rulesV25, rulesV24, rulesV23, rulesV22, rulesV21, rulesV20, rulesV19, rulesV18, rulesV17, rulesV16, rulesV15, rulesV14, rulesV13, rulesV12, rulesV11, rulesV10]

export const CONFIG_LABELS: Record<string, string> = {
  'rules-v20': 'v20: one run of 8 rounds with 3 Momentum, and a dropped catch forgiven if your team ends up with the ball',
  'rules-v32': 'v32: v31 with the Mummy at AG 10+, and the Lizards as 3 Warriors, 1 Shaman and 3 Geckoes, Stunty for all but the Warriors',
  'rules-v31': 'v31: v30 with no limit on Momentum per round: spend as many tokens as you have, on re-rolls or double activations',
  'rules-v30': 'v30: v29 with two more teams, the Lizards (Juggernaut, Sure Hands, Dodge) and the Amazons (Jump Up, Guard, Pass, Brace, and Dodge for all)',
  'rules-v29': 'v29: v28 with Dwarf Blockers at AG 7+',
  'rules-v28': 'v28: v27 with a sixth team, the Undead (Brace, Dodge, Block, Crushing Blow, and Regeneration for all but the Ghouls)',
  'rules-v27': 'v27: v26 with a fifth team, the Drow (Brace, Strip Ball, Dump-Off and Frenzy)',
  'rules-v26': 'v26: v25 with a fourth team, the Dwarves (Tackle, Block, Sure Hands, Frenzy, and Thick Skull for all), and 7 to field at setup',
  'rules-v25': 'v25: v24 with slower Orcs, an Orc Runner with Sure Hands in place of the Thrower, and Humans at AG 5+',
  'rules-v24': 'v24: v23 with a third team, the Humans',
  'rules-v23': 'v23: two drives of up to 6 rounds, a touchdown ends the drive; Block only when attacking; two Elf Dancers',
  'rules-v22': 'v22: Crushing Blow in place of Guard for the Orc Brute, +1 on the armour or injury die',
  'rules-v21': 'v21: Out players back after two rounds, and a Strength Disengage only in a Move',
  'rules-v19': 'v19: one skill per position: Guard for the Brute, Leap for the Dancer, Catch only for the Catchers',
  'rules-v18': 'v18: v17 with the Black Orc renamed Brute and the Wardancer renamed Dancer',
  'rules-v17': 'v17: v16 with the Pass skill (+1 on pass rolls) for both Throwers',
  'rules-v16': 'v16: v15 with Dodge and Catch for the Elf Catchers, the Guard skill, Cancel before acting, and no empty activations',
  'rules-v15': 'v15: v14 with Sprint +1, every Elf 1 MA slower, and a natural 10 always passing',
  'rules-v14': 'v14: v13 with one Elf Wardancer swapped for a Lineman',
  'rules-v13': 'v13: v12 with Block counting on assisted Tackles too',
  'rules-v12': 'v12: v11 plus Block and Brace skills, defender chooses on a missed Tackle',
  'rules-v11': 'v11: Dodge out of tackle zones, Strength Disengage',
  'rules-v10': 'v10: stop in tackle zones',
}

export type Screen = 'loading' | 'start' | 'match'

/** The computer's reason for a command, and the key of the plan it belongs to (shown once per plan). */
export type Reason = { text: string; plan?: string }

/** The computer opponent: the team it plays and its level. */
export type Computer = { team: TeamId; level: AiLevel }

export const LEVEL_LABELS: Record<AiLevel, string> = { novice: 'Novice', intermediate: 'Intermediate', expert: 'Expert' }

/** The pause between the computer's commands, so each one can be followed on the board. */
export const COMPUTER_PAUSE_MS = 700

/** How long the scorer is shown in the end zone before the Touchdown banner and the cleared pitch. */
export const TOUCHDOWN_HOLD_MS = COMPUTER_PAUSE_MS

/** The pause between the steps of a move the coach taps out, so the player is seen walking his path (#112). */
export const WALK_STEP_MS = 200

/** The pause between commands when a replay plays itself (#188), as when the computer plays. */
export const REPLAY_PAUSE_MS = COMPUTER_PAUSE_MS

/** An imported match being stepped through (#188). */
export type Replay = ReplaySteps & {
  /** The match file as imported, undone entries and all, for Play on. */
  source: MatchFile
  /** How many commands have been applied: the position shown is `states[at]`. */
  at: number
  /** Stepping forward by itself. */
  playing: boolean
  /** The positions an activation starts from: just before each `activate` command. */
  activations: number[]
  /** The positions a round starts from: just after each command that started one. */
  rounds: number[]
}

export type ReplayJump = 'activation' | 'round'

export type Confirm = {
  command: Command
  previews: RollPreview[]
  /** For a Dodge: stepping in and stopping instead, with no roll. */
  stopInstead: Command | null
  /** The rest of a path to walk after this step. */
  then: Hex[]
  /** For a block or foul, which rolls nothing itself: the odds of what it leads to (#180). */
  declared?: Declared
}

export type MatchStore = {
  screen: Screen
  config: RuleConfig
  file: MatchFile | null
  game: GameState | null
  options: CommandOption[]
  selected: string | null
  /** Counts taps that select a player, so his stats pop-up shows afresh on each (#291). */
  selectTaps: number
  message: string | null
  lastEvents: GameEvent[]
  /** The event icons the last command set off (art/icons/events). */
  lastEventIcons: EventIconAt[]
  aiming: boolean
  /** The Leap button is on (v19): the hexes he can leap to are highlighted, and a tap on one leaps there. */
  leaping: boolean
  /** A round has just started: shown briefly over the board (#81). Only from a command, never from undo or a reload. */
  banner: Banner | null
  clearBanner(id: number): void
  /** The active player's controls are open on the board: tapping him opens and closes them (#91). */
  controls: boolean
  /**
   * The empty hex whose pop-up is open (#258): tapped outside an activation
   * on the coach's go, it offers Undo, Wait and Momentum there. null when shut.
   */
  goMenu: Hex | null
  closeGoMenu(): void
  confirm: Confirm | null
  /** Shove or Tackle, chosen with the block's odds (#189): sent when the engine asks, after any Brace. */
  blockChoice: DeclaredChoice['id'] | null
  /** Why undo isn't allowed right now, or null if it is. */
  undoReason: string | null
  /** The computer opponent, or null for a hot-seat match. */
  computer: Computer | null
  /** The computer's reason for each match-file entry it sent, by entry index. */
  reasons: Record<number, Reason>
  /** The computer is choosing its next command. */
  thinking: boolean
  /** A move the coach tapped is being walked, a step at a time: taps on the board wait until it's done (#112). */
  walking: boolean
  /**
   * The ball's way in the last command, while the board plays it (#171): flights, glides, hops and a pause at the
   * crowd, from `start` (Date.now()). Null once it has come to rest.
   */
  ballFlight: { segments: BallSegment[]; start: number } | null
  /** The ball is still stepping: taps on the board and the computer wait until it stops (#161). */
  ballMoving: boolean
  /**
   * The position at a touchdown, shown on the board for a moment before the
   * pitch is cleared and the Touchdown banner shows: taps and the computer wait.
   */
  held: GameState | null
  /** The one-off sprite animations the last commands started, by player (#208): running, blocking, falling... */
  cues: Record<string, Cue>
  /** The hex whose path is shown before moving: hovered with a mouse, or tapped once on touch (#113). */
  preview: Hex | null
  /** The path being walked, shown until the player gets there or stops for a roll (#113). */
  route: Route | null
  /** What the active player is doing, shown by him (#126). */
  caption: Caption | null
  /** Roll results to flash by the players (#126); `id` tells one from the next. */
  flashes: (Flash & { id: number })[]
  /** A centre banner for a big moment or the computer's Wait (#126). */
  notice: (Notice & { id: number }) | null
  clearNotice(id: number): void
  /** The match log is open over the board (#127): the computer waits until it's closed. */
  logOpen: boolean
  openLog(): void
  closeLog(): void
  /** The imported match being stepped through (#188), or null when playing. */
  replay: Replay | null
  /** One command forward (animated, like live play) or back (just redrawn). */
  replayStep(delta: 1 | -1): void
  /** To the start of the next or previous activation or round. */
  replayJump(kind: ReplayJump, direction: 1 | -1): void
  /** Start or stop stepping forward by itself. */
  replayPlay(playing: boolean): void
  /** At the end of a replay: carry on playing the match hot-seat. */
  playOn(): void
  /** Restore the saved match, if any, on startup. */
  restore(): Promise<void>
  /** A new match; `teams` are the home and away roster ids (#192), Orcs against Elves if left out. */
  start(config: RuleConfig, seed: number, computer?: Computer | null, teams?: readonly [string, string]): void
  undo(): void
  exportJson(): string | null
  importJson(json: string): void
  /** Send a command; the computer passes its plan's target, for the caption (#126). */
  send(command: Command, computerTarget?: CaptionTarget | null): void
  /** Send a command, or hold it for confirmation if it rolls dice. */
  dispatch(command: Command, then?: Hex[]): void
  confirmGo(): void
  /** Declare the block being confirmed and choose Shove or Tackle in one go (#189). */
  confirmBlock(choice: DeclaredChoice['id']): void
  confirmStop(): void
  cancel(): void
  walk(path: Hex[]): void
  select(playerId: string | null): void
  setAiming(aiming: boolean): void
  setLeaping(leaping: boolean): void
  /** The mouse is over this hex of the pitch, or has left it (null). */
  hover(hex: Hex | null): void
  tapHex(hex: Hex, touch?: boolean): void
  quit(): void
}

/** The home and away rosters: the teams picked (#192), or Orcs against Elves. */
function rostersOf(config: RuleConfig, teams?: readonly [string, string]): [Roster, Roster] {
  const all = Object.values(config.rosters)
  const pick = (id: string | undefined, fallback: Roster) => (id ? config.rosters[id] : undefined) ?? fallback
  return [pick(teams?.[0], config.rosters.orcs ?? all[0]!), pick(teams?.[1], config.rosters.elves ?? all[1] ?? all[0]!)]
}

/** The positions a replay can jump to: activation and round starts. */
function replayMarks(steps: ReplaySteps): Pick<Replay, 'activations' | 'rounds'> {
  return {
    activations: steps.commands.flatMap((c, i) => (c.type === 'activate' ? [i] : [])),
    rounds: steps.events.flatMap((events, i) => (events.some((e) => e.type === 'roundStarted') ? [i + 1] : [])),
  }
}

/** The match file and state at a replay's position: the file holds only the commands up to it, for the log. */
function replayView(replay: Replay) {
  const file: MatchFile = { ...replay.source, entries: replay.commands.slice(0, replay.at).map((command, i) => ({ command, events: replay.events[i]!, at: null })) }
  return { replay, file, game: replay.states[replay.at]!, options: [] as CommandOption[] }
}

/** The cues still playing, with those the events start (see sprites.ts). */
function withCues(cues: Record<string, Cue>, events: readonly GameEvent[], before: GameState): Record<string, Cue> {
  return playing(cues, events, Date.now(), before)
}

/** Numbers replay runs, so an Auto-play timer from an older one does nothing. */
let replayRun = 0

const idle = { held: null, cues: {} as Record<string, Cue>, selected: null, message: null, aiming: false, leaping: false, controls: false, goMenu: null as Hex | null, confirm: null, blockChoice: null, banner: null, walking: false, ballFlight: null, ballMoving: false, preview: null, route: null, logOpen: false, caption: null, flashes: [], notice: null }

/** The new round's number, half and the team with the initiative; `id` tells one banner from the next. */
export type Banner = { id: number; round: number; half: number; team: TeamId }
let bannerId = 0

function bannerFor(events: GameEvent[]): Banner | null {
  const started = events.findLast((e) => e.type === 'roundStarted')
  return started?.type === 'roundStarted' ? { id: ++bannerId, round: started.round, half: started.half, team: started.firstGo } : null
}

/** Whether the computer's team must act now: its go, its activation, or a decision addressed to it. */
export function computerToAct(game: GameState | null, computer: Computer | null): boolean {
  return computer !== null && game !== null && game.phase !== 'FullTime' && actingTeam(viewOf(game)) === computer.team
}

function undoReasonFor(file: MatchFile, config: RuleConfig, computer: Computer | null): string | null {
  return computer ? 'Undo isn’t available in a match against the computer' : undoBlocked(file, config)
}

function persistComputer(computer: Computer | null, reasons: Record<number, Reason>): void {
  void saveComputer(computer ? JSON.stringify({ ...computer, reasons }) : null).catch(() => {})
}

/** Bumped whenever the match changes under the computer (new match, import, quit), so a late answer is dropped. */
let generation = 0

/** Counts ball animations, so a timer from an older one (or an older match) does nothing. */
let ballRun = 0

/** When the last command was sent, for the pause before the computer's next one. */
let lastSent = 0
/** The type of the last command sent: after the computer's `activate` it holds longer. */
let lastSentType: Command['type'] | null = null
/** Numbers flashes and banners, so a new one replaces an old one with the same text. */
let shown = 0
const withId = <T extends object>(item: T | null): (T & { id: number }) | null => (item ? { ...item, id: ++shown } : null)

/** Save the match file in the background; a failed save shouldn't stop play. */
function persist(file: MatchFile): void {
  void saveMatch(exportMatch(file)).catch(() => {})
}

function configFor(file: MatchFile): RuleConfig {
  const config = CONFIGS.find((c) => c.id === file.configId)
  if (!config) throw new Error(`This match uses rule config ${file.configId}, which this version doesn't have`)
  return config
}

/** Everything the store derives from a match file and the state it replays to. */
function loaded(config: RuleConfig, file: MatchFile, game: GameState, computer: Computer | null = null, reasons: Record<number, Reason> = {}) {
  // A ball still stepping in the match before (undo, import, a new match) stops.
  ballRun++
  const options = availableCommands(game)
  return {
    screen: 'match' as const,
    config,
    file,
    game,
    options,
    undoReason: undoReasonFor(file, config, computer),
    lastEvents: [],
    lastEventIcons: [],
    computer,
    reasons,
    thinking: false,
    ...idle,
    selected: setupSelection(game, options, computer?.team ?? null),
  }
}

/** Whether a tap on this hex opens the commands pop-up (#258): an empty hex in a round, on the coach's go, with nothing pending. */
function emptyHexMenu(game: GameState, hex: Hex, result: { select?: string | null; command?: unknown; path?: unknown }): boolean {
  if (game.phase !== 'Round' || game.pending || game.activation || result.command || result.path) return false
  if (result.select !== null) return false
  return !Object.values(game.players).some((p) => p.hex && hexEquals(p.hex, hex))
}

export const useMatch = create<MatchStore>((set, get) => ({
  screen: 'loading',
  config: rulesV10,
  file: null,
  game: null,
  options: [],
  lastEvents: [],
  lastEventIcons: [],
  undoReason: null,
  computer: null,
  reasons: {},
  selectTaps: 0,
  thinking: false,
  replay: null,
  ...idle,

  async restore() {
    try {
      const json = await loadMatch()
      if (json) {
        const { configId } = JSON.parse(json) as { configId: string }
        const config = configFor({ configId } as MatchFile)
        const file = importMatch(json, config)
        const saved = await loadComputer().catch(() => null)
        const { reasons = {}, ...computer } = saved ? (JSON.parse(saved) as Computer & { reasons?: Record<number, Reason | string> }) : { reasons: {} }
        generation++
        // Reasons saved before they had plan keys were plain strings.
        const upgraded = Object.fromEntries(Object.entries(reasons).map(([i, r]) => [i, typeof r === 'string' ? { text: r } : r]))
        set({ ...loaded(config, file, replay(file, config), saved ? (computer as Computer) : null, upgraded), replay: null })
        drive()
        return
      }
    } catch {
      // A saved match that can't be read is dropped; start fresh.
      void clearMatch().catch(() => {})
    }
    set({ screen: 'start' })
  },

  start(config, seed, computer = null, teams) {
    const rosters = rostersOf(config, teams)
    const file = newMatchFile(config, rosters, seed)
    generation++
    set({ ...loaded(config, file, createMatch(config, rosters, seed), computer), replay: null })
    persist(file)
    persistComputer(computer, {})
    drive()
  },

  undo() {
    const { file, config } = get()
    if (!file) return
    try {
      const result = undo(file, config)
      set({ ...loaded(config, result.file, result.state), message: 'Undone' })
      persist(result.file)
    } catch (error) {
      set({ message: (error as Error).message })
    }
  },

  exportJson() {
    const { file } = get()
    return file ? exportMatch(file) : null
  },

  importJson(json) {
    try {
      const { format, configId } = (JSON.parse(json) ?? {}) as { format?: unknown; configId?: unknown }
      if (format !== MATCH_FILE_FORMAT || typeof configId !== 'string') throw new Error('This is not an OrcBall match file')
      const config = configFor({ configId } as MatchFile)
      const file = importMatch(json, config)
      // An imported match opens as a replay at the start (#188). It isn't saved: a reload goes back to the match before.
      const steps = replaySteps(file, config)
      generation++
      replayRun++
      const view = replayView({ ...steps, ...replayMarks(steps), source: file, at: 0, playing: false })
      set({ ...loaded(config, view.file, view.game), ...view, undoReason: 'Undo isn’t available in a replay', message: 'Match imported: step through it with the replay controls' })
    } catch (error) {
      set({ message: error instanceof SyntaxError ? 'This file is not valid JSON, so it is not a match file' : (error as Error).message })
    }
  },

  replayStep(delta) {
    const current = get().replay
    if (!current) return
    const at = current.at + delta
    if (at < 0 || at > current.commands.length) return
    const view = replayView({ ...current, at, playing: delta === 1 && current.playing && at < current.commands.length })
    if (delta === -1) {
      // Back is just the position before: no animation.
      ballRun++
      set({ ...view, ...idle, logOpen: get().logOpen, message: null, lastEvents: [], lastEventIcons: [] })
      return
    }
    // Forward shows the command as it was played: the ball's path, captions, flashes and banners.
    const before = current.states[current.at]!
    const command = current.commands[current.at]!
    const events = current.events[current.at]!
    const next = view.game
    set({
      ...view,
      message: null,
      lastEvents: events,
      lastEventIcons: eventIconsOf(before, command, events, next),
      cues: withCues(get().cues, events, before),
      caption: nextCaption(get().caption, before, command, events, next, null),
      flashes: flashesOf(before, events, next).map((f) => ({ ...f, id: ++shown })),
      selected: next.activation?.playerId ?? null,
    })
    playBall(ballSegments(before, events))
    showAfterHold(before, events, noticeOf(events, next, view.file, null), bannerFor(events))
  },

  replayJump(kind, direction) {
    const current = get().replay
    if (!current) return
    const marks = kind === 'activation' ? current.activations : current.rounds
    const at = direction === 1 ? marks.find((m) => m > current.at) : (marks.findLast((m) => m < current.at) ?? 0)
    if (at === undefined || at === current.at) return
    replayRun++
    ballRun++
    set({ ...replayView({ ...current, at, playing: false }), ...idle, logOpen: get().logOpen, message: null, lastEvents: [], lastEventIcons: [] })
  },

  replayPlay(playing) {
    const current = get().replay
    if (!current) return
    const run = ++replayRun
    set({ replay: { ...current, playing: playing && current.at < current.commands.length } })
    if (playing) void autoPlay(run)
  },

  playOn() {
    const current = get().replay
    if (!current || current.at < current.commands.length) return
    // The whole match as imported, undone entries and all: played on hot-seat and saved from now on.
    // The events are the ones replay found, in case the file came without them.
    replayRun++
    let active = 0
    const file: MatchFile = { ...current.source, entries: current.source.entries.map((e) => (e.undone ? e : { ...e, events: current.events[active++]! })) }
    generation++
    set({ ...loaded(get().config, file, current.states.at(-1)!), replay: null, message: 'Playing on from here' })
    persist(file)
    persistComputer(null, {})
  },

  send(command, computerTarget = null) {
    const { file, game, selected, replay: replaying } = get()
    if (!file || !game || replaying) return
    try {
      const result = record(file, game, command, Date.now())
      const next = result.state
      const options = availableCommands(next)
      persist(result.file)
      set({
        file: result.file,
        game: next,
        options,
        undoReason: undoReasonFor(result.file, get().config, get().computer),
        lastEvents: result.events,
        lastEventIcons: eventIconsOf(game, command, result.events, next),
        cues: withCues(get().cues, result.events, game),
        caption: nextCaption(get().caption, game, command, result.events, next, computerTarget),
        flashes: flashesOf(game, result.events, next).map((f) => ({ ...f, id: ++shown })),
        notice: get().notice,
        // On a phone the panel is out of sight, so say where the activation's controls are.
        // Not when the computer activates: the hint is for the human's own player.
        message: command.type === 'activate' && !computerToAct(game, get().computer) ? 'Tap the player again for End activation and his other options' : null,
        confirm: null,
        preview: null,
        // Follow the active player; drop the selection when the go moves on. At setup, the next player on the bench (#151).
        selected:
          next.phase === 'Setup'
            ? setupSelection(next, options, get().computer?.team ?? null)
            : (next.activation?.playerId ?? (next.phase === 'Round' && command.type !== 'endActivation' ? selected : null)),
        aiming: get().aiming && next.activation !== null && command.type !== 'pass',
        leaping: false,
        controls: false,
        goMenu: null,
      })
      playBall(ballSegments(game, result.events))
      showAfterHold(game, result.events, noticeOf(result.events, next, result.file, get().computer?.team ?? null), bannerFor(result.events))
      lastSent = Date.now()
      lastSentType = command.type
      if (sendBlockChoice()) return
    } catch (error) {
      set({ message: (error as Error).message, confirm: null, blockChoice: null })
    }
    drive()
  },

  dispatch(command, then = []) {
    const { game, computer, replay: replaying } = get()
    if (!game || replaying) return
    if (computerToAct(game, computer)) return
    // A block or foul shows its odds first, so the coach can still back out (#180).
    const declared = declaredOdds(game, command)
    if (declared) {
      set({ confirm: { command, previews: declared.previews, stopInstead: null, then, declared } })
      return
    }
    const previews = previewRolls(game, command)
    if (previews.length > 0) {
      set({ confirm: { command, previews, stopInstead: null, then } })
      return
    }
    get().send(command)
    if (then.length > 0) get().walk(then)
  },

  walk(path) {
    // Step along the path while no roll is needed, one step every WALK_STEP_MS; stop at the
    // first roll for the coach to confirm. The first step goes at once.
    const step = (remaining: Hex[], expected: MatchFile | null) => {
      const { game, options, file } = get()
      // Anything else that changed the match (End activation, undo, a new match) ends the walk.
      if (expected !== null && file !== expected) return
      if (remaining.length === 0 || !game?.activation || game.pending) {
        set({ walking: false })
        return
      }
      const [next, ...rest] = remaining as [Hex, ...Hex[]]
      const command = nextStep(options, next, rest.length > 0)
      if (!command) {
        set({ message: 'The path is blocked from here', walking: false })
        return
      }
      const previews = previewRolls(game, command.command)
      if (previews.length > 0) {
        set({ confirm: { command: command.command, previews, stopInstead: command.stopInstead, then: rest }, walking: false })
        return
      }
      get().send(command.command)
      const after = get().file
      if (rest.length === 0 || !get().game?.activation || get().game?.pending) {
        set({ walking: false })
        return
      }
      set({ walking: true })
      setTimeout(() => step(rest, after), WALK_STEP_MS)
    }
    step(path, null)
  },

  confirmGo() {
    const confirm = get().confirm
    if (!confirm) return
    get().send(confirm.command)
    if (confirm.then.length > 0) get().walk(confirm.then)
  },

  confirmBlock(choice) {
    set({ blockChoice: choice })
    get().confirmGo()
  },

  confirmStop() {
    const confirm = get().confirm
    if (confirm?.stopInstead) get().send(confirm.stopInstead)
  },

  cancel() {
    set({ confirm: null, aiming: false, leaping: false })
  },

  select(playerId) {
    set({ selected: playerId, message: null, goMenu: null })
  },

  closeGoMenu() {
    set({ goMenu: null })
  },

  clearBanner(id) {
    if (get().banner?.id === id) set({ banner: null })
  },

  clearNotice(id) {
    if (get().notice?.id === id) set({ notice: null })
  },

  openLog() {
    set({ logOpen: true })
  },

  closeLog() {
    set({ logOpen: false })
    drive()
  },

  setAiming(aiming) {
    set({ aiming, leaping: false, message: null })
  },

  setLeaping(leaping) {
    set({ leaping, aiming: false, message: null })
  },

  hover(hex) {
    const { preview, walking, ballMoving, confirm, game, computer, replay: replaying } = get()
    // No path for a player the computer is moving (#113), nor in a replay (#188).
    if (replaying || walking || ballMoving || confirm || (hex !== null && computerToAct(game, computer))) return
    if (hex === null ? preview !== null : !preview || !hexEquals(preview, hex)) set({ preview: hex })
  },

  tapHex(hex, touch = false) {
    const { game, options, selected, confirm, aiming, leaping, computer, walking, ballMoving, preview, replay: replaying } = get()
    // Taps wait while a player walks, the ball is still on its way (#161) or a touchdown is shown. A replay is only watched (#188).
    if (!game || walking || ballMoving || get().held) return
    if (replaying) {
      set({ message: 'This is a replay: step through it with the replay controls' })
      return
    }
    if (computerToAct(game, computer)) {
      set({ message: 'The computer is playing; wait for your go' })
      return
    }
    if (confirm) set({ confirm: null })
    // Tapping the active player opens or closes his controls; any other tap closes them.
    const active = game.activation ? game.players[game.activation.playerId]!.hex : null
    if (!game.pending && active && hexEquals(active, hex)) {
      set({ controls: !get().controls, message: null })
      return
    }
    set({ controls: false })
    const result = tapHex(game, options, selected, hex, aiming ? 'pass' : leaping ? 'leap' : null, { touch, previewed: preview })
    if (result.select !== undefined) set({ selected: result.select, ...(result.select !== null && { selectTaps: get().selectTaps + 1 }) })
    // An empty hex on the coach's go, outside an activation, opens Undo, Wait and Momentum there (#258); any other tap shuts it.
    // With it open, a tap on any empty hex shuts it instead of moving it.
    const open = get().goMenu
    set({ goMenu: emptyHexMenu(game, hex, result) && !open ? hex : null })
    set({ message: result.message ?? null, preview: result.preview ?? null, route: null })
    if (result.command) get().dispatch(result.command)
    if (result.path) {
      set({ route: routeTo(game, hex) })
      get().walk(result.path)
    }
  },

  quit() {
    generation++
    ballRun++
    replayRun++
    // Leaving a replay leaves the saved match alone: the replay was never saved.
    if (!get().replay) void clearMatch().catch(() => {})
    set({ screen: 'start', file: null, game: null, options: [], lastEvents: [], lastEventIcons: [], undoReason: null, computer: null, reasons: {}, thinking: false, replay: null, ...idle })
  },
}))

/**
 * Auto-play (#188): step a replay forward one command at a time, at the
 * computer's pace and holding longer after an activation starts, waiting for
 * the ball and the log. Stops at the end, or on Pause, a step back, a jump
 * or leaving the replay.
 */
async function autoPlay(run: number): Promise<void> {
  for (;;) {
    const before = useMatch.getState().replay
    if (run !== replayRun || !before?.playing) return
    if (before.at >= before.commands.length) {
      useMatch.setState({ replay: { ...before, playing: false } })
      return
    }
    useMatch.getState().replayStep(1)
    const command = before.commands[before.at]!
    await new Promise((resolve) => setTimeout(resolve, command.type === 'activate' ? ACTIVATION_HOLD_MS : REPLAY_PAUSE_MS))
    await logClosed()
    await ballStopped()
  }
}

/**
 * Play the ball's way (#171): the board draws it from `ballFlight`, and the
 * ball counts as moving (taps, prompts and the computer wait) until it has
 * come to rest. With reduced motion it's one short slide.
 */
function playBall(segments: BallSegment[]): void {
  const run = ++ballRun
  if (segments.length === 0) {
    if (useMatch.getState().ballMoving) useMatch.setState({ ballFlight: null, ballMoving: false })
    return
  }
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const shown = reduced ? stillSegments(segments) : segments
  useMatch.setState({ ballFlight: { segments: shown, start: Date.now() }, ballMoving: true })
  setTimeout(() => {
    if (run !== ballRun) return
    useMatch.setState({ ballFlight: null, ballMoving: false })
  }, totalMs(shown))
}

/**
 * After a touchdown, show the scorer in the end zone (with the ball's way
 * there first), then clear the board and show the notice. Any other command's
 * notice and banner show once the ball has landed (#171), at once if it didn't move.
 */
function showAfterHold(before: GameState, events: GameEvent[], notice: Notice | null, banner: Banner | null): void {
  const held = scoredPosition(before, events)
  if (!held) {
    // A banner (a new round, a touchback...) waits for the ball to land (#171), as everything else does.
    const show = () => {
      if (notice) useMatch.setState({ notice: withId(notice) })
      if (banner) useMatch.setState({ banner })
    }
    if (!useMatch.getState().ballMoving) show()
    else void settled((s) => !s.ballMoving).then(show)
    return
  }
  useMatch.setState({ held })
  void settled((s) => !s.ballMoving).then(() =>
    setTimeout(() => {
      // Anything that moved the match on since (undo, a replay step, a new match) drops the hold.
      if (useMatch.getState().held !== held) return
      useMatch.setState({ held: null, ...(notice ? { notice: withId(notice) } : {}) })
    }, TOUCHDOWN_HOLD_MS),
  )
}

/** Resolves once the ball has stopped stepping (#161) and a touchdown has been shown: the computer waits for both. */
function ballStopped(): Promise<void> {
  return settled((s) => !s.ballMoving && !s.held)
}

/** Resolves once the store meets the condition. */
function settled(done: (s: MatchStore) => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (done(useMatch.getState())) return resolve()
    const stop = useMatch.subscribe((s) => {
      if (!done(s)) return
      stop()
      resolve()
    })
  })
}

/** Resolves once the match log isn't open: the computer doesn't act behind it (#127). */
function logClosed(): Promise<void> {
  return new Promise((resolve) => {
    if (!useMatch.getState().logOpen) return resolve()
    const stop = useMatch.subscribe((s) => {
      if (s.logOpen) return
      stop()
      resolve()
    })
  })
}

/**
 * The Shove or Tackle chosen with the block's odds (#189), sent once the
 * engine asks for it. It waits while the defender decides on a Brace. If the
 * Brace leaves the attacker too weak to Shove, the coach is asked as before.
 * True if it sent the choice (and so drove the computer already).
 */
function sendBlockChoice(): boolean {
  const { blockChoice, game, send } = useMatch.getState()
  if (!blockChoice || !game) return false
  // It waits through the defender's answers first: a Dump-Off and its pass (#225), and Brace.
  if (game.pending && game.pending.kind !== 'blocking.shoveOrTackle') return false
  useMatch.setState({ blockChoice: null })
  if (game.pending?.kind !== 'blocking.shoveOrTackle') return false
  if (!game.pending.choices.some((c) => c.id === blockChoice)) {
    useMatch.setState({ message: 'He braced: too weak to Shove now' })
    return false
  }
  send({ type: 'decide', choice: blockChoice })
  return true
}

/**
 * If the computer's team must act, ask the worker for its command and send it
 * after the pause. Called after every change to the match; does nothing while
 * the computer is already thinking or it's the human's move.
 */
function drive(): void {
  const { game, file, computer, thinking } = useMatch.getState()
  if (!game || !file || !computer || thinking || !computerToAct(game, computer)) return
  const mine = generation
  const at = file.entries.length
  useMatch.setState({ thinking: true })
  askComputer(game, computer.team, computer.level, (file.seed * 7_919 + at) >>> 0)
    .then(async (choice) => {
      // After starting an activation the computer holds a little longer, so its caption can be read (#126).
      const wait = lastSent + (lastSentType === 'activate' ? ACTIVATION_HOLD_MS : COMPUTER_PAUSE_MS) - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      await logClosed()
      await ballStopped()
      // The match changed under it (new match, import, quit): drop the answer.
      if (mine !== generation || useMatch.getState().file?.entries.length !== at) return
      useMatch.setState({ thinking: false })
      const store = useMatch.getState()
      store.send(choice.command, choice.target ?? null)
      const after = useMatch.getState()
      // Ending an activation is the end of the plan whose reason is already in the log, not a new one.
      if (after.file && after.file.entries.length > at && choice.command.type !== 'endActivation') {
        const reason: Reason = choice.plan === undefined ? { text: choice.reason } : { text: choice.reason, plan: choice.plan }
        const reasons = { ...after.reasons, [at]: reason }
        useMatch.setState({ reasons })
        persistComputer(after.computer, reasons)
      }
    })
    .catch((error: Error) => {
      if (mine !== generation) return
      useMatch.setState({ thinking: false, message: `The computer couldn’t move: ${error.message}` })
    })
}
