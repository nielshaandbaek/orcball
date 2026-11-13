import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { type AiLevel, actingTeam, chooseCommand, FEATURES, featureDifferences, loadWeights, viewOf, type Weights } from '@orcball/ai'
import {
  apply,
  type Command,
  countAssists,
  createMatch,
  type GameEvent,
  type GameState,
  type Player as Placed,
  type Roster,
  type RuleConfig,
  rulesV12,
  type TeamId,
} from '@orcball/engine'
import { invariantProblems, randomBot } from './bot'

// Computer against computer: any two contenders (the random bot or a
// computer level) play N matches. The first contender plays home in the first
// half of the run and away in the second, to cancel out any home or away
// advantage. The rosters stay with their side, unless the run is a balance
// run: then each contender keeps its roster, so the rosters swap sides too.

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
  /** Roster ids for home and away, e.g. ['orcs', 'elves']; in a balance run, the first and second contender's. */
  rosters?: [string, string]
  /**
   * A balance run: each contender keeps its roster, so the rosters swap sides
   * halfway with the contenders and the report compares the rosters.
   */
  balance?: boolean
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
  /** The rules config id. */
  rules: string
  seed: number
  /** Index into the contenders playing home. */
  home: 0 | 1
  score: Record<TeamId, number>
  winner: TeamId | 'draw' | null
  activations: number
  /** The rosters home and away played. */
  rosters: Record<TeamId, string>
  /** What each team did, for the PRD's metrics. */
  stats: Record<TeamId, TeamStats>
  /** Decision times in ms for each contender. */
  times: [number[], number[]]
  problem: string | null
  /** With `samples`: at the start of every go, each feature (in FEATURES order) as home's count minus away's. */
  samples?: number[][]
}

/**
 * A team's activations, the rolls in them, its blocks (and which it chose as
 * a Tackle or a Shove), the opposing players it knocked down, and its failed
 * activations (each gives the other team a double activation).
 */
export type TeamStats = {
  activations: number
  rolls: number
  noRollActivations: number
  blocks: number
  tackles: number
  shoves: number
  knockdowns: number
  failures: number
  /** Leaps tried, and those that landed (#165). */
  leaps?: number
  leapsMade?: number
  /** Assists on blocks that only Guard allowed: a marked Guard player helping, attacking or defending (#166). */
  guardAssists?: number
  /** Fouls made (#174). */
  fouls?: number
}

const noStats = (): TeamStats => ({
  activations: 0,
  rolls: 0,
  noRollActivations: 0,
  blocks: 0,
  tackles: 0,
  shoves: 0,
  knockdowns: 0,
  failures: 0,
  leaps: 0,
  leapsMade: 0,
  guardAssists: 0,
  fouls: 0,
})

/** Assists on a block by players who only count thanks to Guard, for each side. */
function guardOnly(state: GameState, attacker: Placed, defender: Placed): number {
  return countAssists(state, attacker, defender, { block: true }) - countAssists(state, attacker, defender)
}

/**
 * Adds a step's events to the stats; `before` is the state the step was
 * applied to, and `active` carries the activation in progress from step to step.
 */
