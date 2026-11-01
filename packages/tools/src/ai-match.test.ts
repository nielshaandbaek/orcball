import { writeFileSync } from 'node:fs'
import { rulesV10, rulesV11, rulesV12 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { CONTENDERS, type Contender, formatRun, runAiMatches } from './ai-match'

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
  it('runs the requested matches', () => {
    const env = process.env
    const contender = (name: string | undefined): Contender => {
      if (!CONTENDERS.includes(name as Contender)) throw new Error(`Unknown contender '${name}': use ${CONTENDERS.join(', ')}`)
      return name as Contender
    }
    const config = [rulesV10, rulesV11, rulesV12].find((c) => c.id === env.AI_RULES)
    if (!config) throw new Error(`Unknown rules '${env.AI_RULES}'`)
    const report = runAiMatches({
      contenders: [contender(env.AI_HOME), contender(env.AI_AWAY)],
      matches: Number(env.AI_MATCHES),
      config,
      rosters: (env.AI_ROSTERS ?? 'orcs,elves').split(',') as [string, string],
      budgetMs: Number(env.AI_BUDGET_MS),
      firstSeed: Number(env.AI_FIRST_SEED),
    })
    const text = formatRun(report)
    console.log(text)
    if (env.AI_REPORT) writeFileSync(env.AI_REPORT, `${text}\n`)
  }, 24 * 3600_000)
})
