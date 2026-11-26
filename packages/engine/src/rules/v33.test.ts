import { describe, expect, it } from 'vitest'
import { rulesV32, rulesV33 } from '../config'
import { createMatch } from '../match'

// Rules v33: v32 with a ninth team, the Ratmen (#276).

describe('rules v33 config', () => {
  it('is v32 with the Ratmen, and v32 is unchanged', () => {
    const { id: _a, rosters: r33, ...rest33 } = rulesV33
    const { id: _b, rosters: r32, ...rest32 } = rulesV32
    expect(rulesV33.id).toBe('rules-v33')
    expect(rest33).toEqual(rest32)
    const { ratmen, ...others33 } = r33
    expect(others33).toEqual(r32)
    expect(r32.ratmen).toBeUndefined()
    expect(ratmen!.name).toBe('Ratmen')
    expect(ratmen!.traits).toBeUndefined()
    expect(ratmen!.positions).toEqual({
      lineman: { name: 'Lineman', max: 3, ma: 6, st: 3, ag: 6, to: 7, skills: ['Brace'] },
      thrower: { name: 'Thrower', max: 1, ma: 6, st: 3, ag: 6, to: 7, skills: ['Pass'] },
      runner: { name: 'Runner', max: 1, ma: 8, st: 2, ag: 4, to: 7, skills: ['Dodge'] },
      blitzer: { name: 'Blitzer', max: 2, ma: 7, st: 3, ag: 6, to: 8, skills: ['Block'] },
    })
  })

  it('fields 7 Ratmen: 3 Linemen, 1 Thrower, 1 Runner and 2 Blitzers', () => {
    const state = createMatch(rulesV33, [rulesV33.rosters.ratmen!, rulesV33.rosters.humans!], 1)
    const ratmen = Object.values(state.players).filter((p) => p.team === 'home')
    expect(ratmen.map((p) => p.position).sort()).toEqual(['blitzer', 'blitzer', 'lineman', 'lineman', 'lineman', 'runner', 'thrower'])
    expect(ratmen.filter((p) => p.position === 'runner').map((p) => p.ma)).toEqual([8])
  })
})
