import { describe, expect, it } from 'vitest'
import { RuleConfigError, ruleConfigHash, rulesV10 } from './config'
import { legalCommands } from './index'
import { createMatch } from './match'
import { seededRng } from './rng'

const { orcs, elves } = rulesV10.rosters as Record<'orcs' | 'elves', (typeof rulesV10.rosters)[string]>
const start = () => createMatch(rulesV10, [orcs, elves], 42)

describe('createMatch', () => {
  it('starts in Setup with the kicking team to go', () => {
    const state = start()
    expect(state.phase).toBe('Setup')
    expect(state.half).toBe(1)
    expect(state.round).toBe(0)
    expect(state.kickingTeam).toBe('away')
    expect(state.turnOwner).toBe('away')
    expect(state.pending).toBeNull()
    expect(state.ball).toEqual({ hex: null, carrier: null })
  })

  it('lets the caller choose who kicks off', () => {
    const state = createMatch(rulesV10, [orcs, elves], 42, { kickingTeam: 'home' })
    expect(state.kickingTeam).toBe('home')
    expect(state.turnOwner).toBe('home')
  })

  it('creates every rostered player, off the pitch, with their position stats', () => {
    const players = Object.values(start().players)
    expect(players).toHaveLength(14)
    expect(players.filter((p) => p.team === 'home')).toHaveLength(7)
    expect(players.every((p) => p.hex === null && p.status === 'standing' && !p.activatedThisRound)).toBe(true)
    expect(start().players['home-black-orc-2']).toMatchObject({ team: 'home', position: 'black-orc', ma: 4, st: 4, ag: 8, to: 9 })
    expect(start().players['away-catcher-1']).toMatchObject({ team: 'away', position: 'catcher', ma: 8, st: 2, ag: 4, to: 7 })
  })

  it('sets up both teams with no score and a half of Momentum', () => {
    const { teams } = start()
    expect(teams.home).toEqual({ name: 'Orcs', score: 0, momentum: 2, usedThisRound: { blitz: 0, pass: 0, handOff: 0, foul: 0 } })
    expect(teams.away.name).toBe('Elves')
  })

  it('carries the config, its id and hash, and a seeded RNG', () => {
    const state = start()
    expect(state.config).toEqual(rulesV10)
    expect(state.configId).toBe('rules-v10')
    expect(state.configHash).toBe(ruleConfigHash(rulesV10))
    expect(state.rng).toEqual(seededRng(42))
  })

  it('refuses an invalid config', () => {
    const broken = { ...rulesV10, match: { ...rulesV10.match, halves: 0 } }
    expect(() => createMatch(broken, [orcs, elves], 1)).toThrow(RuleConfigError)
  })

  it('refuses a roster that cannot field a full team', () => {
    const short = { ...orcs, positions: { lineman: { ...orcs.positions.lineman!, max: 3 } } }
    expect(() => createMatch(rulesV10, [short, elves], 1)).toThrow(/fields 3 players but a team needs 7/)
  })

  it('survives a JSON round trip unchanged', () => {
    const state = start()
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it('offers no commands yet: the setup rules come later', () => {
    expect(legalCommands(start())).toEqual([])
  })
})
