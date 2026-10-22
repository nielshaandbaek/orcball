import { z } from 'zod'
import { type Roster, type RuleConfig, ruleConfigHash } from './config'
import { engine } from './default-engine'
import { canonicalJson } from './json'
import { createMatch } from './match'
import type { Command, GameEvent, GameState } from './state'

// The match log (ARCHITECTURE.md "Logging, replay, undo, stats").
//
// A match file is the seed, the rule config's id and hash, the rosters and
// every command, with the events each produced and an optional timestamp from
// the caller (the engine has no clock). The commands are the source of truth:
// replaying them from the seed rebuilds every state exactly.
//
// Undo drops the last command by flagging it, and the state is rebuilt by
// replay. It's refused once the dice have been used by that command, any die,
// not only a D10 test: replaying from the same seed would let a coach see the
// result and then choose differently. Only the last command can be undone, so
// two undos in a row are refused too. Undone commands stay in the file for
// the stats to count or ignore.

export const MATCH_FILE_FORMAT = 'orcball-match/1'

export type LogEntry = {
  command: Command
  events: GameEvent[]
  /** Milliseconds since the epoch, from the caller; null if not recorded. */
  at: number | null
  /** True once undone: replay skips it. */
  undone?: true
}

export type MatchFile = {
  format: typeof MATCH_FILE_FORMAT
  seed: number
  configId: string
  configHash: string
  rosters: [Roster, Roster]
  entries: LogEntry[]
}

export class MatchFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MatchFileError'
  }
}

export function newMatchFile(config: RuleConfig, rosters: [Roster, Roster], seed: number): MatchFile {
  return {
    format: MATCH_FILE_FORMAT,
    seed,
    configId: config.id,
    configHash: ruleConfigHash(config),
    rosters: structuredCopy(rosters),
    entries: [],
  }
}

function structuredCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function checkConfig(file: MatchFile, config: RuleConfig): void {
  const hash = ruleConfigHash(config)
  if (file.configHash !== hash) {
    throw new MatchFileError(
      `This match was played with rule config ${file.configId} (hash ${file.configHash}), ` +
        `but the loaded config is ${config.id} (hash ${hash}). Load the same config to replay it.`,
    )
  }
}

/** The commands replay applies: everything not undone. */
function activeEntries(file: MatchFile): LogEntry[] {
  return file.entries.filter((e) => !e.undone)
}

/**
 * Rebuild the state by re-applying the commands from the seed. `step` is how
 * many commands to apply (all by default), so a viewer can step through.
 */
export function replay(file: MatchFile, config: RuleConfig, step?: number): GameState {
  checkConfig(file, config)
  const entries = activeEntries(file)
  const count = step === undefined ? entries.length : Math.max(0, Math.min(step, entries.length))
  let state = createMatch(config, file.rosters, file.seed)
  for (const entry of entries.slice(0, count)) state = engine.apply(state, entry.command).state
  return state
}

/** Apply a command and add it to the log. Throws if the command isn't legal. */
export function record(
  file: MatchFile,
  state: GameState,
  command: Command,
  at: number | null = null,
): { file: MatchFile; state: GameState; events: GameEvent[] } {
  const result = engine.apply(state, command)
  const entry: LogEntry = { command: structuredCopy(command), events: result.events, at }
  return { file: { ...file, entries: [...file.entries, entry] }, state: result.state, events: result.events }
}

/** Why the last command can't be undone, or null if it can. */
export function undoBlocked(file: MatchFile, config: RuleConfig): string | null {
  const last = file.entries.at(-1)
  if (!last) return 'Nothing to undo yet'
  if (last.undone) return 'Only the last action can be undone'
  // Replay to just before and just after the command, and compare the dice.
  const active = activeEntries(file)
  const before = replay(file, config, active.length - 1)
  const after = engine.apply(before, last.command).state
  if (canonicalJson(before.rng) !== canonicalJson(after.rng)) return "Dice have been rolled, so this can't be undone"
  return null
}

/** Undo the last command: it stays in the log, flagged, and the state is rebuilt without it. */
export function undo(file: MatchFile, config: RuleConfig): { file: MatchFile; state: GameState } {
  const reason = undoBlocked(file, config)
  if (reason) throw new MatchFileError(reason)
  const entries = file.entries.map((e, i) => (i === file.entries.length - 1 ? { ...e, undone: true as const } : e))
  const next = { ...file, entries }
  return { file: next, state: replay(next, config) }
}

export function exportMatch(file: MatchFile): string {
  return JSON.stringify(file, null, 2)
}

const MatchFileSchema = z.object({
  format: z.literal(MATCH_FILE_FORMAT),
  seed: z.number(),
  configId: z.string(),
  configHash: z.string(),
  rosters: z.tuple([z.unknown(), z.unknown()]),
  entries: z.array(
    z.object({
      command: z.looseObject({ type: z.string() }),
      events: z.array(z.unknown()),
      at: z.number().nullable(),
      undone: z.literal(true).optional(),
    }),
  ),
})

/**
 * Read an exported match file and check it was played with the loaded config.
 * Throws a MatchFileError saying what's wrong.
 */
export function importMatch(json: string, config: RuleConfig): MatchFile {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new MatchFileError('This file is not valid JSON, so it is not a match file')
  }
  const result = MatchFileSchema.safeParse(data)
  if (!result.success) {
    const issue = result.error.issues[0]!
    const path = issue.path.map(String).join('.')
    throw new MatchFileError(`This is not an OrcBall match file (${path ? `${path}: ` : ''}${issue.message})`)
  }
  const file = result.data as unknown as MatchFile
  checkConfig(file, config)
  return file
}
