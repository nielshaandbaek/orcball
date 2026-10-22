import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { exportMatch, type GameEvent, type GameState, type MatchFile } from '@orcball/engine'
import { playRandomMatch } from './bot'

// Golden replays: a few saved random matches with their final state and
// events. CI replays them; any change to the rules that changes what happens
// in them fails the build until they are regenerated on purpose.

export const GOLDEN_DIR = join(import.meta.dirname, '..', 'golden')

export type Golden = { file: MatchFile; finalState: GameState; events: GameEvent[] }

export function readGoldens(): { name: string; golden: Golden }[] {
  return readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((name) => ({ name, golden: JSON.parse(readFileSync(join(GOLDEN_DIR, name), 'utf8')) as Golden }))
}

/** Regenerate the golden logs: the first three seeds whose random match has a touchdown. */
export function writeGoldens(): string[] {
  const written: string[] = []
  for (let seed = 1; written.length < 3; seed++) {
    const result = playRandomMatch(seed)
    if (result.problem) throw new Error(`Seed ${seed}: ${result.problem}`)
    if (result.state.teams.home.score + result.state.teams.away.score === 0) continue
    const name = `seed-${seed}.json`
    const golden: Golden = { file: JSON.parse(exportMatch(result.file)), finalState: result.state, events: result.events }
    writeFileSync(join(GOLDEN_DIR, name), `${JSON.stringify(golden)}\n`)
    written.push(name)
  }
  return written
}
