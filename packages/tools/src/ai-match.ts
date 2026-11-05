import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { type AiLevel, actingTeam, chooseCommand, FEATURES, featureDifferences, loadWeights, viewOf, type Weights } from '@orcball/ai'
import {
  apply,
  type Command,
  createMatch,
  type GameState,
  type Roster,
  type RuleConfig,
  rulesV12,
  type TeamId,
} from '@orcball/engine'
import { invariantProblems, randomBot } from './bot'

// Computer against computer: any two contenders (the random bot or a
// computer level) play N matches. The first contender plays home in the first
// half of the run and away in the second, to cancel out any home or away
// advantage; the rosters stay with their side.

/** The random bot, a computer level, or a level with its own weights file: `novice:weights/tuned.json`. */
export type Contender = 'random' | AiLevel | `${AiLevel}:${string}`

export const CONTENDERS: readonly ('random' | AiLevel)[] = ['random', 'novice', 'intermediate', 'expert']

/** A contender's level and weights file (null for the default weights). Throws on an unknown name. */
export function parseContender(name: string): { level: 'random' | AiLevel; weightsFile: string | null } {
  const colon = name.indexOf(':')
  const level = (colon < 0 ? name : name.slice(0, colon)) as 'random' | AiLevel
  const weightsFile = colon < 0 ? null : name.slice(colon + 1)
  if (!CONTENDERS.includes(level)) throw new Error(`Unknown contender '${name}': use ${CONTENDERS.join(', ')}, or a level and a weights file, e.g. novice:weights.json`)
  if (level === 'random' && weightsFile !== null) throw new Error(`The random bot has no weights: '${name}'`)
  if (weightsFile === '') throw new Error(`No weights file after the colon: '${name}'`)
  return { level, weightsFile }
}

export type RunOptions = {
  /** The two contenders; the first starts at home. */
  contenders: [Contender, Contender]
  matches: number
  config?: RuleConfig
  /** Roster ids for home and away, e.g. ['orcs', 'elves']. */
  rosters?: [string, string]
  /** Thinking time per decision for the computer, in ms. */
  budgetMs?: number
  /** Seeds run from here up. */
  firstSeed?: number
  maxCommands?: number
  /** A decision slower than this is reported with its seed, in ms. */
  slowMs?: number
  /**
   * Play only one shard of the run: every `count`-th match, starting at
   * `index` (0-based), so each shard gets both halves of the run. The shards'
   * matches together are the whole run, combined with summariseRun.
   */
  shard?: { index: number; count: number }
  /** Record a sample at the start of every go, for fitting the weights (see fit.ts). */
  samples?: boolean
  /** Called after each match this run plays, for progress output. */
  onMatch?: (match: MatchResult, done: number, total: number) => void
}

export type MatchResult = {
  seed: number
  /** Index into the contenders playing home. */
  home: 0 | 1
  score: Record<TeamId, number>
  winner: TeamId | 'draw' | null
  activations: number
  /** Decision times in ms for each contender. */
  times: [number[], number[]]
  problem: string | null
  /** With `samples`: at the start of every go, each feature (in FEATURES order) as home's count minus away's. */
  samples?: number[][]
}

type Player = (state: GameState, commands: number) => Command | null

function player(contender: Contender, seed: number, budgetMs: number): Player {
  const { level, weightsFile } = parseContender(contender)
  if (level === 'random') return randomBot(seed)
  const weights = weightsFile ? weightsFrom(weightsFile) : undefined
  return (state, commands) => {
    const view = viewOf(state)
    const options = { level, budgetMs, seed: (Math.imul(seed, 100_003) + commands) >>> 0 }
    return chooseCommand(view, actingTeam(view), weights ? { ...options, weights } : options).command
  }
}

/** A weights file, read and checked (once per match). */
function weightsFrom(file: string): Weights {
  return loadWeights(JSON.parse(readFileSync(file, 'utf8')))
}

function rostersOf(config: RuleConfig, ids: [string, string]): [Roster, Roster] {
  return ids.map((id) => {
    const roster = config.rosters[id]
    if (!roster) throw new Error(`${config.id} has no roster '${id}' (it has ${Object.keys(config.rosters).join(', ')})`)
    return roster
  }) as [Roster, Roster]
}

