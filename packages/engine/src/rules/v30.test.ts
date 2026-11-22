import { describe, expect, it } from 'vitest'
import { rulesV29, rulesV30 } from '../config'
import { createMatch } from '../match'

// Rules v30: v29 with two more teams, the Lizards (#237) and the Amazons (#238).

const statsOf = (roster: (typeof rulesV30.rosters)[string]) =>
  Object.fromEntries(Object.entries(roster.positions).map(([id, p]) => [id, [p.name, p.max, p.ma, p.st, p.ag, p.to, ...p.skills]]))

describe('rules v30 config', () => {
  it('is v29 with the Lizards and the Amazons, and v29 is unchanged', () => {
    const { id: _a, rosters: r30, ...rest30 } = rulesV30
    const { id: _b, rosters: r29, ...rest29 } = rulesV29
    expect(rulesV30.id).toBe('rules-v30')
    expect(rest30).toEqual(rest29)
    const { lizards, amazons, ...others } = r30
    expect(others).toEqual(r29)
    expect(r29.lizards).toBeUndefined()
    expect(r29.amazons).toBeUndefined()
    expect(lizards!.name).toBe('Lizards')
    expect(lizards!.traits ?? []).toEqual([])
    expect(statsOf(lizards!)).toEqual({
      warrior: ['Warrior', 3, 5, 4, 9, 9, 'Juggernaut'],
      shaman: ['Shaman', 1, 6, 2, 5, 7, 'Sure Hands'],
      gecko: ['Gecko', 3, 7, 2, 5, 7, 'Dodge'],
    })
    expect(amazons!.name).toBe('Amazons')
    expect(amazons!.traits).toEqual(['Dodge'])
    expect(statsOf(amazons!)).toEqual({
      blitzer: ['Blitzer', 2, 5, 3, 5, 8, 'Jump Up'],
      blocker: ['Blocker', 2, 5, 3, 5, 8, 'Guard'],
      thrower: ['Thrower', 1, 5, 3, 5, 8, 'Pass'],
      lineman: ['Lineman', 2, 5, 3, 5, 8, 'Brace'],
    })
  })

  it('fields 7 of each, the Amazons all with Dodge', () => {
    const state = createMatch(rulesV30, [rulesV30.rosters.lizards!, rulesV30.rosters.amazons!], 1)
    expect(Object.values(state.players).filter((p) => p.team === 'home')).toHaveLength(7)
    expect(Object.values(state.players).filter((p) => p.team === 'away')).toHaveLength(7)
    expect(state.players['home-warrior-3']!.skills).toEqual(['Juggernaut'])
    expect(state.players['away-blitzer-1']!.skills).toEqual(['Jump Up', 'Dodge'])
    expect(state.players['away-lineman-2']!.skills).toEqual(['Brace', 'Dodge'])
  })
})
