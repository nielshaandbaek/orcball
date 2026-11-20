import { createMatch, type MatchFile, newMatchFile, rulesV26 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { skillsText } from './labels'

describe('skillsText', () => {
  it('marks a team trait, and leaves it out for a position the trait skips (#211, #231)', () => {
    const orcs = { ...rulesV26.rosters.orcs!, traits: ['Thick Skull', { skill: 'Regeneration', except: ['thrower'] }] } as typeof rulesV26.rosters.orcs
    const rosters = [orcs!, rulesV26.rosters.elves!] as const
    const state = createMatch(rulesV26, [...rosters], 1)
    const file: MatchFile = newMatchFile(rulesV26, [...rosters], 1)
    expect(skillsText(file, state.players['home-lineman-1']!)).toBe('Brace, Thick Skull (team), Regeneration (team)')
    expect(skillsText(file, state.players['home-thrower-1']!)).toBe('Sure Hands, Thick Skull (team)')
  })
})
