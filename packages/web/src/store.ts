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
  type TeamId,
  undo,
  undoBlocked,
} from '@orcball/engine'
import { actingTeam, type AiLevel, viewOf } from '@orcball/ai'
import { create } from 'zustand'
import { askComputer } from './computer'
import { nextStep, tapHex } from './interaction'
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
export const CONFIGS: RuleConfig[] = [rulesV12, rulesV11, rulesV10]

export const CONFIG_LABELS: Record<string, string> = {
  'rules-v12': 'v12: v11 plus Block and Brace skills, defender chooses on a missed Tackle',
  'rules-v11': 'v11: Dodge out of tackle zones, Strength Disengage',
  'rules-v10': 'v10: stop in tackle zones',
}

export type Screen = 'loading' | 'start' | 'match'

/** The computer opponent: the team it plays and its level. */
export type Computer = { team: TeamId; level: AiLevel }

export const LEVEL_LABELS: Record<AiLevel, string> = { novice: 'Novice', intermediate: 'Intermediate', expert: 'Expert' }

/** The pause between the computer's commands, so each one can be followed on the board. */
export const COMPUTER_PAUSE_MS = 700

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
  aiming: boolean
  confirm: Confirm | null
  /** Why undo isn't allowed right now, or null if it is. */
  undoReason: string | null
  /** The computer opponent, or null for a hot-seat match. */
  computer: Computer | null
  /** The computer's reason for each match-file entry it sent, by entry index. */
  reasons: Record<number, string>
  /** The computer is choosing its next command. */
  thinking: boolean
  /** Restore the saved match, if any, on startup. */
  restore(): Promise<void>
  start(config: RuleConfig, seed: number, computer?: Computer | null): void
  undo(): void
  exportJson(): string | null
  importJson(json: string): void
  send(command: Command): void
  /** Send a command, or hold it for confirmation if it rolls dice. */
  dispatch(command: Command, then?: Hex[]): void
  confirmGo(): void
  confirmStop(): void
  cancel(): void
  walk(path: Hex[]): void
  select(playerId: string | null): void
  setAiming(aiming: boolean): void
  tapHex(hex: Hex): void
  quit(): void
}

function rostersOf(config: RuleConfig): [Roster, Roster] {
  const all = Object.values(config.rosters)
  return [config.rosters.orcs ?? all[0]!, config.rosters.elves ?? all[1] ?? all[0]!]
}

const idle = { selected: null, message: null, aiming: false, confirm: null }

/** Whether the computer's team must act now: its go, its activation, or a decision addressed to it. */
export function computerToAct(game: GameState | null, computer: Computer | null): boolean {
  return computer !== null && game !== null && game.phase !== 'FullTime' && actingTeam(viewOf(game)) === computer.team
}

function undoReasonFor(file: MatchFile, config: RuleConfig, computer: Computer | null): string | null {
  return computer ? 'Undo isn’t available in a match against the computer' : undoBlocked(file, config)
}

function persistComputer(computer: Computer | null, reasons: Record<number, string>): void {
  void saveComputer(computer ? JSON.stringify({ ...computer, reasons }) : null).catch(() => {})
}

/** Bumped whenever the match changes under the computer (new match, import, quit), so a late answer is dropped. */
let generation = 0
/** When the last command was sent, for the pause before the computer's next one. */
let lastSent = 0

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
function loaded(config: RuleConfig, file: MatchFile, game: GameState, computer: Computer | null = null, reasons: Record<number, string> = {}) {
  return {
    screen: 'match' as const,
    config,
    file,
    game,
    options: availableCommands(game),
    undoReason: undoReasonFor(file, config, computer),
    lastEvents: [],
    computer,
    reasons,
    thinking: false,
    ...idle,
  }
}

export const useMatch = create<MatchStore>((set, get) => ({
  screen: 'loading',
  config: rulesV10,
  file: null,
  game: null,
  options: [],
  lastEvents: [],
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
        const { reasons = {}, ...computer } = saved ? (JSON.parse(saved) as Computer & { reasons?: Record<number, string> }) : { reasons: {} }
        generation++
        set(loaded(config, file, replay(file, config), saved ? (computer as Computer) : null, reasons))
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

  send(command) {
    const { file, game, selected } = get()
    if (!file || !game) return
    try {
      const result = record(file, game, command, Date.now())
      const next = result.state
      persist(result.file)
      set({
        file: result.file,
        game: next,
        options: availableCommands(next),
        undoReason: undoReasonFor(result.file, get().config, get().computer),
        lastEvents: result.events,
        message: null,
        confirm: null,
        // Follow the active player; drop the selection when the go moves on.
        selected: next.activation?.playerId ?? (next.phase === 'Round' && command.type !== 'endActivation' ? selected : null),
        aiming: get().aiming && next.activation !== null && command.type !== 'pass',
      })
      lastSent = Date.now()
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
    // Step along the path while no roll is needed; stop at the first roll for the coach to confirm.
    let remaining = path
    while (remaining.length > 0) {
      const { game, options } = get()
      if (!game?.activation || game.pending) return
      const [next, ...rest] = remaining as [Hex, ...Hex[]]
      const step = nextStep(options, next, rest.length > 0)
      if (!step) {
        set({ message: 'The path is blocked from here' })
        return
      }
      const previews = previewRolls(game, step.command)
      if (previews.length > 0) {
        set({ confirm: { command: step.command, previews, stopInstead: step.stopInstead, then: rest } })
        return
      }
      get().send(step.command)
      remaining = rest
    }
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

  setAiming(aiming) {
    set({ aiming, message: null })
  },

  tapHex(hex) {
    const { game, options, selected, confirm, aiming, computer } = get()
    if (!game) return
    if (computerToAct(game, computer)) {
      set({ message: 'The computer is playing; wait for your go' })
      return
    }
    if (confirm) set({ confirm: null })
    const result = tapHex(game, options, selected, hex, aiming)
    if (result.select !== undefined) set({ selected: result.select })
    set({ message: result.message ?? null })
    if (result.command) get().dispatch(result.command)
    if (result.path) get().walk(result.path)
  },

  quit() {
    generation++
    void clearMatch().catch(() => {})
    set({ screen: 'start', file: null, game: null, options: [], lastEvents: [], undoReason: null, computer: null, reasons: {}, thinking: false, ...idle })
  },
}))

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
      const wait = lastSent + COMPUTER_PAUSE_MS - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      // The match changed under it (new match, import, quit): drop the answer.
      if (mine !== generation || useMatch.getState().file?.entries.length !== at) return
      useMatch.setState({ thinking: false })
      const store = useMatch.getState()
      store.send(choice.command)
      const after = useMatch.getState()
      // Ending an activation is the end of the plan whose reason is already in the log, not a new one.
      if (after.file && after.file.entries.length > at && choice.command.type !== 'endActivation') {
        const reasons = { ...after.reasons, [at]: choice.reason }
        useMatch.setState({ reasons })
        persistComputer(after.computer, reasons)
      }
    })
    .catch((error: Error) => {
      if (mine !== generation) return
      useMatch.setState({ thinking: false, message: `The computer couldn’t move: ${error.message}` })
    })
}
