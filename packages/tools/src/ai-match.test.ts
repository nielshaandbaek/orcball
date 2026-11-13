import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type RuleConfig, rulesV10, rulesV11, rulesV12, rulesV13, rulesV14, rulesV15, rulesV16, rulesV17, rulesV18, rulesV19, rulesV20 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import {
  type Contender,
  formatComparison,
  formatRun,
  type MatchResult,
  parseContender,
  progressLine,
  type RunOptions,
  type RunReport,
  runAiMatches,
  summariseRun,
  touchdownTiming,
  winShare,
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

  it('keeps each contender with its roster in a balance run', () => {
    const report = runAiMatches({ contenders: ['random', 'random'], matches: 2, rosters: ['orcs', 'elves'], balance: true })
    expect(report.matches.map((m) => m.rosters)).toEqual([
      { home: 'orcs', away: 'elves' },
      { home: 'elves', away: 'orcs' },
    ])
    expect(formatRun(report)).toMatch(/^orcs against elves, random against random: 2 matches, rules-v12; each team plays home/)
    expect(formatRun(report)).toMatch(/\n {2}orcs \(random\) +\d/)
  })

  it('counts activations, rolls, blocks, knockdowns and failed activations for each team', () => {
    // Random play rolls and blocks seldom, so over a few matches.
    const { matches } = runAiMatches({ contenders: ['random', 'random'], matches: 10 })
    const teams = matches.flatMap((m) => {
      expect(m.stats.home.activations + m.stats.away.activations).toBe(m.activations)
      return [m.stats.home, m.stats.away]
    })
    const sum = (key: keyof (typeof teams)[number]) => teams.reduce((total, t) => total + t[key], 0)
    for (const t of teams) expect(t.noRollActivations).toBeLessThanOrEqual(t.activations)
    expect(sum('rolls')).toBeGreaterThan(0)
    expect(sum('noRollActivations')).toBeLessThan(sum('activations'))
    expect(sum('tackles') + sum('shoves')).toBeGreaterThan(0)
    // Every Tackle or Shove is a block, but a block can be neither (one the coach can't choose).
    for (const t of teams) expect(t.blocks).toBeGreaterThanOrEqual(t.tackles + t.shoves)
    expect(sum('knockdowns')).toBeGreaterThan(0)
    expect(sum('failures')).toBeGreaterThan(0)
    for (const t of teams) expect(t.failures).toBeLessThanOrEqual(t.activations - t.noRollActivations)
  })

  it('gives a win share with a 95% margin of error', () => {
    expect(winShare(0, 0)).toBeNull()
    const half = winShare(50, 100)!
    expect(half.share).toBe(0.5)
    expect(half.low).toBeCloseTo(0.404, 3)
    expect(half.high).toBeCloseTo(0.596, 3)
    const all = winShare(10, 10)!
    expect(all.high).toBe(1)
    expect(all.low).toBeCloseTo(0.722, 3)
  })

  it('compares the same run under two rules versions', () => {
    const reports = [rulesV11, rulesV12].map((config) => runAiMatches({ contenders: ['random', 'random'], matches: 2, config, balance: true }))
    const text = formatComparison(reports)
    expect(text).toMatch(/orcs decisive won/)
    expect(text).toMatch(/\n {2}rules-v11 +2 /)
    expect(text).toMatch(/\n {2}rules-v12 +2 /)
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

// #135: when touchdowns come, whether they're answered, and Out players who never come back.
describe('touchdown timing', () => {
  const match = (touchdowns: MatchResult['touchdowns'], outs: MatchResult['outs']) => ({ touchdowns, outs }) as MatchResult

  it('counts touchdowns by round through the match, the answered ones, and Out players not back', () => {
    const timing = touchdownTiming([
      // Home scores in round 2, away answers in 7, home answers that in 8 (unanswered).
      match([{ team: 'home', round: 2 }, { team: 'away', round: 7 }, { team: 'home', round: 8 }], { out: 2, back: 1 }),
      // One unanswered touchdown in round 8; nobody Out.
      match([{ team: 'away', round: 8 }], { out: 0, back: 0 }),
    ])
    expect(timing.touchdownsByRound).toEqual([0, 0.5, 0, 0, 0, 0, 0.5, 1])
    // Answered: home's in round 2 and away's in round 7, so 2 of 4.
    expect(timing.answeredShare).toBe(2 / 4)
    expect(timing.outNeverBackShare).toBe(1 / 2)
  })

  it('has nothing to say for results saved before it was counted', () => {
    expect(touchdownTiming([{} as MatchResult])).toEqual({ touchdownsByRound: [], answeredShare: null, outNeverBackShare: null })
  })

  it('shows in a real run, and in the comparison', () => {
    const report = runAiMatches({ contenders: ['random', 'random'], matches: 2, config: rulesV20 })
    for (const m of report.matches) expect(m.touchdowns?.every((td) => td.round >= 1 && td.round <= 8)).toBe(true)
    expect(formatRun(report)).toMatch(/Touchdowns per match by round/)
    expect(formatComparison([report])).toMatch(/TDs answered\s+Out not back/)
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
    // Several rules versions, comma-separated, play the same run under each and compare them.
    const configs = (env.AI_RULES ?? '').split(',').map((id) => {
      const config = [rulesV10, rulesV11, rulesV12, rulesV13, rulesV14, rulesV15, rulesV16, rulesV17, rulesV18, rulesV19, rulesV20].find((c) => c.id === id)
      if (!config) throw new Error(`Unknown rules '${id}'`)
      return config
    })
    const optionsFor = (config: RuleConfig): RunOptions => ({
      contenders: [contender(env.AI_HOME), contender(env.AI_AWAY)],
      matches: Number(env.AI_MATCHES),
      config,
      rosters: (env.AI_ROSTERS ?? 'orcs,elves').split(',') as [string, string],
      budgetMs: Number(env.AI_BUDGET_MS),
      firstSeed: Number(env.AI_FIRST_SEED),
      samples: env.AI_SAMPLES === '1',
      balance: env.AI_BALANCE === '1',
    })

    const reports: RunReport[] = []
    let missing = ''
    if (env.AI_COMBINE) {
      const files = readdirSync(env.AI_COMBINE).filter((f) => f.endsWith('.json'))
      const all = files.flatMap((f) => (JSON.parse(readFileSync(join(env.AI_COMBINE!, f), 'utf8')) as SavedRun).matches)
      for (const config of configs) {
        const options = optionsFor(config)
        const matches = all.filter((m) => m.rules === config.id).sort((a, b) => a.seed - b.seed)
        reports.push(summariseRun(options, matches))
        if (matches.length < options.matches) {
          missing += `\nOnly ${matches.length} of ${options.matches} ${config.id} matches reported (${files.length} shard file${files.length === 1 ? '' : 's'}); a shard failed or timed out, see its log.`
        }
      }
    } else {
      const shard = env.AI_SHARD ? env.AI_SHARD.split('/').map(Number) : null
      if (shard && (!shard[0] || !shard[1] || shard[0] > shard[1])) throw new Error(`Bad shard '${env.AI_SHARD}': use e.g. 2/4`)
      for (const config of configs) {
        const options = optionsFor(config)
        if (shard) options.shard = { index: shard[0]! - 1, count: shard[1]! }
        const start = Date.now()
        const rules = configs.length > 1 ? `${config.id}, ` : ''
        options.onMatch = (match, done, total) => {
          if (env.AI_PROGRESS) appendFileSync(env.AI_PROGRESS, `${rules}${progressLine(options, match, done, total, Date.now() - start)}\n`)
        }
        reports.push(runAiMatches(options))
      }
      if (env.AI_RESULTS) writeFileSync(env.AI_RESULTS, JSON.stringify({ matches: reports.flatMap((r) => r.matches) } satisfies SavedRun))
    }
    const sections = reports.map(formatRun)
    if (reports.length > 1) sections.push(formatComparison(reports))
    const text = sections.join('\n\n') + missing
    console.log(text)
    if (env.AI_REPORT) writeFileSync(env.AI_REPORT, `${text}\n`)
  }, 24 * 3600_000)
})

/** One shard's matches, as saved for AI_COMBINE. */
type SavedRun = { matches: MatchResult[] }
