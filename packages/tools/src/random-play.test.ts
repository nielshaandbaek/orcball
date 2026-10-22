import { describe, expect, it } from 'vitest'
import { playRandomMatch } from './bot'
import { formatReport, summarise } from './report'

// Plays random matches and fails on any crash, illegal state or stuck state.
// RANDOM_MATCHES sets how many (50 by default, 1,000 in CI's random-play job);
// RANDOM_SEED replays a single seed, e.g. one that failed.

const single = process.env.RANDOM_SEED ? Number(process.env.RANDOM_SEED) : null
const count = Number(process.env.RANDOM_MATCHES ?? 50)
const seeds = single !== null ? [single] : Array.from({ length: count }, (_, i) => i + 1)

describe('random play', () => {
  it(`plays ${seeds.length} match${seeds.length === 1 ? '' : 'es'} to full time without a problem`, () => {
    const events = []
    for (const seed of seeds) {
      const result = playRandomMatch(seed)
      if (result.problem) {
        throw new Error(
          `Seed ${seed}: ${result.problem}\n` +
            `Reproduce with: RANDOM_SEED=${seed} pnpm --filter @orcball/tools random-play`,
        )
      }
      expect(result.state.phase).toBe('FullTime')
      events.push(result.events)
    }
    console.log(formatReport(summarise(events)))
  }, 600_000)
})
