import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type AiLevel, FEATURES, type Feature, loadWeights, type Weights } from '@orcball/ai'
import type { MatchResult } from './ai-match'

// Tuning the evaluation weights by self-play, with SPSA (simultaneous
// perturbation stochastic approximation), the usual way to tune game engines
// whose only measure is noisy match results.
//
// Each iteration nudges every tuned weight at once, half of them up and half
// down at random, by `c` of its scale: one variant has the nudges added (plus),
// the other subtracted (minus). The two play a batch of matches against each
// other. If plus wins more, the weights move towards plus, by how much more it
// won; otherwise towards minus. Every iteration plays fresh seeds.
//
// A weight's scale is its starting size (at least MIN_SCALE), so small
// weights move in small steps and large ones in large steps. `score` isn't
// tuned: scaling every weight alike changes no choice, so one weight is held
// to fix the scale.

/** Every weight but score. */
export const TUNED: readonly Feature[] = FEATURES.filter((f) => f !== 'score')

/** The smallest scale, for a weight that starts at or near 0. */
const MIN_SCALE = 0.25

/** How far a weight may move, in scales from its start. */
const MAX_OFFSET = 3

export type TuneOptions = {
  iterations: number
  /** Matches per iteration between plus and minus, sides swapped halfway. */
  matches: number
  /** Nudge size, in scales. */
  c: number
  /** Step size: the first iteration's step for a full win of the batch, in scales. */
  a: number
  /** The first seed; iteration i plays from firstSeed + i × matches. */
  firstSeed: number
  /** Seeds the random nudges, so a run can be repeated. */
  seed: number
  /** The weights to tune; the rest stay at their start (#98). Every weight but score by default. */
  features?: readonly Feature[]
}

export const DEFAULT_TUNE: TuneOptions = { iterations: 100, matches: 12, c: 0.3, a: 0.25, firstSeed: 1_000_000, seed: 1 }

/**
 * Plays plus against minus: `matches` matches from `firstSeed`, plus at home
 * in the first half. Returns plus's wins minus its losses, over the matches.
 */
export type PlayBatch = (plus: Weights, minus: Weights, firstSeed: number, matches: number) => Promise<number>

export type Iteration = {
  iteration: number
  /** Plus's wins minus its losses, over the matches. */
  result: number
  weights: Weights
}

/** Offsets from the start, in scales, to weights. */
function toWeights(start: Weights, scale: Record<Feature, number>, offset: Record<Feature, number>, id: string): Weights {
  const weights = { ...start, id }
  for (const f of TUNED) weights[f] = round(start[f] + scale[f] * offset[f])
  return loadWeights(weights)
}

/** Four decimals: enough for a weight, and readable in the file. */
function round(x: number): number {
  return Math.round(x * 10_000) / 10_000 + 0
}

/** A small seeded generator for the nudges' directions (mulberry32). */
function directions(seed: number): () => 1 | -1 {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const x = ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
    return x < 0.5 ? 1 : -1
  }
}

export async function tune(
  start: Weights,
  play: PlayBatch,
  options: TuneOptions,
  onIteration: (it: Iteration) => void = () => {},
): Promise<Weights> {
  const scale = Object.fromEntries(FEATURES.map((f) => [f, Math.max(MIN_SCALE, Math.abs(start[f]))])) as Record<Feature, number>
  const offset = Object.fromEntries(FEATURES.map((f) => [f, 0])) as Record<Feature, number>
  const direction = directions(options.seed)
  // The usual SPSA schedules: steps shrink as the run goes on, nudges a little.
  const A = options.iterations / 10
  const tuned = options.features ?? TUNED
  if (tuned.includes('score')) throw new Error('score isn’t tuned: it fixes the scale')
  for (let k = 0; k < options.iterations; k++) {
    const ak = (options.a * (A + 1) ** 0.602) / (A + k + 1) ** 0.602
    const ck = options.c / (k + 1) ** 0.101
    const delta = Object.fromEntries(tuned.map((f) => [f, direction()])) as Record<Feature, number>
    const nudged = (sign: 1 | -1) => {
      const o = { ...offset }
      for (const f of tuned) o[f] = offset[f] + sign * ck * delta[f]
      return o
    }
    const plus = toWeights(start, scale, nudged(1), `tune-${k}-plus`)
    const minus = toWeights(start, scale, nudged(-1), `tune-${k}-minus`)
    const result = await play(plus, minus, options.firstSeed + k * options.matches, options.matches)
    // The result estimates the slope along delta: step along it, scaled so a full win moves ak.
    for (const f of tuned) offset[f] = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, offset[f] + ak * result * delta[f]))
    onIteration({ iteration: k + 1, result, weights: toWeights(start, scale, offset, 'tuning') })
  }
  return toWeights(start, scale, offset, 'tuned')
}

export type ShardedPlayOptions = {
  /** The computer level both variants play at. */
  level: AiLevel
  /** Processes to play a batch in, each a shard of it. */
  parallel: number
  /** A directory for the weights and results files. */
  work: string
  rules: string
  rosters: string
  budgetMs: number
}

/**
 * Plays a batch with the match runner: the batch split into `parallel`
 * shards, each in its own Vitest process (the tools run their TypeScript
 * through Vitest, and one process plays one match at a time).
 */
export function shardedPlay(options: ShardedPlayOptions): PlayBatch {
  return async (plus, minus, firstSeed, matches) => {
    const file = (name: string) => join(options.work, name)
    writeFileSync(file(`${plus.id}.json`), JSON.stringify(plus))
    writeFileSync(file(`${minus.id}.json`), JSON.stringify(minus))
    const shards = Math.min(options.parallel, matches)
    const runs = Array.from({ length: shards }, (_, i) => {
      const results = file(`${plus.id}-shard-${i + 1}.json`)
      const env = {
        ...process.env,
        AI_MATCH: '1',
        AI_HOME: `${options.level}:${file(`${plus.id}.json`)}`,
        AI_AWAY: `${options.level}:${file(`${minus.id}.json`)}`,
        AI_MATCHES: String(matches),
        AI_RULES: options.rules,
        AI_ROSTERS: options.rosters,
        AI_BUDGET_MS: String(options.budgetMs),
        AI_FIRST_SEED: String(firstSeed),
        AI_SHARD: `${i + 1}/${shards}`,
        AI_RESULTS: results,
        AI_PROGRESS: '',
        AI_REPORT: '',
        AI_COMBINE: '',
      }
      return new Promise<MatchResult[]>((resolve, reject) => {
        const child = spawn('vitest', ['run', 'src/ai-match.test.ts', '-t', 'runs the requested matches', '--reporter=dot'], {
          env,
          stdio: ['ignore', 'ignore', 'inherit'],
          shell: true,
        })
        child.on('exit', (code) => {
          if (code !== 0) return reject(new Error(`a shard of ${plus.id} failed (exit code ${code})`))
          resolve((JSON.parse(readFileSync(results, 'utf8')) as { matches: MatchResult[] }).matches)
        })
      })
    })
    const played = (await Promise.all(runs)).flat()
    let net = 0
    for (const m of played) {
      if (m.problem) throw new Error(`seed ${m.seed}: ${m.problem}`)
      // Contender 0 is plus; m.home says which contender played home.
      const plusTeam = m.home === 0 ? 'home' : 'away'
      if (m.winner === plusTeam) net++
      else if (m.winner !== 'draw') net--
    }
    return net / played.length
  }
}
