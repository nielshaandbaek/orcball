import { createMatch, rulesV14 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { tokenIcon } from './icons'

describe('tokenIcon', () => {
  it('has a sprite for every Orc and Elf position, different for home and away', () => {
    const { orcs, elves } = rulesV14.rosters
    for (const rosters of [
      [orcs!, elves!],
      [elves!, orcs!],
    ] as const) {
      const state = createMatch(rulesV14, [rosters[0], rosters[1]], 1)
      const file = { rosters } as unknown as Parameters<typeof tokenIcon>[0]
      for (const p of Object.values(state.players)) expect(tokenIcon(file, p), p.id).toMatch(/\.png$/)
    }
    // The same position on the other side gets the other colours.
    const mirror = createMatch(rulesV14, [orcs!, orcs!], 1)
    const file = { rosters: [orcs, orcs] } as unknown as Parameters<typeof tokenIcon>[0]
    expect(tokenIcon(file, mirror.players['home-blitzer-1']!)).not.toBe(tokenIcon(file, mirror.players['away-blitzer-1']!))
  })
})