export function countEvents(
  events: readonly GameEvent[],
  before: GameState,
  stats: Record<TeamId, TeamStats>,
  active: { team: TeamId; rolls: number } | null,
): { team: TeamId; rolls: number } | null {
  const players = before.players
  let current = active
  for (const event of events) {
    if (event.type === 'activated') {
      current = { team: players[event.playerId]!.team, rolls: 0 }
      stats[current.team].activations++
    } else if (event.type === 'rolled' && current) {
      current.rolls++
      stats[current.team].rolls++
      if (event.test === 'Leap') {
        stats[current.team].leaps = (stats[current.team].leaps ?? 0) + 1
        if (event.success) stats[current.team].leapsMade = (stats[current.team].leapsMade ?? 0) + 1
      }
    } else if (event.type === 'activationEnded' && current) {
      if (current.rolls === 0) stats[current.team].noRollActivations++
      if (event.failed) stats[current.team].failures++
      current = null
    } else if (event.type === 'blockDeclared') {
      const attacker = players[event.attackerId]!
      const defender = players[event.defenderId]!
      stats[attacker.team].blocks++
      stats[attacker.team].guardAssists = (stats[attacker.team].guardAssists ?? 0) + guardOnly(before, attacker, defender)
      stats[defender.team].guardAssists = (stats[defender.team].guardAssists ?? 0) + guardOnly(before, defender, attacker)
    } else if (event.type === 'fouled') {
      const team = players[event.playerId]!.team
      stats[team].fouls = (stats[team].fouls ?? 0) + 1
    } else if (event.type === 'knockedDown' && current) {
      // Credited to the team whose activation it is, for an opposing player: not its own failed Dodges or both-down Tackles.
      if (players[event.playerId]!.team !== current.team) stats[current.team].knockdowns++
    } else if (event.type === 'blockChosen') {
      const team = players[event.attackerId]!.team
      if (event.choice === 'tackle') stats[team].tackles++
      else stats[team].shoves++
    }
  }
  return current
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

  const ids = options.rosters ?? ['orcs', 'elves']
  const rosters: Record<TeamId, string> = options.balance && home === 1 ? { home: ids[1], away: ids[0] } : { home: ids[0], away: ids[1] }
  let state = createMatch(config, rostersOf(config, [rosters.home, rosters.away]), seed)
  const times: [number[], number[]] = [[], []]
  let commands = 0
  let activations = 0
  const stats: Record<TeamId, TeamStats> = { home: noStats(), away: noStats() }
  let active: { team: TeamId; rolls: number } | null = null
  const samples: number[][] = []
  const result = (problem: string | null): MatchResult => ({
    rules: config.id,
    seed,
    home,
    score: { home: state.teams.home.score, away: state.teams.away.score },
    winner: state.winner,
    activations,
    rosters,
    stats,
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
      active = countEvents(step.events, state, stats, active)
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
  /** Wins as a share of the decisive matches, with a 95% interval (Wilson), or null with none decisive. */
  decisive: { share: number; low: number; high: number } | null
  touchdownsPerMatch: number
  /** Blocks it made, and those it chose to make as a Tackle or a Shove. */
  blocks: number
  tackles: number
  shoves: number
  /** Opposing players it knocked down. */
  knockdowns: number
  /** Its failed activations: each gave the other team a double activation. */
  failures: number
  /** Leaps it tried and landed, assists only Guard allowed, and fouls. */
  leaps: number
  leapsMade: number
  guardAssists: number
  fouls: number
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
  rollsPerActivation: number
  /** Share of activations with no roll. */
  noRollShare: number
  /** Share of matches ending 0–0. */
  scorelessShare: number
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

/** The share of n trials won, with its 95% Wilson interval: a rough margin of error that stays inside 0–1. */
export function winShare(won: number, n: number): { share: number; low: number; high: number } | null {
  if (n === 0) return null
  const z = 1.96
  const p = won / n
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n)
  const half = ((z / (1 + (z * z) / n)) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)))
  return { share: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) }
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
    let blocks = 0
    let tackles = 0
    let shoves = 0
    let knockdowns = 0
    let failures = 0
    let leaps = 0
    let leapsMade = 0
    let guardAssists = 0
    let fouls = 0
    let worstMs = 0
    let worstSeed: number | null = null
    for (const m of matches) {
      const team: TeamId = m.home === i ? 'home' : 'away'
      if (m.winner === 'draw') draws++
      else if (m.winner === team) wins++
      touchdowns += m.score[team]
      // Results saved before blocks, knockdowns and failures were counted have none: count them as 0.
      blocks += m.stats[team].blocks ?? 0
      tackles += m.stats[team].tackles
      shoves += m.stats[team].shoves
      knockdowns += m.stats[team].knockdowns ?? 0
      failures += m.stats[team].failures ?? 0
      leaps += m.stats[team].leaps ?? 0
      leapsMade += m.stats[team].leapsMade ?? 0
      guardAssists += m.stats[team].guardAssists ?? 0
      fouls += m.stats[team].fouls ?? 0
      for (const ms of m.times[i]) {
        if (ms > worstMs) {
          worstMs = ms
          worstSeed = m.seed
        }
      }
    }
    const finished = matches.filter((m) => m.winner !== null).length
    const losses = finished - wins - draws
    return {
      contender: options.contenders[i],
      wins,
      draws,
      losses,
      decisive: winShare(wins, wins + losses),
      touchdownsPerMatch: touchdowns / Math.max(matches.length, 1),
      blocks,
      tackles,
      shoves,
      knockdowns,
      failures,
      leaps,
      leapsMade,
      guardAssists,
      fouls,
      medianMs: median(matches.flatMap((m) => m.times[i])),
      worstMs,
      worstSeed,
    }
  }
  const teams = matches.flatMap((m) => [m.stats.home, m.stats.away])
  const total = (key: keyof TeamStats) => teams.reduce((sum, t) => sum + (t[key] ?? 0), 0)
  return {
    options,
    matches,
    contenders: [report(0), report(1)],
    activationsPerMatch: matches.reduce((sum, m) => sum + m.activations, 0) / Math.max(matches.length, 1),
    rollsPerActivation: total('rolls') / Math.max(total('activations'), 1),
    noRollShare: total('noRollActivations') / Math.max(total('activations'), 1),
    scorelessShare: matches.filter((m) => m.winner !== null && m.score.home + m.score.away === 0).length / Math.max(matches.length, 1),
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
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const [rh, ra] = options.rosters ?? ['orcs', 'elves']
  // In a balance run each contender has its roster, and the roster is what the report compares.
  const name = (i: 0 | 1) => (options.balance ? `${options.rosters?.[i] ?? (i === 0 ? 'orcs' : 'elves')} (${label(options.contenders[i])})` : label(options.contenders[i]))
  const width = Math.max(12, name(0).length + 2, name(1).length + 2)
  const rules = (options.config ?? rulesV12).id
  const title = options.balance
    ? `${rh} against ${ra}, ${label(options.contenders[0])} against ${label(options.contenders[1])}: ${report.matches.length} matches, ${rules}; each team plays home in one half of the run`
    : `${label(options.contenders[0])} against ${label(options.contenders[1])}: ${report.matches.length} matches, ${rules}, ${rh} at home against ${ra}; sides swap halfway`
  const decisive = (c: ContenderReport) => (c.decisive ? `${pct(c.decisive.share)} (${pct(c.decisive.low)}–${pct(c.decisive.high)})` : '-')
  const tackleShare = (c: ContenderReport) => (c.tackles + c.shoves > 0 ? pct(c.tackles / (c.tackles + c.shoves)) : '-')
  const perMatch = (x: number) => (x / Math.max(report.matches.length, 1)).toFixed(1)
  const lines = [
    title,
    '',
    `  ${''.padEnd(width)}wins  draws  losses  decisive won (95%)  TD/match  blocks/match  tackles  knockdowns/match  failed/match  median ms  worst ms (seed)`,
    ...report.contenders.map(
      (c, i) =>
        `  ${name(i as 0 | 1).padEnd(width)}${String(c.wins).padStart(4)}${String(c.draws).padStart(7)}${String(c.losses).padStart(8)}${decisive(c).padStart(20)}${c.touchdownsPerMatch.toFixed(2).padStart(10)}${perMatch(c.blocks).padStart(14)}${tackleShare(c).padStart(9)}${perMatch(c.knockdowns).padStart(18)}${perMatch(c.failures).padStart(14)}${ms(c.medianMs).padStart(11)}${`${ms(c.worstMs)} (${c.worstSeed ?? '-'})`.padStart(17)}`,
    ),
    '',
    `Decisive won: wins as a share of the matches that weren't drawn; the range is the 95% margin of error. Tackles: the share of blocks chosen as a Tackle rather than a Shove. Knockdowns: opposing players knocked down in the team's activations. Failed: activations that failed, each giving the other team a double activation.`,
    `Per match: ${report.contenders.map((c, i) => `${name(i as 0 | 1)} ${perMatch(c.leaps)} leaps (${c.leaps > 0 ? pct(c.leapsMade / c.leaps) : '-'} landed), ${perMatch(c.guardAssists)} Guard assists, ${perMatch(c.fouls)} fouls`).join('; ')}. Guard assists: assists on blocks that only Guard allowed.`,
    `Activations per match: ${report.activationsPerMatch.toFixed(1)}. Rolls per activation: ${report.rollsPerActivation.toFixed(2)}; activations with no roll: ${pct(report.noRollShare)}. Matches ending 0–0: ${pct(report.scorelessShare)}.`,
  ]
  // A single match runs with the first contender at home, so name them in the order they played.
  const replay = (m: MatchResult) => {
    const [home, away] = m.home === 0 ? options.contenders : [options.contenders[1], options.contenders[0]]
    return `--home ${home} --away ${away} --rosters ${m.rosters.home},${m.rosters.away} --rules ${m.rules} --first-seed ${m.seed} --matches 1`
  }
  for (const p of report.problems) lines.push(`Problem, seed ${p.match.seed}: ${p.problem} (replay with ${replay(p.match)})`)
  for (const s of report.slow) lines.push(`Slow, seed ${s.match.seed}: ${s.contender} took ${ms(s.ms)} ms (replay with ${replay(s.match)})`)
  return lines.join('\n')
}

