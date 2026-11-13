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
  newMatchFile,
  previewRolls,
  type RollPreview,
  type Roster,
  type RuleConfig,
  record,
  replay,
  rulesV10,
  rulesV11,
  rulesV12,
  rulesV13,
  rulesV14,
  rulesV15,
  rulesV16,
  rulesV17,
  rulesV18,
  type TeamId,
  undo,
  undoBlocked,
} from '@orcball/engine'
import { actingTeam, type AiLevel, viewOf } from '@orcball/ai'
import { create } from 'zustand'
import { ACTIVATION_HOLD_MS, type Caption, type CaptionTarget, type Flash, flashesOf, nextCaption, type Notice, noticeOf } from './captions'
import { ballSteps } from './ballpath'
import { type EventIconAt, eventIconsOf } from './effects'
import { askComputer } from './computer'
import { nextStep, type Route, routeTo, setupSelection, tapHex } from './interaction'
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

/** Newest first: the start screen offers the first one. */
export const CONFIGS: RuleConfig[] = [rulesV18, rulesV17, rulesV16, rulesV15, rulesV14, rulesV13, rulesV12, rulesV11, rulesV10]

export const CONFIG_LABELS: Record<string, string> = {
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

/** The pause between the steps of a move the coach taps out, so the player is seen walking his path (#112). */
export const WALK_STEP_MS = 200

export type Confirm = {
  command: Command
  previews: RollPreview[]
  /** For a Dodge: stepping in and stopping instead, with no roll. */
  stopInstead: Command | null
  /** The rest of a path to walk after this step. */
  then: Hex[]
}

export type MatchStore = {
  screen: Screen
  config: RuleConfig
  file: MatchFile | null
  game: GameState | null
  options: CommandOption[]
  selected: string | null
  message: string | null
  lastEvents: GameEvent[]
  /** The event icons the last command set off (art/icons/events). */
  lastEventIcons: EventIconAt[]
  aiming: boolean
  /** A round has just started: shown briefly over the board (#81). Only from a command, never from undo or a reload. */
  banner: Banner | null
  clearBanner(id: number): void
  /** The active player's controls are open on the board: tapping him opens and closes them (#91). */
  controls: boolean
  confirm: Confirm | null
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
  /** Where the ball is shown while it steps through the hexes it bounced, scattered or was thrown in to (#161), else null. */
  ballAt: Hex | null
  /** The ball is still stepping: taps on the board and the computer wait until it stops (#161). */
  ballMoving: boolean
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
  /** Restore the saved match, if any, on startup. */
  restore(): Promise<void>
  start(config: RuleConfig, seed: number, computer?: Computer | null): void
  undo(): void
  exportJson(): string | null
  importJson(json: string): void
  /** Send a command; the computer passes its plan's target, for the caption (#126). */
  send(command: Command, computerTarget?: CaptionTarget | null): void
  /** Send a command, or hold it for confirmation if it rolls dice. */
  dispatch(command: Command, then?: Hex[]): void
  confirmGo(): void
  confirmStop(): void
  cancel(): void
  walk(path: Hex[]): void
  select(playerId: string | null): void
  setAiming(aiming: boolean): void
  /** The mouse is over this hex of the pitch, or has left it (null). */
  hover(hex: Hex | null): void
  tapHex(hex: Hex, touch?: boolean): void
  quit(): void
}

function rostersOf(config: RuleConfig): [Roster, Roster] {
  const all = Object.values(config.rosters)
  return [config.rosters.orcs ?? all[0]!, config.rosters.elves ?? all[1] ?? all[0]!]
}

const idle = { selected: null, message: null, aiming: false, controls: false, confirm: null, banner: null, walking: false, ballAt: null, ballMoving: false, preview: null, route: null, logOpen: false, caption: null, flashes: [], notice: null }

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
  thinking: false,
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
        set(loaded(config, file, replay(file, config), saved ? (computer as Computer) : null, upgraded))
        drive()
        return
      }
    } catch {
      // A saved match that can't be read is dropped; start fresh.
      void clearMatch().catch(() => {})
    }
    set({ screen: 'start' })
  },

  start(config, seed, computer = null) {
    const rosters = rostersOf(config)
    const file = newMatchFile(config, rosters, seed)
    generation++
    set(loaded(config, file, createMatch(config, rosters, seed), computer))
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
      const { configId } = JSON.parse(json) as { configId?: string }
      const config = configFor({ configId: configId ?? '' } as MatchFile)
      const file = importMatch(json, config)
      // An imported match is played hot-seat: the match file doesn't say who the computer was.
      generation++
      set({ ...loaded(config, file, replay(file, config)), message: 'Match imported' })
      persist(file)
      persistComputer(null, {})
    } catch (error) {
      set({ message: error instanceof SyntaxError ? 'This file is not valid JSON, so it is not a match file' : (error as Error).message })
    }
  },

  send(command, computerTarget = null) {
    const { file, game, selected } = get()
    if (!file || !game) return
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
        caption: nextCaption(get().caption, game, command, result.events, next, computerTarget),
        flashes: flashesOf(game, result.events, next).map((f) => ({ ...f, id: ++shown })),
        notice: withId(noticeOf(result.events, next, result.file, get().computer?.team ?? null)) ?? get().notice,
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
        controls: false,
        banner: bannerFor(result.events) ?? get().banner,
      })
      stepBall(ballSteps(result.events))
      lastSent = Date.now()
      lastSentType = command.type
    } catch (error) {
      set({ message: (error as Error).message, confirm: null })
    }
    drive()
  },

  dispatch(command, then = []) {
    const { game, computer } = get()
    if (!game) return
    if (computerToAct(game, computer)) return
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

  confirmStop() {
    const confirm = get().confirm
    if (confirm?.stopInstead) get().send(confirm.stopInstead)
  },

  cancel() {
    set({ confirm: null, aiming: false })
  },

  select(playerId) {
    set({ selected: playerId, message: null })
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
    set({ aiming, message: null })
  },

  hover(hex) {
    const { preview, walking, ballMoving, confirm, game, computer } = get()
    // No path for a player the computer is moving (#113).
    if (walking || ballMoving || confirm || (hex !== null && computerToAct(game, computer))) return
    if (hex === null ? preview !== null : !preview || !hexEquals(preview, hex)) set({ preview: hex })
  },

  tapHex(hex, touch = false) {
    const { game, options, selected, confirm, aiming, computer, walking, ballMoving, preview } = get()
    // Taps wait while a player walks or the ball is still on its way (#161).
    if (!game || walking || ballMoving) return
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
    const result = tapHex(game, options, selected, hex, aiming, { touch, previewed: preview })
    if (result.select !== undefined) set({ selected: result.select })
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
    void clearMatch().catch(() => {})
    set({ screen: 'start', file: null, game: null, options: [], lastEvents: [], lastEventIcons: [], undoReason: null, computer: null, reasons: {}, thinking: false, ...idle })
  },
}))

/** Resolves once the match log isn't open: the computer doesn't act behind it (#127). */
/** Show the ball in each hex of its way (#161), one every WALK_STEP_MS, then hand it back to the match state. */
function stepBall(hexes: Hex[]): void {
  const run = ++ballRun
  if (hexes.length < 2) {
    if (useMatch.getState().ballMoving) useMatch.setState({ ballAt: null, ballMoving: false })
    return
  }
  useMatch.setState({ ballAt: hexes[0]!, ballMoving: true })
  hexes.slice(1).forEach((hex, i) => {
    setTimeout(() => run === ballRun && useMatch.setState({ ballAt: hex }), (i + 1) * WALK_STEP_MS)
  })
  setTimeout(() => {
    if (run !== ballRun) return
    useMatch.setState({ ballAt: null, ballMoving: false })
  }, hexes.length * WALK_STEP_MS)
}

/** Resolves once the ball has stopped stepping (#161): the computer waits for it. */
function ballStopped(): Promise<void> {
  return new Promise((resolve) => {
    if (!useMatch.getState().ballMoving) return resolve()
    const stop = useMatch.subscribe((s) => {
      if (s.ballMoving) return
      stop()
      resolve()
    })
  })
}

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
