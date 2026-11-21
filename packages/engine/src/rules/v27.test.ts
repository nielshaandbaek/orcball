import { describe, expect, it } from 'vitest'
import { rulesV26, rulesV27 } from '../config'
import { createMatch } from '../match'

// Rules v27: v26 with a fifth team, the Drow (#224): Linemen (Brace), Blitzers
// (Strip Ball, #198), a Runner (Dump-Off, #225) and Witches (Frenzy, #213).

describe('rules v27 config', () => {
  it('is v26 with a fifth team, the Drow, and v26 is unchanged', () => {
    const { id: _a, rosters: r27, ...rest27 } = rulesV27
    const { id: _b, rosters: r26, ...rest26 } = rulesV26
    expect(rulesV27.id).toBe('rules-v27')
    expect(rest27).toEqual(rest26)
    const { drow, ...others } = r27
    expect(others).toEqual(r26)
    expect(r26.drow).toBeUndefined()
    // #224: one skill per position, no team trait.
    expect(drow!.name).toBe('Drow')
    expect(drow!.traits).toBeUndefined()
    const stats = Object.fromEntries(Object.entries(drow!.positions).map(([id, p]) => [id, [p.name, p.max, p.ma, p.st, p.ag, p.to, ...p.skills]]))
    expect(stats).toEqual({
      lineman: ['Lineman', 2, 5, 3, 4, 8, 'Brace'],
      blitzer: ['Blitzer', 2, 6, 3, 4, 8, 'Strip Ball'],
      runner: ['Runner', 1, 6, 3, 4, 7, 'Dump-Off'],
      witch: ['Witch', 2, 6, 3, 4, 7, 'Frenzy'],
    })
  })

  it('fields 7 Drow, each with his position\'s skill', () => {
    const state = createMatch(rulesV27, [rulesV27.rosters.drow!, rulesV27.rosters.elves!], 1)
    expect(Object.values(state.players).filter((p) => p.team === 'home')).toHaveLength(7)
    expect(state.players['home-witch-2']!.skills).toEqual(['Frenzy'])
    expect(state.players['home-blitzer-1']!.skills).toEqual(['Strip Ball'])
    expect(state.players['home-runner-1']!.skills).toEqual(['Dump-Off'])
    expect(state.players['home-lineman-1']!.skills).toEqual(['Brace'])
  })
})
