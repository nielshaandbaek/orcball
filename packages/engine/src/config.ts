import { z } from 'zod'
import rulesV10Json from '../rules/rules-v10.json' with { type: 'json' }
import rulesV11Json from '../rules/rules-v11.json' with { type: 'json' }
import { canonicalJson } from './json'

// The rule config holds every tuning number from RULES.md, so a rule-number
// change is a config edit. Structural facts stay in code: the pitch shape is
// in hex.ts, and the D10 and D6 themselves (including natural 1 failing and
// natural 10 succeeding) are in dice.ts.

const count = z.int().min(0)
const positive = z.int().min(1)
const modifier = z.int()
const d10Face = z.int().min(1).max(10)
/** A D10 target number, e.g. 6 for "6+". */
const target = z.int().min(2).max(10)
const id = z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and dashes')

const PositionSchema = z.strictObject({
  name: z.string().min(1),
  /** How many of this position a team may field. */
  max: positive,
  ma: positive,
  st: positive,
  ag: target,
  to: target,
  skills: z.array(z.string().min(1)),
})

const RosterSchema = z.strictObject({
  name: z.string().min(1),
  positions: z.record(id, PositionSchema),
})

const PassBandSchema = z.strictObject({
  name: z.string().min(1),
  /** Longest pass in this band, in hexes. */
  maxRange: positive,
  modifier,
})

export const RuleConfigSchema = z
  .strictObject({
    id,
    match: z.strictObject({
      halves: positive,
      roundsPerHalf: positive,
      playersOnPitch: positive,
      /** Players a coach may activate in a double activation. */
      doubleActivationPlayers: positive,
    }),
    setup: z.strictObject({
      maxPlayersPerWideZone: count,
    }),
    kickOff: z.strictObject({
      /** Number of D6 for how far the kick scatters. Direction is always one D6. */
      scatterDistanceDice: positive,
    }),
    activations: z.strictObject({
      perRoundPerTeam: z.strictObject({
        blitz: count,
        pass: count,
        handOff: count,
        foul: count,
      }),
    }),
    momentum: z.strictObject({
      perHalf: count,
      maxPerRound: count,
    }),
    movement: z.strictObject({
      disengageCost: count,
      sprintBonus: count,
      /** Standing up costs MA divided by this, rounded up. */
      standUpMaDivisor: positive,
      /**
       * Dodge modifier per enemy tackle zone on the hex dodged into. With
       * 'stopOnEntering' the first zone is free (it's what makes the Dodge);
       * with 'dodgeOnLeaving' every zone on the target hex counts.
       */
      dodgeModifierPerExtraTackleZone: modifier,
      /**
       * Where tackle zones bite. 'stopOnEntering' (the default, v10): entering
       * one ends the move unless the player Dodges, and leaving one costs
       * disengageCost. 'dodgeOnLeaving' (v11): entering is free, and every
       * step out of one is a Dodge.
       */
      tackleZones: z.enum(['stopOnEntering', 'dodgeOnLeaving']).optional(),
      /**
       * A marked player as strong as each marker (ST + assists) may step 1
       * hex, as their whole move, to a hex outside enemy tackle zones, with no
       * roll.
       */
      strengthDisengage: z.boolean().optional(),
    }),
    blocking: z.strictObject({
      assistValue: count,
      blitzBlockCost: count,
      /** How much higher the attacker's total must be for a Shove to push into the crowd. */
      shoveCrowdPushMargin: count,
      /** A Shove is only offered when the attacker's total is at least the defender's. */
      shoveNeedsEqualStrength: z.boolean().optional(),
      tackleTarget: target,
      tackleModifierPerStrengthPoint: modifier,
    }),
    injury: z.strictObject({
      /** White die 1 to stunnedMax is Stunned, up to outMax is Out, the rest Casualty. */
      stunnedMax: d10Face,
      outMax: d10Face,
    }),
    fouls: z.strictObject({
      assistValue: count,
      /** Natural results on the red die that get the fouler ejected. */
      ejectOnNaturals: z.array(d10Face),
    }),
    ball: z.strictObject({
      pickUpCost: count,
      pickUpModifierPerTackleZone: modifier,
      catchModifierPerTackleZone: modifier,
      /** Shortest band first. A pass longer than the last band is out of range. */
      passBands: z.array(PassBandSchema).min(1),
      passModifierPerTackleZone: modifier,
      /** A natural 1, or a modified result at or below this, is a fumble. */
      fumbleAtOrBelow: z.int(),
      failedPassScatters: count,
      interceptionModifier: modifier,
      interceptionModifierPerTackleZone: modifier,
      bounceDistance: positive,
      /** Number of D6 for how far a throw-in travels. */
      throwInDistanceDice: positive,
    }),
    rosters: z.record(id, RosterSchema),
  })
  .superRefine((config, ctx) => {
    const { stunnedMax, outMax } = config.injury
    if (!(stunnedMax < outMax && outMax < 10)) {
      ctx.addIssue({
        code: 'custom',
        path: ['injury'],
        message: `bands must leave room for all three results: stunnedMax (${stunnedMax}) < outMax (${outMax}) < 10`,
      })
    }

    config.ball.passBands.forEach((band, i) => {
      const previous = config.ball.passBands[i - 1]
      if (previous && band.maxRange <= previous.maxRange) {
        ctx.addIssue({
          code: 'custom',
          path: ['ball', 'passBands', i, 'maxRange'],
          message: `must be longer than the band before it (${previous.maxRange})`,
        })
      }
    })

    if (Object.keys(config.rosters).length === 0) {
      ctx.addIssue({ code: 'custom', path: ['rosters'], message: 'needs at least one roster' })
    }
    for (const [rosterId, roster] of Object.entries(config.rosters)) {
      const fieldable = Object.values(roster.positions).reduce((sum, p) => sum + p.max, 0)
      if (fieldable < config.match.playersOnPitch) {
        ctx.addIssue({
          code: 'custom',
          path: ['rosters', rosterId, 'positions'],
          message: `can field only ${fieldable} players, but a team needs ${config.match.playersOnPitch}`,
        })
      }
    }
  })

export type RuleConfig = z.infer<typeof RuleConfigSchema>
export type Roster = RuleConfig['rosters'][string]
export type Position = Roster['positions'][string]

export class RuleConfigError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(`Invalid rule config:\n${problems.map((p) => `- ${p}`).join('\n')}`)
    this.name = 'RuleConfigError'
    this.problems = problems
  }
}

/** Validate a parsed JSON rule config. Throws a RuleConfigError naming every bad field. */
export function loadRuleConfig(input: unknown): RuleConfig {
  const result = RuleConfigSchema.safeParse(input)
  if (result.success) return result.data
  throw new RuleConfigError(
    result.error.issues.map((issue) => {
      const path = issue.path.map(String).join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    }),
  )
}

/**
 * A hash of the config's contents, stored in match logs so stats are never
 * mixed across rule versions. Key order doesn't affect it.
 */
export function ruleConfigHash(config: RuleConfig): string {
  return cyrb53(canonicalJson(config)).toString(16).padStart(14, '0')
}

// cyrb53: a fast 53-bit string hash. Not cryptographic; it only needs to tell
// configs apart.
function cyrb53(text: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** The rules v10 config shipped with the engine. */
export const rulesV10: RuleConfig = loadRuleConfig(rulesV10Json)

/** Rules v11: Dodge on leaving a tackle zone, Strength Disengage, no weak Shoves. */
export const rulesV11: RuleConfig = loadRuleConfig(rulesV11Json)
