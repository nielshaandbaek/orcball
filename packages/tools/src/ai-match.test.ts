import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rulesV10, rulesV11, rulesV12 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import {
  type Contender,
  formatRun,
  type MatchResult,
  parseContender,
  progressLine,
  type RunOptions,
  type RunReport,
  runAiMatches,
  summariseRun,
} from './ai-match'

// Computer against computer. `pnpm test` plays a couple of short runs; the
// full runner only runs with AI_MATCH set, through `pnpm --filter
// @orcball/tools ai-match` (see the README for the options).

describe('ai-match runner', () => {
  // The random bot against itself keeps these quick; the computer's own matches are in packages/ai.
  it('plays two contenders, swapping sides halfway', () => {
    const report = runAiMatches({ contenders: ['random', 'random'], matches: 2 })
    expect(report.problems).toEqual([])
    expect(report.matches.map((m) => m.home)).toEqual([0, 1])
    const [a, b] = report.contenders
    expect(a.wins + a.draws + a.losses).toBe(2)
    expect(a.wins).toBe(b.losses)
    expect(a.draws).toBe(b.draws)
    expect(formatRun(report)).toMatch(/random against random: 2 matches/)
  })

  it('splits a run into shards that together are the whole run', () => {
    const options: RunOptions = { contenders: ['random', 'random'], matches: 4, firstSeed: 7 }
    const whole = runAiMatches(options).matches
    const shards = [0, 1].flatMap((index) => runAiMatches({ ...options, shard: { index, count: 2 } }).matches)
    shards.sort((a, b) => a.seed - b.seed)
    const key = (m: MatchResult) => ({ seed: m.seed, home: m.home, score: m.score, activations: m.activations })
    expect(shards.map(key)).toEqual(whole.map(key))
  })

  it('reports progress after each match', () => {
    const lines: string[] = []
    const options: RunOptions = { contenders: ['random', 'random'], matches: 4, shard: { index: 1, count: 2 } }
    runAiMatches({ ...options, onMatch: (m, done, total) => lines.push(progressLine(options, m, done, total, 90_000 * done)) })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^shard 2\/2: 1\/2 \(50%\) seed 2: random \d+-\d+ random\. 1m 30s elapsed, about 1m 30s left$/)
    expect(lines[1]).toMatch(/^shard 2\/2: 2\/2 \(100%\) seed 4: .* 3m 0s elapsed$/)
  })

  it('reads a contender with its own weights file', () => {
    expect(parseContender('novice')).toEqual({ level: 'novice', weightsFile: null })
    expect(parseContender('expert:weights/tuned.json')).toEqual({ level: 'expert', weightsFile: 'weights/tuned.json' })
    expect(() => parseContender('master')).toThrow(/Unknown contender 'master'/)
    expect(() => parseContender('random:w.json')).toThrow(/no weights/)
    expect(() => parseContender('novice:')).toThrow(/No weights file/)
  })

  it('reproduces a match from its seed with the contenders in playing order', () => {
    // Two random bots seeded by side: a replay with the sides named in playing order gives the same match.
    const run = runAiMatches({ contenders: ['random', 'random'], matches: 2 })
    const second = run.matches[1]!
    const replayed = runAiMatches({ contenders: ['random', 'random'], matches: 1, firstSeed: second.seed }).matches[0]!
    expect(replayed.score).toEqual(second.score)
    expect(replayed.activations).toBe(second.activations)
  })
})

describe.skipIf(!process.env.AI_MATCH)('ai-match', () => {
  // Set by ai-match-cli.mjs; see the README.
  //   AI_SHARD    "2/4": play only the second of four shards
  //   AI_RESULTS  file to save this run's matches to, as JSON, for AI_COMBINE
  //   AI_COMBINE  directory of saved results: play nothing, report them together
  //   AI_PROGRESS file to append a line to after each match
  //   AI_REPORT   file to write the report to
  it('runs the requested matches', () => {
    const env = process.env
    const contender = (name: string | undefined): Contender => {
      parseContender(name ?? '')
      return name as Contender
    }
    const config = [rulesV10, rulesV11, rulesV12].find((c) => c.id === env.AI_RULES)
    if (!config) throw new Error(`Unknown rules '${env.AI_RULES}'`)
    const options: RunOptions = {
      contenders: [contender(env.AI_HOME), contender(env.AI_AWAY)],
      matches: Number(env.AI_MATCHES),
      config,
      rosters: (env.AI_ROSTERS ?? 'orcs,elves').split(',') as [string, string],
      budgetMs: Number(env.AI_BUDGET_MS),
      firstSeed: Number(env.AI_FIRST_SEED),
    }

    let report: RunReport
    let missing = ''
    if (env.AI_COMBINE) {
      const files = readdirSync(env.AI_COMBINE).filter((f) => f.endsWith('.json'))
      const matches = files.flatMap((f) => (JSON.parse(readFileSync(join(env.AI_COMBINE!, f), 'utf8')) as SavedRun).matches)
      matches.sort((a, b) => a.seed - b.seed)
      report = summariseRun(options, matches)
      if (matches.length < options.matches) {
        missing = `\nOnly ${matches.length} of ${options.matches} matches reported (${files.length} shard file${files.length === 1 ? '' : 's'}); a shard failed or timed out, see its log.`
      }
    } else {
      if (env.AI_SHARD) {
        const [n, count] = env.AI_SHARD.split('/').map(Number)
        if (!n || !count || n > count) throw new Error(`Bad shard '${env.AI_SHARD}': use e.g. 2/4`)
        options.shard = { index: n - 1, count }
      }
      const start = Date.now()
      options.onMatch = (match, done, total) => {
        if (env.AI_PROGRESS) appendFileSync(env.AI_PROGRESS, `${progressLine(options, match, done, total, Date.now() - start)}\n`)
      }
      report = runAiMatches(options)
      if (env.AI_RESULTS) writeFileSync(env.AI_RESULTS, JSON.stringify({ matches: report.matches } satisfies SavedRun))
    }
    const text = formatRun(report) + missing
    console.log(text)
    if (env.AI_REPORT) writeFileSync(env.AI_REPORT, `${text}\n`)
  }, 24 * 3600_000)
})

/** One shard's matches, as saved for AI_COMBINE. */
type SavedRun = { matches: MatchResult[] }
