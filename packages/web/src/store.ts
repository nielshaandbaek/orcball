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
  undo,
  undoBlocked,
} from '@orcball/engine'
import { create } from 'zustand'
import { nextStep, tapHex } from './interaction'
import { clearMatch, loadMatch, saveMatch } from './storage'

// The app's one store: the rule config, the match file (the log) and the
// engine state it produces, the command options for that state, and view
// state: the selected player, a path being walked, and a roll waiting for
// confirmation. Every command goes through record(), so the match file is
// always complete.
//
// Any command that rolls dice is held back until the coach has seen the odds:
// it waits in `confirm` and is sent by confirmGo().

export const CONFIGS: RuleConfig[] = [rulesV10]

export type Screen = 'loading' | 'start' | 'match'

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
  /** Restore the saved match, if any, on startup. */
  restore(): Promise<void>
  start(config: RuleConfig, seed: number): void
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
function loaded(config: RuleConfig, file: MatchFile, game: GameState) {
  return { screen: 'match' as const, config, file, game, options: availableCommands(game), undoReason: undoBlocked(file, config), lastEvents: [], ...idle }
}

export const useMatch = create<MatchStore>((set, get) => ({
  screen: 'loading',
  config: rulesV10,
  file: null,
  game: null,
  options: [],
  lastEvents: [],
  undoReason: null,
  ...idle,

  async restore() {
    try {
      const json = await loadMatch()
      if (json) {
        const { configId } = JSON.parse(json) as { configId: string }
        const config = configFor({ configId } as MatchFile)
        const file = importMatch(json, config)
        set(loaded(config, file, replay(file, config)))
        return
      }
    } catch {
      // A saved match that can't be read is dropped; start fresh.
      void clearMatch().catch(() => {})
    }
    set({ screen: 'start' })
  },

  start(config, seed) {
    const rosters = rostersOf(config)
    const file = newMatchFile(config, rosters, seed)
    set(loaded(config, file, createMatch(config, rosters, seed)))
    persist(file)
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
      set({ ...loaded(config, file, replay(file, config)), message: 'Match imported' })
      persist(file)
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
        undoReason: undoBlocked(result.file, get().config),
        lastEvents: result.events,
        message: null,
        confirm: null,
        // Follow the active player; drop the selection when the go moves on.
        selected: next.activation?.playerId ?? (next.phase === 'Round' && command.type !== 'endActivation' ? selected : null),
        aiming: get().aiming && next.activation !== null && command.type !== 'pass',
      })
    } catch (error) {
      set({ message: (error as Error).message, confirm: null })
    }
  },

  dispatch(command, then = []) {
    const { game } = get()
    if (!game) return
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
    const { game, options, selected, confirm, aiming } = get()
    if (!game) return
    if (confirm) set({ confirm: null })
    const result = tapHex(game, options, selected, hex, aiming)
    if (result.select !== undefined) set({ selected: result.select })
    set({ message: result.message ?? null })
    if (result.command) get().dispatch(result.command)
    if (result.path) get().walk(result.path)
  },

  quit() {
    void clearMatch().catch(() => {})
    set({ screen: 'start', file: null, game: null, options: [], lastEvents: [], undoReason: null, ...idle })
  },
}))
