import { applyLegal, rulesV19 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { evaluate } from './evaluate'
import { Search } from './search'
import { scene } from './test-helpers'
import { viewOf } from './view'

describe('a foul (#174)', () => {
  it('is sampled often enough to see the fouler ejected, so it looks as bad as it is', () => {
    // An Orc Lineman next to a prone Elf, his Foul chosen: kicking him risks a 1 in 5 ejection for little.
    const state = scene(
      { 'home-lineman-1': { col: 9, row: 5 }, 'away-lineman-1': { col: 10, row: 5, status: 'prone' }, 'away-catcher-1': { col: 15, row: 2 } },
      { config: rulesV19 },
    )
    state.teams.home.momentum = 0
    const view = viewOf(applyLegal(state, { type: 'activate', playerId: 'home-lineman-1', action: 'foul' }).state)
    const search = new Search('home')
    const outcomes = search.outcomes(view, { type: 'foul', targetId: 'away-lineman-1' })
    expect(outcomes.length).toBeGreaterThan(1)
    expect(outcomes.some((o) => o.view.players['home-lineman-1']!.status === 'ejected')).toBe(true)
    const expected = outcomes.reduce((sum, o) => sum + o.p * evaluate(o.view, 'home').total, 0)
    expect(expected).toBeLessThan(evaluate(view, 'home').total)
  })
})
