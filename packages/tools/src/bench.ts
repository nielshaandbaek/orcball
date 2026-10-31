import { createMatch, engine, type GameState, reachableHexes, type RuleConfig, rulesV12 } from '@orcball/engine'
import { playRandomMatch } from './bot'

// How fast the engine simulates, for planning the computer opponent's
// search. Positions come from random matches: every state in play (a go or
// an activation) is a sample. Each measurement runs over all samples.

export type BenchResult = {
  positions: number
  /** engine.apply calls per second, each a legal command from a sample. */
  applyPerSecond: number
  availableCommandsPerSecond: number
  /** reachableHexes for one standing player of the team to act. */
  reachableHexesPerSecond: number
}

/** States in play from `matches` random matches, every `every`th one. */
export function samplePositions(matches: number, every = 5, config: RuleConfig = rulesV12): GameState[] {
  const positions: GameState[] = []
  for (let seed = 1; seed <= matches; seed++) {
    const { file } = playRandomMatch(seed, { config })
    let state = createMatch(config, file.rosters, file.seed)
    file.entries.forEach((entry, i) => {
      if (i % every === 0 && (state.phase === 'Round' || state.phase === 'Activation')) positions.push(state)
      state = engine.apply(state, entry.command).state
    })
  }
  return positions
}

/** Calls per second of `fn` over the items, repeated until at least `minMs` has passed. */
function rate<T>(items: readonly T[], fn: (item: T) => unknown, minMs: number): number {
  let calls = 0
  const start = performance.now()
  let elapsed = 0
  do {
    for (const item of items) fn(item)
    calls += items.length
    elapsed = performance.now() - start
  } while (elapsed < minMs)
  return Math.round((calls / elapsed) * 1000)
}

export function benchmark(positions: readonly GameState[], minMs = 2000): BenchResult {
  const applies = positions.flatMap((state) => engine.legalCommands(state).map((command) => ({ state, command })))
  const movers = positions.flatMap((state) => {
    const id = state.activation?.playerId ?? Object.values(state.players).find((p) => p.team === state.turnOwner && p.hex && p.status === 'standing')?.id
    return id ? [{ state, id }] : []
  })
  return {
    positions: positions.length,
    applyPerSecond: rate(applies, ({ state, command }) => engine.apply(state, command), minMs),
    availableCommandsPerSecond: rate(positions, (state) => engine.availableCommands(state), minMs),
    reachableHexesPerSecond: rate(movers, ({ state, id }) => reachableHexes(state, id), minMs),
  }
}

export function formatBench(result: BenchResult): string {
  const n = (x: number) => x.toLocaleString('en-GB')
  return [
    `Engine speed over ${n(result.positions)} positions from random matches (rules v12):`,
    `  apply              ${n(result.applyPerSecond)}/s`,
    `  availableCommands  ${n(result.availableCommandsPerSecond)}/s`,
    `  reachableHexes     ${n(result.reachableHexesPerSecond)}/s`,
  ].join('\n')
}
