import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AiLevel, defaultWeights, type Feature, type Weights } from '@orcball/ai'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TUNE, type PlayBatch, shardedPlay, TUNED, tune } from './tune'

// The tuner. `pnpm test` checks it finds a known best on a made-up match; the
// real tuning only runs with TUNE set, through `pnpm --filter @orcball/tools
// tune` (see the README).

/** A seeded generator for the made-up matches. */
function uniform(seed: number): () => number {
  let s = seed
  return () => {
    s = (Math.imul(s, 1_103_515_245) + 12_345) >>> 0
    return s / 4_294_967_296
  }
}

describe('tune', () => {
  // A made-up match: the nearer a side's weights are to a hidden best, the likelier it wins.
  const best: Partial<Record<Feature, number>> = { ball: 5, carrierProgress: 0.2, standing: 2, looseBallCloser: 0.5 }
  const distance = (w: Weights) => Math.sqrt(TUNED.reduce((sum, f) => sum + ((w[f] - (best[f] ?? defaultWeights[f])) / Math.max(0.25, Math.abs(defaultWeights[f]))) ** 2, 0))
  const madeUp = (): PlayBatch => {
    const random = uniform(7)
    return async (plus, minus, _firstSeed, matches) => {
      const edge = Math.tanh(2 * (distance(minus) - distance(plus)))
      let net = 0
      for (let i = 0; i < matches; i++) {
        const x = random()
        // A third of the matches are drawn; the rest go to plus with a chance of (1 + edge) / 2.
        if (x < 1 / 3) continue
        net += (x - 1 / 3) / (2 / 3) < (1 + edge) / 2 ? 1 : -1
      }
      return net / matches
    }
  }

  it('moves the weights towards the ones that win more', async () => {
    const iterations: number[] = []
    const tuned = await tune(defaultWeights, madeUp(), { ...DEFAULT_TUNE, iterations: 300 }, (it) => iterations.push(it.result))
    expect(iterations).toHaveLength(300)
    expect(distance(tuned)).toBeLessThan(distance(defaultWeights) / 2)
    expect(tuned.score).toBe(defaultWeights.score)
    expect(tuned.id).toBe('tuned')
  })

  it('repeats a run exactly from the same seed', async () => {
    const options = { ...DEFAULT_TUNE, iterations: 20 }
    expect(await tune(defaultWeights, madeUp(), options)).toEqual(await tune(defaultWeights, madeUp(), options))
  })
})

describe.skipIf(!process.env.TUNE)('tuning', () => {
  // Set by tune-cli.mjs; see the README.
  it('tunes the weights', async () => {
    const env = process.env
    const work = mkdtempSync(join(tmpdir(), 'tune-'))
    const progress = (line: string) => env.TUNE_PROGRESS && appendFileSync(env.TUNE_PROGRESS, `${line}\n`)
    const options = {
      ...DEFAULT_TUNE,
      iterations: Number(env.TUNE_ITERATIONS),
      matches: Number(env.TUNE_MATCHES),
      seed: Number(env.TUNE_SEED),
    }
    const play = shardedPlay({
      level: env.TUNE_LEVEL as AiLevel,
      parallel: Number(env.TUNE_PARALLEL),
      work,
      rules: env.TUNE_RULES!,
      rosters: env.TUNE_ROSTERS!,
      budgetMs: Number(env.TUNE_BUDGET_MS),
    })
    const start = Date.now()
    let total = 0
    try {
      const tuned = await tune(defaultWeights, play, options, (it) => {
        total += it.result
        const minutes = ((Date.now() - start) / 60_000).toFixed(1)
        const changed = TUNED.filter((f) => it.weights[f] !== defaultWeights[f])
          .map((f) => `${f} ${it.weights[f]}`)
          .join(', ')
        // Saved every iteration, so a run that is stopped (GitHub's 6-hour limit) keeps its weights so far.
        writeFileSync(env.TUNE_OUT!, `${JSON.stringify({ ...it.weights, id: `tuning-${it.iteration}` }, null, 2)}\n`)
        progress(`${it.iteration}/${options.iterations}: plus ${it.result >= 0 ? '+' : ''}${it.result.toFixed(2)}, ${minutes} min. ${changed}`)
      })
      writeFileSync(env.TUNE_OUT!, `${JSON.stringify(tuned, null, 2)}\n`)
      progress(`Tuned weights written to ${env.TUNE_OUT} (average result ${(total / options.iterations).toFixed(3)})`)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }, 24 * 3600_000)
})
