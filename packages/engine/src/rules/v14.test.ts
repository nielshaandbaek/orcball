import { describe, expect, it } from 'vitest'
import { rulesV13, rulesV14 } from '../config'
import { createMatch } from '../match'

// Rules v14: v13 with one Elf Wardancer swapped for a Lineman, to narrow the
// gap the balance reports show between Orcs and Elves (#65).

describe('rules v14 config', () => {
  it('is v13 with one Wardancer fewer and one Lineman more for the Elves', () => {
    const { id: _a, rosters: r14, ...rest14 } = rulesV14
    const { id: _b, rosters: r13, ...rest13 } = rulesV13
    expect(rulesV14.id).toBe('rules-v14')
    expect(rest14).toEqual(rest13)
    expect(r14.orcs).toEqual(r13.orcs)
    const { wardancer: w14, lineman: l14, ...others14 } = r14.elves!.positions
    const { wardancer: w13, lineman: l13, ...others13 } = r13.elves!.positions
    expect(others14).toEqual(others13)
    expect(w14).toEqual({ ...w13, max: 1 })
    expect(l14).toEqual({ ...l13, max: 3 })
  })
  it('fields seven Elves: one Wardancer, three Linemen', () => {
    const state = createMatch(rulesV14, [rulesV14.rosters.orcs!, rulesV14.rosters.elves!], 1)
    const elves = Object.values(state.players).filter((p) => p.team === 'away')
    expect(elves).toHaveLength(7)
    expect(elves.filter((p) => p.position === 'wardancer').map((p) => p.id)).toEqual(['away-wardancer-1'])
    expect(elves.filter((p) => p.position === 'lineman').map((p) => p.skills)).toEqual([['Brace'], ['Brace'], ['Brace']])
  })
})
