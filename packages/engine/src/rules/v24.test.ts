import { describe, expect, it } from 'vitest'
import { rulesV23, rulesV24 } from '../config'
import { createMatch } from '../match'

// Rules v24: v23 with a third team, the Humans (#192).

const { orcs, humans } = rulesV24.rosters as Record<'orcs' | 'humans', (typeof rulesV24.rosters)[string]>

describe('rules v24 config', () => {
  it('is v23 with the Humans added', () => {
    const { id: _a, rosters: r24, ...rest24 } = rulesV24
    const { id: _b, rosters: r23, ...rest23 } = rulesV23
    expect(rulesV24.id).toBe('rules-v24')
    expect(rest24).toEqual(rest23)
    const { humans: h, ...others } = r24
    expect(others).toEqual(r23)
    expect(h).toBeDefined()
  })

  it('gives the Humans their stats, one skill a position', () => {
    const stats = Object.fromEntries(Object.entries(humans!.positions).map(([id, p]) => [id, [p.max, p.ma, p.st, p.ag, p.to, ...p.skills]]))
    expect(stats).toEqual({
      blitzer: [2, 6, 3, 6, 8, 'Block'],
      catcher: [2, 7, 2, 5, 7, 'Catch'],
      thrower: [1, 5, 3, 6, 8, 'Pass'],
      lineman: [2, 5, 3, 6, 8, 'Brace'],
    })
  })
})

describe('a match with the Humans', () => {
  it('fields seven Humans against the Orcs', () => {
    const state = createMatch(rulesV24, [humans!, orcs!], 1)
    expect(state.teams.home.name).toBe('Humans')
    expect(Object.keys(state.players).filter((id) => id.startsWith('home-'))).toHaveLength(7)
  })

  it('can be a mirror match', () => {
    const state = createMatch(rulesV24, [humans!, humans!], 1)
    expect(Object.keys(state.players).filter((id) => id.startsWith('away-'))).toHaveLength(7)
    expect(state.players['home-blitzer-1']!.team).toBe('home')
    expect(state.players['away-blitzer-1']!.team).toBe('away')
  })
})
