import { rulesV10, rulesV11, rulesV12, rulesV13, rulesV14, rulesV15, rulesV16, rulesV17, rulesV18, rulesV19, rulesV20, rulesV21, rulesV22, rulesV23, rulesV24, rulesV25, rulesV26, rulesV27 } from '@orcball/engine'
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
const configs = [rulesV10, rulesV11, rulesV12, rulesV13, rulesV14, rulesV15, rulesV16, rulesV17, rulesV18, rulesV19, rulesV20, rulesV21, rulesV22, rulesV23, rulesV24, rulesV25, rulesV26, rulesV27].filter((c) => !process.env.RANDOM_RULES || c.id === process.env.RANDOM_RULES)

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

// The Humans (v24, #192) against each team and themselves, a few seeds each.
describe.each([
  ['humans', 'orcs'],
  ['elves', 'humans'],
  ['humans', 'humans'],
] as const)('random play, rules-v24, %s against %s', (home, away) => {
  it.skipIf(process.env.RANDOM_RULES !== undefined && process.env.RANDOM_RULES !== 'rules-v24')('plays to full time without a problem', () => {
    for (const seed of seeds.slice(0, 10)) {
      const result = playRandomMatch(seed, { config: rulesV24, rosters: [home, away] })
      if (result.problem) throw new Error(`Seed ${seed} (rules-v24, ${home} against ${away}): ${result.problem}`)
      expect(result.state.phase).toBe('FullTime')
    }
  }, 600_000)
})

// The Dwarves (v26, #211), with Thick Skull, Tackle and Frenzy, against each team and themselves.
describe.each([
  ['dwarves', 'orcs'],
  ['elves', 'dwarves'],
  ['dwarves', 'humans'],
  ['dwarves', 'dwarves'],
] as const)('random play, rules-v26, %s against %s', (home, away) => {
  it.skipIf(process.env.RANDOM_RULES !== undefined && process.env.RANDOM_RULES !== 'rules-v26')('plays to full time without a problem', () => {
    for (const seed of seeds.slice(0, 20)) {
      const result = playRandomMatch(seed, { config: rulesV26, rosters: [home, away] })
      if (result.problem) throw new Error(`Seed ${seed} (rules-v26, ${home} against ${away}): ${result.problem}`)
      expect(result.state.phase).toBe('FullTime')
    }
  }, 600_000)
})

// The Drow (v27, #224), with Strip Ball, Dump-Off and Frenzy, against each team and themselves.
describe.each([
  ['drow', 'orcs'],
  ['elves', 'drow'],
  ['drow', 'humans'],
  ['dwarves', 'drow'],
  ['drow', 'drow'],
] as const)('random play, rules-v27, %s against %s', (home, away) => {
  it.skipIf(process.env.RANDOM_RULES !== undefined && process.env.RANDOM_RULES !== 'rules-v27')('plays to full time without a problem', () => {
    for (const seed of seeds.slice(0, 20)) {
      const result = playRandomMatch(seed, { config: rulesV27, rosters: [home, away] })
      if (result.problem) throw new Error(`Seed ${seed} (rules-v27, ${home} against ${away}): ${result.problem}`)
      expect(result.state.phase).toBe('FullTime')
    }
  }, 600_000)
})
