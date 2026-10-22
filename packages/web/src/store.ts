import {
  availableCommands,
  type Command,
  type CommandOption,
  createMatch,
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
  rulesV10,
} from '@orcball/engine'
import { create } from 'zustand'
import { nextStep, tapHex } from './interaction'

// The app's one store: the rule config, the match file (the log) and the
// engine state it produces, the command options for that state, and view
// state: the selected player, a path being walked, and a roll waiting for
// confirmation. Every command goes through record(), so the match file is
// always complete.
//
// Any command that rolls dice is held back until the coach has seen the odds:
// it waits in `confirm` and is sent by confirmGo().

export const CONFIGS: RuleConfig[] = [rulesV10]

export type Screen = 'start' | 'match'

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
  start(config: RuleConfig, seed: number): void
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

export const useMatch = create<MatchStore>((set, get) => ({
  screen: 'start',
  config: rulesV10,
  file: null,
  game: null,
  options: [],
  lastEvents: [],
  ...idle,

  start(config, seed) {
    const rosters = rostersOf(config)
    const game = createMatch(config, rosters, seed)
    set({ screen: 'match', config, file: newMatchFile(config, rosters, seed), game, options: availableCommands(game), lastEvents: [], ...idle })
  },

  send(command) {
    const { file, game, selected } = get()
    if (!file || !game) return
    try {
      const result = record(file, game, command, Date.now())
      const next = result.state
      set({
        file: result.file,
        game: next,
        options: availableCommands(next),
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
    set({ screen: 'start', file: null, game: null, options: [], lastEvents: [], ...idle })
  },
}))
