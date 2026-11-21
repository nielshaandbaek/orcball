import { describe, expect, it } from 'vitest'
import { loadRuleConfig, RuleConfigError, ruleConfigHash, rulesV10, rulesV26, traitsFor } from './config'
import { legalCommands } from './index'
import { createMatch } from './match'
import { seededRng } from './rng'

const { orcs, elves } = rulesV10.rosters as Record<'orcs' | 'elves', (typeof rulesV10.rosters)[string]>
const start = () => createMatch(rulesV10, [orcs, elves], 42)

describe('createMatch', () => {
  it('starts in Setup with the coin toss winner choosing to kick or receive', () => {
    const state = start()
    expect(state.phase).toBe('Setup')
    expect(state.half).toBe(1)
    expect(state.round).toBe(0)
    expect(state.openingKicker).toBeNull()
    expect(state.ball).toEqual({ hex: null, carrier: null })
    expect(state.pending).toMatchObject({ kind: 'setup.coinToss', team: state.turnOwner })
    expect(legalCommands(state)).toEqual([
      { type: 'decide', choice: 'kick' },
      { type: 'decide', choice: 'receive' },
    ])
  })

  it('tosses the coin with the seeded RNG, so seeds decide it both ways', () => {
    const winners = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => createMatch(rulesV10, [orcs, elves], seed).pending!.team))
    expect(winners).toEqual(new Set(['home', 'away']))
    expect(createMatch(rulesV10, [orcs, elves], 42)).toEqual(start())
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
    expect(teams.home).toEqual({
      name: 'Orcs',
      score: 0,
      momentum: 2,
      momentumUsedThisRound: false,
      usedThisRound: { blitz: 0, pass: 0, handOff: 0, foul: 0 },
    })
    expect(teams.away.name).toBe('Elves')
  })

  it('carries the config, its id and hash, and a seeded RNG', () => {
    const state = start()
    expect(state.config).toEqual(rulesV10)
    expect(state.configId).toBe('rules-v10')
    expect(state.configHash).toBe(ruleConfigHash(rulesV10))
    // One die used for the coin toss.
    expect(state.rng).not.toEqual(seededRng(42))
    expect(state.rng.kind).toBe('seeded')
  })

  it('gives a team trait to every position it doesn\'t skip (#211, #231)', () => {
    // The plain form goes to everyone; the object form skips the positions it names.
    const config = loadRuleConfig({
      ...JSON.parse(JSON.stringify(rulesV26)),
      rosters: { ...rulesV26.rosters, orcs: { ...rulesV26.rosters.orcs!, traits: ['Thick Skull', { skill: 'Regeneration', except: ['thrower'] }] } },
    })
    const orcRoster = config.rosters.orcs!
    expect(traitsFor(orcRoster, 'lineman')).toEqual(['Thick Skull', 'Regeneration'])
    expect(traitsFor(orcRoster, 'thrower')).toEqual(['Thick Skull'])
    const state = createMatch(config, [orcRoster, config.rosters.elves!], 1)
    expect(state.players['home-lineman-1']!.skills).toEqual(['Brace', 'Thick Skull', 'Regeneration'])
    expect(state.players['home-thrower-1']!.skills).toEqual(['Sure Hands', 'Thick Skull'])
    expect(state.players['away-lineman-1']!.skills).toEqual(['Brace'])
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

})
