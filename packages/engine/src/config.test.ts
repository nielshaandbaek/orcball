import { describe, expect, it } from 'vitest'
import rulesV10Json from '../rules/rules-v10.json' with { type: 'json' }
import { loadRuleConfig, RuleConfigError, ruleConfigHash, rulesV10 } from './config'

// A fresh, mutable copy of the shipped JSON for each test.
const raw = (): Record<string, any> => JSON.parse(JSON.stringify(rulesV10Json))

function problemsOf(input: unknown): string[] {
  try {
    loadRuleConfig(input)
  } catch (e) {
    if (e instanceof RuleConfigError) return e.problems
    throw e
  }
  throw new Error('expected the config to be rejected')
}

describe('rules-v10.json', () => {
  it('is a valid config', () => {
    expect(rulesV10.id).toBe('rules-v10')
  })

  it('matches the numbers in RULES.md', () => {
    const c = rulesV10
    // §1 Basics and §3 Rounds & Activations
    expect(c.match).toEqual({ halves: 2, roundsPerHalf: 4, playersOnPitch: 7, doubleActivationPlayers: 2 })
    expect(c.activations.perRoundPerTeam).toEqual({ blitz: 1, pass: 1, handOff: 1, foul: 1 })
    // §2 Setup & Kick-Off
    expect(c.setup.maxPlayersPerWideZone).toBe(1)
    expect(c.kickOff.scatterDistanceDice).toBe(1)
    // §4 Movement
    expect(c.movement).toEqual({
      disengageCost: 1,
      sprintBonus: 2,
      standUpMaDivisor: 2,
      dodgeModifierPerExtraTackleZone: -1,
    })
    // §5 Blocking
    expect(c.blocking).toEqual({
      assistValue: 1,
      blitzBlockCost: 1,
      shoveCrowdPushMargin: 2,
      tackleTarget: 6,
      tackleModifierPerStrengthPoint: 1,
    })
    // §6 Injuries: 1–7 Stunned, 8–9 Out, 10 Casualty
    expect(c.injury).toEqual({ stunnedMax: 7, outMax: 9 })
    // §7 Ball Handling
    expect(c.ball.pickUpCost).toBe(1)
    expect(c.ball.pickUpModifierPerTackleZone).toBe(-1)
    expect(c.ball.catchModifierPerTackleZone).toBe(-1)
    expect(c.ball.passBands.map((b) => [b.name, b.maxRange, b.modifier])).toEqual([
      ['Quick', 3, 0],
      ['Short', 6, -1],
      ['Long', 9, -2],
      ['Long Bomb', 12, -3],
    ])
    expect(c.ball.passModifierPerTackleZone).toBe(-1)
    expect(c.ball.fumbleAtOrBelow).toBe(1)
    expect(c.ball.failedPassScatters).toBe(3)
    expect(c.ball.interceptionModifier).toBe(-3)
    expect(c.ball.interceptionModifierPerTackleZone).toBe(-1)
    expect(c.ball.bounceDistance).toBe(1)
    expect(c.ball.throwInDistanceDice).toBe(2)
    // §8 Fouls
    expect(c.fouls).toEqual({ assistValue: 1, ejectOnNaturals: [1, 10] })
    // §9 Momentum
    expect(c.momentum).toEqual({ perHalf: 2, maxPerRound: 1 })
  })

  it('has the agreed Orc and Elf starter rosters, 7 players each', () => {
    const table = (rosterId: string) =>
      Object.entries(rulesV10.rosters[rosterId]!.positions).map(([id, p]) => [id, p.max, p.ma, p.st, p.ag, p.to])
    // [position, fielded, MA, ST, AG, TO]
    expect(table('orcs')).toEqual([
      ['black-orc', 2, 4, 4, 8, 9],
      ['blitzer', 2, 6, 3, 6, 9],
      ['thrower', 1, 5, 3, 6, 8],
      ['lineman', 2, 5, 3, 6, 9],
    ])
    expect(table('elves')).toEqual([
      ['wardancer', 2, 8, 3, 4, 7],
      ['catcher', 2, 8, 2, 4, 7],
      ['thrower', 1, 7, 3, 4, 7],
      ['lineman', 2, 7, 3, 4, 7],
    ])
    for (const roster of Object.values(rulesV10.rosters)) {
      const fielded = Object.values(roster.positions).reduce((sum, p) => sum + p.max, 0)
      expect(fielded).toBe(rulesV10.match.playersOnPitch)
      // Skills are P1; none until the engine supports them.
      for (const p of Object.values(roster.positions)) expect(p.skills).toEqual([])
    }
  })
})

