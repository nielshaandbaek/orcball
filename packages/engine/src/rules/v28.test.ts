import { describe, expect, it } from 'vitest'
import { rulesV27, rulesV28, traitsFor } from '../config'
import { createMatch } from '../match'

// Rules v28: v27 with a sixth team, the Undead (#229): Skeletons (Brace),
// Ghouls (Dodge), Wights (Block) and a Mummy (Crushing Blow), with
// Regeneration (#231) as a team trait for all but the Ghouls.

describe('rules v28 config', () => {
  it('is v27 with a sixth team, the Undead, and v27 is unchanged', () => {
    const { id: _a, rosters: r28, ...rest28 } = rulesV28
    const { id: _b, rosters: r27, ...rest27 } = rulesV27
    expect(rulesV28.id).toBe('rules-v28')
    expect(rest28).toEqual(rest27)
    const { undead, ...others } = r28
    expect(others).toEqual(r27)
    expect(r27.undead).toBeUndefined()
    expect(undead!.name).toBe('Undead')
    expect(undead!.traits).toEqual([{ skill: 'Regeneration', except: ['ghoul'] }])
    const stats = Object.fromEntries(Object.entries(undead!.positions).map(([id, p]) => [id, [p.name, p.max, p.ma, p.st, p.ag, p.to, ...p.skills]]))
    expect(stats).toEqual({
      lineman: ['Skeleton', 2, 4, 3, 8, 7, 'Brace'],
      ghoul: ['Ghoul', 2, 6, 3, 5, 7, 'Dodge'],
      blitzer: ['Wight', 2, 5, 3, 6, 8, 'Block'],
      mummy: ['Mummy', 1, 2, 5, 9, 9, 'Crushing Blow'],
    })
    expect(traitsFor(undead!, 'ghoul')).toEqual([])
    expect(traitsFor(undead!, 'mummy')).toEqual(['Regeneration'])
  })

  it('fields 7 Undead, Regeneration for all but the Ghouls', () => {
    const state = createMatch(rulesV28, [rulesV28.rosters.undead!, rulesV28.rosters.elves!], 1)
    expect(Object.values(state.players).filter((p) => p.team === 'home')).toHaveLength(7)
    expect(state.players['home-lineman-1']!.skills).toEqual(['Brace', 'Regeneration'])
    expect(state.players['home-blitzer-2']!.skills).toEqual(['Block', 'Regeneration'])
    expect(state.players['home-mummy-1']!.skills).toEqual(['Crushing Blow', 'Regeneration'])
    expect(state.players['home-ghoul-1']!.skills).toEqual(['Dodge'])
  })
})
