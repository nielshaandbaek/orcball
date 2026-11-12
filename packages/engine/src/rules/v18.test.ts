import { describe, expect, it } from 'vitest'
import { currentPositionId, RENAMED_POSITIONS, rulesV17, rulesV18 } from '../config'
import { createMatch } from '../match'

// Rules v18: v17 with the Black Orc renamed Brute and the Wardancer renamed
// Dancer, ids and names both (#141). Nothing else changes.

describe('rules v18 config', () => {
  it('is v17 with two positions renamed', () => {
    const { id: _a, rosters: r18, ...rest18 } = rulesV18
    const { id: _b, rosters: r17, ...rest17 } = rulesV17
    expect(rulesV18.id).toBe('rules-v18')
    expect(rest18).toEqual(rest17)

    const { 'black-orc': blackOrc, ...orcs } = r17.orcs!.positions
    expect(r18.orcs!.positions).toEqual({ brute: { ...blackOrc!, name: 'Brute' }, ...orcs })
    const { wardancer, ...elves } = r17.elves!.positions
    expect(r18.elves!.positions).toEqual({ dancer: { ...wardancer!, name: 'Dancer' }, ...elves })
  })

  it('names the players by the new ids', () => {
    const state = createMatch(rulesV18, [rulesV18.rosters.orcs!, rulesV18.rosters.elves!], 1)
    expect(Object.keys(state.players)).toEqual(expect.arrayContaining(['home-brute-1', 'home-brute-2', 'away-dancer-1']))
    expect(Object.keys(state.players).some((id) => id.includes('black-orc') || id.includes('wardancer'))).toBe(false)
  })
})

describe('currentPositionId', () => {
  it('maps the old ids to the new and leaves the others', () => {
    expect(currentPositionId('black-orc')).toBe('brute')
    expect(currentPositionId('wardancer')).toBe('dancer')
    expect(currentPositionId('blitzer')).toBe('blitzer')
    expect(currentPositionId('brute')).toBe('brute')
  })

  it('maps every old id to a position in v18', () => {
    for (const [old, now] of Object.entries(RENAMED_POSITIONS)) {
      const roster = Object.values(rulesV17.rosters).find((r) => old in r.positions)!
      const renamed = Object.values(rulesV18.rosters).find((r) => r.name === roster.name)!
      expect(Object.keys(renamed.positions)).toContain(now)
    }
  })
})