describe('loadRuleConfig', () => {
  it('names the field with the wrong type', () => {
    const c = raw()
    c.movement.sprintBonus = 'two'
    expect(problemsOf(c)).toEqual([expect.stringMatching(/^movement\.sprintBonus: /)])
  })

  it('names a missing field', () => {
    const c = raw()
    delete c.momentum.perHalf
    expect(problemsOf(c)).toEqual([expect.stringMatching(/^momentum\.perHalf: /)])
  })

  it('rejects unknown fields, so typos get caught', () => {
    const c = raw()
    c.movement.sprintBonnus = 3
    expect(problemsOf(c)).toEqual([expect.stringMatching(/^movement: .*sprintBonnus/)])
  })

  it('names fields deep inside a roster', () => {
    const c = raw()
    c.rosters.orcs.positions.lineman.ag = 12
    expect(problemsOf(c)).toEqual([expect.stringMatching(/^rosters\.orcs\.positions\.lineman\.ag: /)])
  })

  it('rejects injury bands that leave no room for a result', () => {
    const c = raw()
    c.injury.outMax = 10
    expect(problemsOf(c)).toEqual([expect.stringMatching(/^injury: .*outMax \(10\) < 10/)])
  })

  it('rejects pass bands that are not in order', () => {
    const c = raw()
    c.ball.passBands[2].maxRange = 5
    expect(problemsOf(c)).toEqual([expect.stringMatching(/^ball\.passBands\.2\.maxRange: /)])
  })

  it('rejects a roster that cannot field a full team', () => {
    const c = raw()
    c.rosters.orcs.positions.lineman.max = 1
    expect(problemsOf(c)).toEqual([expect.stringMatching(/^rosters\.orcs\.positions: .*only 6 players/)])
  })

  it('reports every problem at once', () => {
    const c = raw()
    c.match.halves = 0
    c.ball.bounceDistance = -1
    expect(problemsOf(c)).toHaveLength(2)
  })

  it('puts the problems in the error message', () => {
    const c = raw()
    c.match.halves = 0
    expect(() => loadRuleConfig(c)).toThrow(/Invalid rule config:\n- match\.halves: /)
  })
})

describe('ruleConfigHash', () => {
  const hash = (c: unknown) => ruleConfigHash(loadRuleConfig(c))

  it('is the same for the same contents', () => {
    expect(hash(raw())).toBe(hash(raw()))
    expect(hash(raw())).toMatch(/^[0-9a-f]{14}$/)
  })

  it('ignores key order', () => {
    const c = raw()
    const reversed = Object.fromEntries(Object.entries(c).reverse())
    reversed.movement = Object.fromEntries(Object.entries(c.movement).reverse())
    expect(hash(reversed)).toBe(hash(c))
  })

  it('changes when any value changes', () => {
    const base = hash(raw())
    // Walk every leaf value in the config and nudge it.
    const leaves: (string | number)[][] = []
    const walk = (value: unknown, path: (string | number)[]) => {
      if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, [...path, Array.isArray(value) ? Number(k) : k])
      } else leaves.push(path)
    }
    walk(raw(), [])
    expect(leaves.length).toBeGreaterThan(40)

    // Change one leaf to a value that is still valid: a string gets a suffix,
    // a number goes up by 1, or down by 1 if up would be invalid.
    const nudged = (path: (string | number)[]): string => {
      const candidates = (value: unknown): unknown[] =>
        typeof value === 'string' ? [path[0] === 'id' ? `${value}-x` : `${value} x`] : [Number(value) + 1, Number(value) - 1]
      let original: any = raw()
      for (const key of path) original = original[key]
      for (const candidate of candidates(original)) {
        const c = raw()
        let parent: any = c
        for (const key of path.slice(0, -1)) parent = parent[key]
        parent[path.at(-1)!] = candidate
        try {
          return hash(c)
        } catch {
          // Try the next candidate.
        }
      }
      throw new Error(`no valid change found for ${path.join('.')}`)
    }
    for (const path of leaves) expect(nudged(path), `changing ${path.join('.')}`).not.toBe(base)
  })
})
