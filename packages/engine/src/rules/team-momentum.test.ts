import { describe, expect, it } from 'vitest'
import { loadRuleConfig, rulesV32 } from '../config'
import { createMatch } from '../match'

// A team's own Momentum (#278): a roster may set its tokens per drive, in
// place of the rules' momentum.perHalf.

const { drow, humans } = rulesV32.rosters as Record<'drow' | 'humans', (typeof rulesV32.rosters)[string]>
const config = { ...rulesV32, rosters: { ...rulesV32.rosters, drow: { ...drow!, momentum: 0 } } }

describe("a team's own Momentum (#278)", () => {
  it('loads a roster with its own Momentum, and refuses a negative one', () => {
    expect(loadRuleConfig(config).rosters.drow!.momentum).toBe(0)
    expect(() => loadRuleConfig({ ...config, rosters: { ...config.rosters, drow: { ...drow!, momentum: -1 } } })).toThrow()
  })

  it("starts the match with the team's own tokens, and the other team with the rules'", () => {
    const state = createMatch(config, [config.rosters.drow, humans!], 1)
    expect(state.teams.home).toMatchObject({ momentum: 0, ownMomentum: 0 })
    expect(state.teams.away.momentum).toBe(2)
    expect(state.teams.away).not.toHaveProperty('ownMomentum')
  })

  it("leaves the team state of a roster without its own Momentum as before, so older matches don't change", () => {
    const state = createMatch(rulesV32, [drow!, humans!], 1)
    expect(state.teams.home).toEqual({ name: 'Drow', score: 0, momentum: 2, momentumUsedThisRound: false, usedThisRound: { blitz: 0, pass: 0, handOff: 0, foul: 0 } })
  })
})
