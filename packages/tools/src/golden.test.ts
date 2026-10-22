import { engine, exportMatch, importMatch, replay, rulesV10 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { readGoldens, writeGoldens } from './golden'

// GOLDEN_UPDATE=1 regenerates the files instead of checking them; see README.md.

const update = process.env.GOLDEN_UPDATE === '1'

describe('golden replays', () => {
  if (update) {
    it('regenerates the golden logs', () => {
      console.log(`Wrote ${writeGoldens().join(', ')}`)
    })
    return
  }

  const goldens = readGoldens()

  it('has some to check', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(3)
  })

  for (const { name, golden } of goldens) {
    it(`${name} replays to the same final state and events`, () => {
      const file = importMatch(exportMatch(golden.file), rulesV10)
      expect(replay(file, rulesV10)).toEqual(golden.finalState)
      // Re-apply each command and compare the events it produces.
      let state = replay(file, rulesV10, 0)
      const events = file.entries.filter((e) => !e.undone).flatMap((entry) => {
        const result = engine.apply(state, entry.command)
        state = result.state
        return result.events
      })
      expect(events).toEqual(golden.events)
    })
  }
})
