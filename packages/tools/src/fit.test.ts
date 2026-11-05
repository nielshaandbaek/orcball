import { defaultWeights, FEATURES, type Weights } from '@orcball/ai'
import { describe, expect, it } from 'vitest'
import type { MatchResult } from './ai-match'
import { FITTED, fitWeights } from './fit'

/** A seeded generator for made-up samples. */
function uniform(seed: number): () => number {
  let s = seed
  return () => {
    s = (Math.imul(s, 1_103_515_245) + 12_345) >>> 0
    return s / 4_294_967_296
  }
}

/**
 * Made-up matches whose touchdowns to come follow known weights, plus noise:
 * the final score difference is set so that score × (final − now) is the
 * weighted sum of the features (rounding aside, it's what the fit sees).
 */
function madeUpMatches(truth: Weights, count: number): MatchResult[] {
  const random = uniform(3)
  return Array.from({ length: count }, (_, i) => {
    const row = FEATURES.map((f) => (f === 'score' || f === 'leadLate' ? 0 : Math.round((random() - 0.5) * 6)))
    const value = FEATURES.reduce((sum, f, j) => sum + truth[f] * row[j]!, 0)
    const final = value / truth.score + (random() - 0.5) * 0.2
    return {
      seed: i,
      home: 0,
      // Only the difference matters to the fit.
      score: { home: final, away: 0 },
      winner: 'draw',
      activations: 1,
      times: [[], []],
      problem: null,
      samples: [row],
    } satisfies MatchResult
  })
}

describe('fitWeights', () => {
  it('finds the weights the touchdowns to come follow', () => {
    const truth = { ...defaultWeights, ball: 5, standing: 2, injured: -1, momentum: 0.1 }
    const report = fitWeights(madeUpMatches(truth, 2000), defaultWeights)
    for (const f of FITTED) expect(report.weights[f], f).toBeCloseTo(truth[f], 0)
    expect(report.weights.score).toBe(defaultWeights.score)
    expect(report.weights.leadLate).toBe(defaultWeights.leadLate)
    expect(report.heldOutError.fitted).toBeLessThan(report.heldOutError.start)
  })

  it('needs samples from a few matches', () => {
    expect(() => fitWeights(madeUpMatches(defaultWeights, 3), defaultWeights)).toThrow(/at least 5/)
  })
})