/**
 * The same run under several rules versions, side by side: how a rule change
 * moves the balance and the PRD's metrics.
 */
export function formatComparison(reports: RunReport[]): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const first = reports[0]!.options
  const who = first.balance ? (first.rosters?.[0] ?? 'orcs') : label(first.contenders[0])
  const rows = reports.map((r) => {
    const c = r.contenders[0]
    const tackles = r.contenders.reduce((sum, x) => sum + x.tackles, 0)
    const chosen = tackles + r.contenders.reduce((sum, x) => sum + x.shoves, 0)
    const perMatch = (key: 'blocks' | 'knockdowns' | 'failures' | 'leaps' | 'guardAssists' | 'fouls') =>
      (r.contenders.reduce((sum, x) => sum + x[key], 0) / Math.max(r.matches.length, 1)).toFixed(1)
    return [
      (r.options.config ?? rulesV12).id,
      String(r.matches.length),
      c.decisive ? `${pct(c.decisive.share)} (${pct(c.decisive.low)}–${pct(c.decisive.high)})` : '-',
      pct((c.draws) / Math.max(r.matches.length, 1)),
      ((c.touchdownsPerMatch + r.contenders[1].touchdownsPerMatch)).toFixed(2),
      pct(r.scorelessShare),
      r.activationsPerMatch.toFixed(1),
      r.rollsPerActivation.toFixed(2),
      pct(r.noRollShare),
      perMatch('blocks'),
      chosen > 0 ? pct(tackles / chosen) : '-',
      perMatch('knockdowns'),
      perMatch('failures'),
      perMatch('leaps'),
      perMatch('guardAssists'),
      perMatch('fouls'),
    ]
  })
  const header = ['rules', 'matches', `${who} decisive won`, 'draws', 'TD/match', '0–0', 'activations', 'rolls/act', 'no roll', 'blocks', 'tackles', 'knockdowns', 'failed', 'leaps', 'Guard assists', 'fouls']
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
  const line = (cells: string[]) => `  ${cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join('  ')}`
  return ['Rules compared', '', line(header), ...rows.map(line), '', 'TD/match, activations, blocks, knockdowns, failed activations, leaps, Guard assists and fouls are per match, both teams.'].join('\n')
}
