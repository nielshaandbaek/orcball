import { describe, expect, it } from 'vitest'
import { benchmark, formatBench, samplePositions } from './bench'

// The engine speed benchmark. It only runs with BENCH set, through
// `pnpm --filter @orcball/tools bench`; `pnpm test` just checks it works.

describe('engine benchmark', () => {
  it('measures on a few positions', () => {
    const result = benchmark(samplePositions(1, 50), 1)
    expect(result.positions).toBeGreaterThan(0)
    expect(result.applyPerSecond).toBeGreaterThan(0)
  })

  it.skipIf(!process.env.BENCH)('measures apply, availableCommands and reachableHexes', () => {
    console.log(formatBench(benchmark(samplePositions(Number(process.env.BENCH_MATCHES ?? 5)))))
  }, 120_000)
})