/** One match: `home` says which contender plays home. */
export function playAiMatch(seed: number, home: 0 | 1, options: RunOptions): MatchResult {
  const config = options.config ?? rulesV12
  const budgetMs = options.budgetMs ?? 10_000
  const maxCommands = options.maxCommands ?? 20_000
  const index: Record<TeamId, 0 | 1> = { home, away: home === 0 ? 1 : 0 }
  // Seeded by side, not by contender, so a match replays with the contenders named in playing order.
  const players = options.contenders.map((c, i) => player(c, seed * 2 + (index.home === i ? 0 : 1), budgetMs))

  let state = createMatch(config, rostersOf(config, options.rosters ?? ['orcs', 'elves']), seed)
  const times: [number[], number[]] = [[], []]
  let commands = 0
  let activations = 0
  const samples: number[][] = []
  const result = (problem: string | null): MatchResult => ({
    seed,
    home,
    score: { home: state.teams.home.score, away: state.teams.away.score },
    winner: state.winner,
    activations,
    times,
    problem,
    ...(options.samples ? { samples } : {}),
  })

  while (state.phase !== 'FullTime') {
    if (commands >= maxCommands) return result(`stuck: no full time after ${maxCommands} commands (phase ${state.phase})`)
    if (options.samples && state.phase === 'Round' && !state.pending && !state.activation) {
      const differences = featureDifferences(viewOf(state), 'home')
      samples.push(FEATURES.map((f) => differences[f]))
    }
    const side = index[actingTeam(viewOf(state))]
    let command: Command | null
    const start = performance.now()
    try {
      command = players[side]!(state, commands)
    } catch (error) {
      return result(`${options.contenders[side]} failed on command ${commands + 1}: ${(error as Error).message}`)
    }
    times[side].push(performance.now() - start)
    if (!command) return result(`stuck: no legal commands in phase ${state.phase}`)
    try {
      const step = apply(state, command)
      state = step.state
      activations += step.events.filter((e) => e.type === 'activated').length
    } catch (error) {
      return result(`illegal command ${commands + 1} from ${options.contenders[side]}: ${(error as Error).message}`)
    }
    commands++
    const problems = invariantProblems(state)
    if (problems.length > 0) return result(`illegal state after command ${commands}: ${problems.join('; ')}`)
  }
  return result(null)
}

export type ContenderReport = {
  contender: Contender
  wins: number
  draws: number
  losses: number
  touchdownsPerMatch: number
  medianMs: number
  worstMs: number
  /** The seed of the worst decision. */
  worstSeed: number | null
}

export type RunReport = {
  options: RunOptions
  matches: MatchResult[]
  contenders: [ContenderReport, ContenderReport]
  activationsPerMatch: number
  problems: { match: MatchResult; problem: string }[]
  slow: { match: MatchResult; contender: Contender; ms: number }[]
}

export function runAiMatches(options: RunOptions): RunReport {
  const firstSeed = options.firstSeed ?? 1
  const half = Math.ceil(options.matches / 2)
  const { index, count } = options.shard ?? { index: 0, count: 1 }
  const mine = Array.from({ length: options.matches }, (_, i) => i).filter((i) => i % count === index)
  const matches: MatchResult[] = []
  for (const i of mine) {
    const match = playAiMatch(firstSeed + i, i < half ? 0 : 1, options)
    matches.push(match)
    options.onMatch?.(match, matches.length, mine.length)
  }
  return summariseRun(options, matches)
}

