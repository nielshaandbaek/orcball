import { rulesV10, rulesV11, rulesV12, rulesV13, rulesV14, rulesV15, rulesV16, rulesV17, rulesV18 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { playRandomMatch } from './bot'
import { formatReport, summarise } from './report'

// Plays random matches and fails on any crash, illegal state or stuck state.
// RANDOM_MATCHES sets how many (50 by default, 1,000 in CI's random-play job);
// RANDOM_SEED replays a single seed, e.g. one that failed. Every ruleset is
// played; RANDOM_RULES (e.g. rules-v11) picks one.

const single = process.env.RANDOM_SEED ? Number(process.env.RANDOM_SEED) : null
const count = Number(process.env.RANDOM_MATCHES ?? 50)
const seeds = single !== null ? [single] : Array.from({ length: count }, (_, i) => i + 1)
const configs = [rulesV10, rulesV11, rulesV12, rulesV13, rulesV14, rulesV15, rulesV16, rulesV17, rulesV18].filter((c) => !process.env.RANDOM_RULES || c.id === process.env.RANDOM_RULES)

describe.each(configs)('random play, $id', (config) => {
  it(`plays ${seeds.length} match${seeds.length === 1 ? '' : 'es'} to full time without a problem`, () => {
    const events = []
    for (const seed of seeds) {
      const result = playRandomMatch(seed, { config })
      if (result.problem) {
        throw new Error(
          `Seed ${seed} (${config.id}): ${result.problem}\n` +
            `Reproduce with: RANDOM_RULES=${config.id} RANDOM_SEED=${seed} pnpm --filter @orcball/tools random-play`,
        )
      }
      expect(result.state.phase).toBe('FullTime')
      events.push(result.events)
    }
    console.log(formatReport(summarise(events)))
  }, 600_000)
})
