import { FEATURES, type Feature, loadWeights, type Weights } from '@orcball/ai'
import type { MatchResult } from './ai-match'

// Fitting the evaluation weights to what happens next in real matches.
//
// The evaluation is in touchdown units: `score` is worth SCORE points a
// touchdown. So a position's evaluation should be about SCORE times the
// touchdowns the team goes on to outscore the other by. Every go of a run of
// computer matches is a sample: its feature differences, and how many more
// touchdowns home scored than away from there to full time. Ridge regression
// fits the weights to those, pulled towards the starting weights (in units of
// each weight's size) by `lambda`, which cross-validation picks: matches are
// split into folds, and the lambda that predicts held-out matches best wins.
//
// - `score` stays as it is: it sets the units.
// - `leadLate` stays as it is: it's about protecting a lead, not about scoring.
// - The home and away rosters differ, so the fit has a term for which roster
//   a team plays (not part of the weights): otherwise every feature that comes
//   with the stronger roster would get the credit for it.
// - Each sample counts from both teams' points of view, so the fit is zero-sum like the evaluation.

/** The weights the fit changes. */
export const FITTED: readonly Feature[] = FEATURES.filter((f) => f !== 'score' && f !== 'leadLate')

/** The smallest scale, for a weight that starts at or near 0 (as in tune.ts). */
const MIN_SCALE = 0.25

/** The lambdas cross-validation chooses from. */
export const LAMBDAS = [0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3, 10]

const FOLDS = 5

type Sample = { match: number; x: number[]; y: number; roster: number }

export type FitReport = {
  weights: Weights
  samples: number
  matches: number
  lambda: number
  /** Mean squared error predicting held-out matches, in evaluation points squared. */
  heldOutError: { start: number; fitted: number }
  /** By how much the roster home plays is worth more than the other's, in evaluation points. */
  rosterEdge: number
}

/** Every sample from both teams' points of view, with what it should predict. */
function samplesOf(matches: MatchResult[], start: Weights): Sample[] {
  const scoreAt = FEATURES.indexOf('score')
  const leadLateAt = FEATURES.indexOf('leadLate')
  const columns = FITTED.map((f) => FEATURES.indexOf(f))
  const result: Sample[] = []
  matches.forEach((m, match) => {
    if (!m.samples || m.problem) return
    const final = m.score.home - m.score.away
    for (const row of m.samples) {
      // What the fitted weights must make up: the touchdowns still to come, less leadLate's fixed part.
      const y = start.score * (final - row[scoreAt]!) - start.leadLate * row[leadLateAt]!
      const x = columns.map((c) => row[c]!)
      result.push({ match, x, y, roster: 1 }, { match, x: x.map((v) => -v + 0), y: -y + 0, roster: -1 })
    }
  })
  return result
}

/** Solve A u = b by Gaussian elimination with partial pivoting (A is small and, with a ridge, well conditioned). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]!])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r
    ;[M[col], M[pivot]] = [M[pivot]!, M[col]!]
    const p = M[col]![col]!
    if (Math.abs(p) < 1e-12) throw new Error('fit: the samples leave a weight undetermined')
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r]![col]! / p
      if (factor !== 0) for (let c = col; c <= n; c++) M[r]![c]! -= factor * M[col]![c]!
    }
  }
  return M.map((row, i) => row[n]! / row[i]!)
}

/**
 * The fit on some samples: offsets u from the start weights (in scales) and
 * the roster term. Columns: one per fitted weight, scaled, then the roster.
 */
function ridge(samples: Sample[], start: number[], scale: number[], lambda: number): { u: number[]; roster: number } {
  const k = start.length
  const n = k + 1
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const b = new Array<number>(n).fill(0)
  const z = new Array<number>(n)
  for (const s of samples) {
    let residual = s.y
    for (let j = 0; j < k; j++) {
      z[j] = s.x[j]! * scale[j]!
      residual -= s.x[j]! * start[j]!
    }
    z[k] = s.roster
    for (let i = 0; i < n; i++) {
      b[i]! += z[i]! * residual
      for (let j = 0; j < n; j++) A[i]![j]! += z[i]! * z[j]!
    }
  }
  // The ridge, per sample so lambda doesn't depend on how many there are. The roster term isn't pulled.
  for (let j = 0; j < k; j++) A[j]![j]! += lambda * samples.length
  const solution = solve(A, b)
  return { u: solution.slice(0, k), roster: solution[k]! }
}

function meanSquaredError(samples: Sample[], weights: number[], roster: number): number {
  let sum = 0
  for (const s of samples) {
    let predicted = roster * s.roster
    for (let j = 0; j < weights.length; j++) predicted += weights[j]! * s.x[j]!
    sum += (s.y - predicted) ** 2
  }
  return sum / Math.max(1, samples.length)
}

/** Four decimals, as in tune.ts. */
function round(x: number): number {
  return Math.round(x * 10_000) / 10_000 + 0
}

export function fitWeights(matches: MatchResult[], start: Weights, id = 'fitted'): FitReport {
  const samples = samplesOf(matches, start)
  const used = new Set(samples.map((s) => s.match)).size
  if (used < FOLDS) throw new Error(`fit: ${used} matches with samples; at least ${FOLDS} are needed (run ai-match with --samples)`)
  const w0 = FITTED.map((f) => start[f])
  const scale = w0.map((w) => Math.max(MIN_SCALE, Math.abs(w)))
  const weightsOf = (u: number[]) => w0.map((w, j) => w + scale[j]! * u[j]!)
  const fold = (s: Sample) => s.match % FOLDS

  // Held-out error for each lambda, and for the start weights (with only the roster term fitted).
  const heldOut = (lambda: number | null) => {
    let sum = 0
    for (let f = 0; f < FOLDS; f++) {
      const train = samples.filter((s) => fold(s) !== f)
      const test = samples.filter((s) => fold(s) === f)
      const fit = ridge(train, w0, scale, lambda ?? 1e9)
      sum += meanSquaredError(test, weightsOf(fit.u), fit.roster) * test.length
    }
    return sum / samples.length
  }
  let best = { lambda: LAMBDAS[0]!, error: Infinity }
  for (const lambda of LAMBDAS) {
    const error = heldOut(lambda)
    if (error < best.error) best = { lambda, error }
  }
  const fit = ridge(samples, w0, scale, best.lambda)
  const fitted = weightsOf(fit.u)
  const weights = { ...start, id }
  FITTED.forEach((f, j) => {
    weights[f] = round(fitted[j]!)
  })
  return {
    weights: loadWeights(weights),
    samples: samples.length / 2,
    matches: used,
    lambda: best.lambda,
    heldOutError: { start: heldOut(null), fitted: best.error },
    rosterEdge: 2 * fit.roster,
  }
}
