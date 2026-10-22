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
  type Roster,
  type RuleConfig,
  record,
  rulesV10,
} from '@orcball/engine'
import { create } from 'zustand'
import { tapHex } from './interaction'

// The app's one store: the rule config, the match file (the log) and the
// engine state it produces, the command options for that state, and view
// state such as the selected player. Every command goes through record(), so
// the match file is always complete.

export const CONFIGS: RuleConfig[] = [rulesV10]

export type Screen = 'start' | 'match'

export type MatchStore = {
  screen: Screen
  config: RuleConfig
  file: MatchFile | null
  game: GameState | null
  options: CommandOption[]
  selected: string | null
  message: string | null
  lastEvents: GameEvent[]
  start(config: RuleConfig, seed: number): void
  send(command: Command): void
  select(playerId: string | null): void
  tapHex(hex: Hex): void
  quit(): void
}

function rostersOf(config: RuleConfig): [Roster, Roster] {
  const all = Object.values(config.rosters)
  return [config.rosters.orcs ?? all[0]!, config.rosters.elves ?? all[1] ?? all[0]!]
}

export const useMatch = create<MatchStore>((set, get) => ({
  screen: 'start',
  config: rulesV10,
  file: null,
  game: null,
  options: [],
  selected: null,
  message: null,
  lastEvents: [],

  start(config, seed) {
    const rosters = rostersOf(config)
    const game = createMatch(config, rosters, seed)
    set({
      screen: 'match',
      config,
      file: newMatchFile(config, rosters, seed),
      game,
      options: availableCommands(game),
      selected: null,
      message: null,
      lastEvents: [],
    })
  },

  send(command) {
    const { file, game } = get()
    if (!file || !game) return
    try {
      const result = record(file, game, command, Date.now())
      set({ file: result.file, game: result.state, options: availableCommands(result.state), message: null, lastEvents: result.events })
    } catch (error) {
      set({ message: (error as Error).message })
    }
  },

  select(playerId) {
    set({ selected: playerId, message: null })
  },

  tapHex(hex) {
    const { game, options, selected } = get()
    if (!game) return
    const result = tapHex(game, options, selected, hex)
    if (result.select !== undefined) set({ selected: result.select })
    set({ message: result.message ?? null })
    if (result.command) get().send(result.command)
  },

  quit() {
    set({ screen: 'start', file: null, game: null, options: [], selected: null, message: null, lastEvents: [] })
  },
}))
