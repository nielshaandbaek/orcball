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

describe('a block on a Brace player (#228)', () => {
  /** An Orc Blitzer about to block an Elf Lineman (Brace) who hasn't activated, the decision his to Brace or not. */
  function blocked(brace: boolean) {
    const state = scene({ 'home-blitzer-1': { col: 9, row: 5 }, 'away-lineman-1': { col: 10, row: 5 }, 'away-catcher-1': { col: 15, row: 2 } }, { config: rulesV19 })
    state.teams.home.momentum = 0
    state.teams.away.momentum = 0
    if (!brace) state.players['away-lineman-1']!.skills = []
    const active = applyLegal(state, { type: 'activate', playerId: 'home-blitzer-1', action: 'block' }).state
    return viewOf(applyLegal(active, { type: 'block', targetId: 'away-lineman-1' }).state)
  }

  it("is searched through the Brace decision to the block's result, not scored as nothing", () => {
    const braced = blocked(true)
    expect(braced.pending?.kind).toBe('blocking.brace')
    const plain = blocked(false)
    expect(plain.pending?.kind).toBe('blocking.shoveOrTackle')
    const search = new Search('home')
    const gain = (view: typeof braced) => search.settled(view, 'home', 2) - search.value(view, 'home')
    // Without Brace the block is worth something; with it, Brace makes it a little worse but not worthless.
    expect(gain(plain)).toBeGreaterThan(0)
    expect(gain(braced)).toBeGreaterThan(gain(plain) * 0.3)
  })
})
