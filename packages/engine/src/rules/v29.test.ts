import { describe, expect, it } from 'vitest'
import { rulesV28, rulesV29 } from '../config'
import { createMatch } from '../match'

// Rules v29: v28 with the Drow (#250) and the Elves (#251) toned down: one
// Witch or Dancer fewer, a third Lineman, and no Brace for their Linemen.

describe('rules v29 config', () => {
  it('is v28 with only the Drow and Elf rosters changed', () => {
    const { id: _a, rosters: r29, ...rest29 } = rulesV29
    const { id: _b, rosters: r28, ...rest28 } = rulesV28
    expect(rulesV29.id).toBe('rules-v29')
    expect(rest29).toEqual(rest28)
    const { drow: d29, elves: e29, ...others29 } = r29
    const { drow: d28, elves: e28, ...others28 } = r28
    expect(others29).toEqual(others28)
    const maxes = (r: typeof d29) => Object.fromEntries(Object.entries(r!.positions).map(([id, p]) => [id, [p.max, ...p.skills]]))
    expect(maxes(d29)).toEqual({ lineman: [3], blitzer: [2, 'Strip Ball'], runner: [1, 'Dump-Off'], witch: [1, 'Frenzy'] })
    expect(maxes(e29)).toEqual({ dancer: [1, 'Leap'], catcher: [2, 'Catch'], thrower: [1, 'Pass'], lineman: [3] })
    // v28 keeps two Witches and two Dancers, with Brace.
    expect(maxes(d28)).toEqual({ lineman: [2, 'Brace'], blitzer: [2, 'Strip Ball'], runner: [1, 'Dump-Off'], witch: [2, 'Frenzy'] })
    expect(maxes(e28)).toEqual({ dancer: [2, 'Leap'], catcher: [2, 'Catch'], thrower: [1, 'Pass'], lineman: [2, 'Brace'] })
    // Every other stat as before.
    for (const [roster, before] of [[d29!, d28!], [e29!, e28!]] as const)
      for (const [id, p] of Object.entries(roster.positions)) {
        const { max: _m, skills: _s, ...stats } = p
        const { max: _n, skills: _t, ...was } = before.positions[id]!
        expect(stats).toEqual(was)
      }
  })

  it('fields 7 of each, the Linemen with no skill', () => {
    for (const id of ['drow', 'elves']) {
      const state = createMatch(rulesV29, [rulesV29.rosters[id]!, rulesV29.rosters.humans!], 1)
      expect(Object.values(state.players).filter((p) => p.team === 'home')).toHaveLength(7)
      expect(state.players['home-lineman-3']!.skills).toEqual([])
    }
  })
})