/** One line of progress after a match: how far the run is, the result, and time left at this pace. */
export function progressLine(options: RunOptions, match: MatchResult, done: number, total: number, elapsedMs: number): string {
  const [home, away] = match.home === 0 ? options.contenders : [options.contenders[1], options.contenders[0]]
  const shard = options.shard && options.shard.count > 1 ? `shard ${options.shard.index + 1}/${options.shard.count}: ` : ''
  const pct = Math.floor((100 * done) / total)
  const result = match.problem ? `problem: ${match.problem}` : `${home} ${match.score.home}-${match.score.away} ${away}`
  const left = done < total ? `, about ${duration((elapsedMs / done) * (total - done))} left` : ''
  return `${shard}${done}/${total} (${pct}%) seed ${match.seed}: ${result}. ${duration(elapsedMs)} elapsed${left}`
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

export function summariseRun(options: RunOptions, matches: MatchResult[]): RunReport {
  const slowMs = options.slowMs ?? 5_000
  const report = (i: 0 | 1): ContenderReport => {
    let wins = 0
    let draws = 0
    let touchdowns = 0
    let worstMs = 0
    let worstSeed: number | null = null
    for (const m of matches) {
      const team: TeamId = m.home === i ? 'home' : 'away'
      if (m.winner === 'draw') draws++
      else if (m.winner === team) wins++
      touchdowns += m.score[team]
      for (const ms of m.times[i]) {
        if (ms > worstMs) {
          worstMs = ms
          worstSeed = m.seed
        }
      }
    }
    const finished = matches.filter((m) => m.winner !== null).length
    return {
      contender: options.contenders[i],
      wins,
      draws,
      losses: finished - wins - draws,
      touchdownsPerMatch: touchdowns / Math.max(matches.length, 1),
      medianMs: median(matches.flatMap((m) => m.times[i])),
      worstMs,
      worstSeed,
    }
  }
  return {
    options,
    matches,
    contenders: [report(0), report(1)],
    activationsPerMatch: matches.reduce((sum, m) => sum + m.activations, 0) / Math.max(matches.length, 1),
    problems: matches.flatMap((m) => (m.problem ? [{ match: m, problem: m.problem }] : [])),
    slow: matches.flatMap((m) =>
      ([0, 1] as const).flatMap((i) => {
        const ms = Math.max(0, ...m.times[i])
        return ms > slowMs ? [{ match: m, contender: options.contenders[i], ms }] : []
      }),
    ),
  }
}

/** A contender as the report shows it: a weights file by its name only. */
function label(contender: Contender): string {
  const { level, weightsFile } = parseContender(contender)
  return weightsFile ? `${level}:${basename(weightsFile)}` : level
}

export function formatRun(report: RunReport): string {
  const { options } = report
  const ms = (x: number) => (x < 10 ? x.toFixed(2) : Math.round(x).toLocaleString('en-GB'))
  const [rh, ra] = options.rosters ?? ['orcs', 'elves']
  const width = Math.max(12, ...options.contenders.map((c) => label(c).length + 2))
  const lines = [
    `${label(options.contenders[0])} against ${label(options.contenders[1])}: ${report.matches.length} matches, ${(options.config ?? rulesV12).id}, ${rh} at home against ${ra}; sides swap halfway`,
    '',
    `  ${''.padEnd(width)}wins  draws  losses  TD/match  median ms  worst ms (seed)`,
    ...report.contenders.map(
      (c) =>
        `  ${label(c.contender).padEnd(width)}${String(c.wins).padStart(4)}${String(c.draws).padStart(7)}${String(c.losses).padStart(8)}${c.touchdownsPerMatch.toFixed(2).padStart(10)}${ms(c.medianMs).padStart(11)}${`${ms(c.worstMs)} (${c.worstSeed ?? '-'})`.padStart(17)}`,
    ),
    '',
    `Activations per match: ${report.activationsPerMatch.toFixed(1)}`,
  ]
  // A single match runs with the first contender at home, so name them in the order they played.
  const replay = (m: MatchResult) => {
    const [home, away] = m.home === 0 ? options.contenders : [options.contenders[1], options.contenders[0]]
    return `--home ${home} --away ${away} --first-seed ${m.seed} --matches 1`
  }
  for (const p of report.problems) lines.push(`Problem, seed ${p.match.seed}: ${p.problem} (replay with ${replay(p.match)})`)
  for (const s of report.slow) lines.push(`Slow, seed ${s.match.seed}: ${s.contender} took ${ms(s.ms)} ms (replay with ${replay(s.match)})`)
  return lines.join('\n')
}
