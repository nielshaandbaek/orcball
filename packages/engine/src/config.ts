import { z } from 'zod'
import rulesV10Json from '../rules/rules-v10.json' with { type: 'json' }
import rulesV11Json from '../rules/rules-v11.json' with { type: 'json' }
import rulesV12Json from '../rules/rules-v12.json' with { type: 'json' }
import rulesV13Json from '../rules/rules-v13.json' with { type: 'json' }
import rulesV14Json from '../rules/rules-v14.json' with { type: 'json' }
import rulesV15Json from '../rules/rules-v15.json' with { type: 'json' }
import rulesV16Json from '../rules/rules-v16.json' with { type: 'json' }
import rulesV17Json from '../rules/rules-v17.json' with { type: 'json' }
import rulesV18Json from '../rules/rules-v18.json' with { type: 'json' }
import rulesV19Json from '../rules/rules-v19.json' with { type: 'json' }
import rulesV20Json from '../rules/rules-v20.json' with { type: 'json' }
import rulesV21Json from '../rules/rules-v21.json' with { type: 'json' }
import rulesV22Json from '../rules/rules-v22.json' with { type: 'json' }
import rulesV23Json from '../rules/rules-v23.json' with { type: 'json' }
import rulesV24Json from '../rules/rules-v24.json' with { type: 'json' }
import rulesV25Json from '../rules/rules-v25.json' with { type: 'json' }
import rulesV26Json from '../rules/rules-v26.json' with { type: 'json' }
import rulesV27Json from '../rules/rules-v27.json' with { type: 'json' }
import rulesV28Json from '../rules/rules-v28.json' with { type: 'json' }
import rulesV29Json from '../rules/rules-v29.json' with { type: 'json' }
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

/** Skills the engine knows. A position naming any other skill fails validation. */
export const SKILLS = ['Block', 'Brace', 'Dodge', 'Catch', 'Guard', 'Pass', 'Leap', 'Crushing Blow', 'Sure Hands', 'Thick Skull', 'Tackle', 'Frenzy', 'Strip Ball', 'Dump-Off', 'Regeneration'] as const
export type Skill = (typeof SKILLS)[number]

const PositionSchema = z.strictObject({
  name: z.string().min(1),
  /** How many of this position a team may field. */
  max: positive,
  ma: positive,
  st: positive,
  ag: target,
  to: target,
  skills: z.array(z.enum(SKILLS)),
})

const RosterSchema = z.strictObject({
  name: z.string().min(1),
  positions: z.record(id, PositionSchema),
  /**
   * Skills every player of the team has, on top of his position's one skill:
   * a team trait, such as the Dwarves' Thick Skull (v26, #211). Left out, none.
   * A trait can skip positions (#231): `{ "skill": "Regeneration", "except": ["ghoul"] }`.
   */
  traits: z.array(z.union([z.enum(SKILLS), z.strictObject({ skill: z.enum(SKILLS), except: z.array(id) })])).optional(),
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
      /**
       * A touchdown ends the half, not just the drive, so each half is one
       * drive (v23, #194). Left out, the half goes on with a new kick-off.
       */
      touchdownEndsHalf: z.boolean().optional(),
      /**
       * No coin toss: the home team receives the first half and the away
       * team the second (v23, #194). Left out, the toss winner chooses.
       */
      homeReceivesFirst: z.boolean().optional(),
    }),
    setup: z.strictObject({
      maxPlayersPerWideZone: count,
      /**
       * A team must set up 7 players, or every player it has available if
       * fewer, before it can end setup (v26, #200). Left out, one is enough.
       */
      fieldAllAvailable: z.boolean().optional(),
    }),
    kickOff: z.strictObject({
      /** Number of D6 for how far the kick scatters. Direction is always one D6. */
      scatterDistanceDice: positive,
      /** Add the distance dice ('sum', the default, v10) or keep the lowest ('lowest', v11). */
      scatterDistanceKeep: z.enum(['sum', 'lowest']).optional(),
    }),
    activations: z.strictObject({
      perRoundPerTeam: z.strictObject({
        blitz: count,
        pass: count,
        handOff: count,
        foul: count,
      }),
      /**
       * An activation can't end before the player has done something (a step,
       * standing up, turning face up, a block, pass, hand-off or foul), and
       * Waiting instead of the second activation of a double counts as a Wait
       * (v16, #103). Left out, an activation may end with nothing done.
       */
      noEmptyActivation: z.boolean().optional(),
      /** Until the player has done something, his coach may cancel the activation (v16, #121). */
      cancelBeforeActing: z.boolean().optional(),
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
      /** A modifier on every Dodge before tackle zones are counted (v12: +1, so AG 6+ dodges on 5+). Left out, none. */
      dodgeBonus: modifier.optional(),
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
      /** A Strength Disengage only in a Move action, not a Blitz, Pass, Hand-off or Foul (v21, #181). Left out, in any of them. */
      strengthDisengageMoveOnly: z.boolean().optional(),
    }),
    blocking: z.strictObject({
      /** Only a standing player may take a Block action; a player who is down can still Blitz, standing up first (v12). Left out, anyone may. */
      blockNeedsStanding: z.boolean().optional(),
      assistValue: count,
      blitzBlockCost: count,
      /** How much higher the attacker's total must be for a Shove to push into the crowd. */
      shoveCrowdPushMargin: count,
      /** A Shove is only offered when the attacker's total is at least the defender's. */
      shoveNeedsEqualStrength: z.boolean().optional(),
      /**
       * Whether a missed Tackle (not a natural 1) counts as a failure: it ends
       * the activation and gives the opponent a double activation. Left out,
       * it does (v10). When false, nothing happens: a Block is over, and a
       * Blitzer may keep moving.
       */
      missedTackleIsFailure: z.boolean().optional(),
      /**
       * On a missed Tackle that isn't a natural 1, the defending coach chooses:
       * both down (a failure for the attacker) or nothing happens (v12). Only
       * used when missedTackleIsFailure is false.
       */
      missedTackleChoice: z.boolean().optional(),
      /**
       * The Block skill counts on a Tackle whatever the assists (v13). Left
       * out, it only counts when its side has no assists (v12).
       */
      blockSkillWithAssists: z.boolean().optional(),
      /**
       * The Block skill only helps the attacker: a blocked defender with
       * Block no longer gives −1 to the Tackle (v23, #191). Left out, it
       * counts both ways.
       */
      blockSkillAttackOnly: z.boolean().optional(),
      /**
       * Ask about the follow-up straight after the push, before the knock-down,
       * injuries and the ball are dealt with (v11). Left out, the follow-up
       * comes last (v10).
       */
      followUpBeforeBall: z.boolean().optional(),
      tackleTarget: target,
      tackleModifierPerStrengthPoint: modifier,
    }),
    injury: z.strictObject({
      /** White die 1 to stunnedMax is Stunned, up to outMax is Out, the rest Casualty. */
      stunnedMax: d10Face,
      outMax: d10Face,
      /**
       * A player off the pitch for the drive (Out, or Stunned in the crowd)
       * comes back at the start of the round this many after the one he went
       * off in, placed by his coach in his own end zone (v21, #177). Left
       * out, only at the next kick-off.
       */
      outReturnsAfterRounds: z.number().int().min(1).optional(),
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
      /**
       * A loose ball landing on a standing player (anything but an accurate
       * pass or hand-off) lets that player's coach choose to catch or let it
       * bounce on (v11). Left out, the player always tries (v10).
       */
      catchIsOptional: z.boolean().optional(),
      /** A natural 10 on a pass is accurate however much is against it, never a fumble (v15). Left out, the modified result can still make it a fumble. */
      naturalTenAlwaysPasses: z.boolean().optional(),
      /**
       * A catch the active team drops isn't a failure if a player of the active
       * team ends the ball's bounces holding it (v20). Left out, any drop by the
       * active team is a failure. A failed pick-up or a fumble is a failure either way.
       */
      dropForgivenIfCaught: z.boolean().optional(),
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

/** Rules v12: v11 plus the defender's choice on a missed Tackle, and the Block and Brace skills. */
export const rulesV12: RuleConfig = loadRuleConfig(rulesV12Json)

/** Rules v13: v12 with the Block skill counting on assisted Tackles too. */
export const rulesV13: RuleConfig = loadRuleConfig(rulesV13Json)

/** Rules v14: v13 with one Wardancer fewer and one Lineman more on the Elves' roster. */
export const rulesV14: RuleConfig = loadRuleConfig(rulesV14Json)

/** Rules v15: v14 with a natural 10 always passing, Sprint +1 MA instead of +2, and every Elf 1 MA slower. */
export const rulesV15: RuleConfig = loadRuleConfig(rulesV15Json)

/**
 * Rules v16: v15 with the Dodge, Catch and Guard skills (the Elf Catchers get
 * Dodge and Catch), no empty activations, and Cancel before the player acts.
 */
export const rulesV16: RuleConfig = loadRuleConfig(rulesV16Json)

/** Rules v17: v16 with the Pass skill (+1 on pass rolls) for both Throwers. */
export const rulesV17: RuleConfig = loadRuleConfig(rulesV17Json)

/** Rules v18: v17 with the Black Orc renamed Brute and the Wardancer renamed Dancer, ids too (#141). */
export const rulesV18: RuleConfig = loadRuleConfig(rulesV18Json)

/**
 * Rules v19: v18 with one skill per position. The Brute gets Guard (#153); the
 * Dancer gets Leap in place of Block, and the Catchers keep Catch only, dropping Dodge (#154).
 */
export const rulesV19: RuleConfig = loadRuleConfig(rulesV19Json)

/**
 * Rules v20: v19 played as one run of 8 rounds with 3 Momentum for the match
 * (#135), and a dropped catch forgiven when the active team ends up with the ball (#162).
 */
export const rulesV20: RuleConfig = loadRuleConfig(rulesV20Json)

/**
 * Rules v21: v20 with Out players back after two rounds (#177) and a Strength
 * Disengage only in a Move action (#181).
 */
export const rulesV21: RuleConfig = loadRuleConfig(rulesV21Json)

/** Rules v22: v21 with Crushing Blow in place of Guard for the Orc Brute (#184). */
export const rulesV22: RuleConfig = loadRuleConfig(rulesV22Json)

/**
 * Rules v23: v22 as two fixed drives of up to 6 rounds, one on offence for
 * each team: the home team receives first, a touchdown ends the drive, 2
 * Momentum per drive, and Out players back only for the next drive (#194).
 */
export const rulesV23: RuleConfig = loadRuleConfig(rulesV23Json)

/** Rules v24: v23 with a third team, the Humans (#192). */
export const rulesV24: RuleConfig = loadRuleConfig(rulesV24Json)

/**
 * Rules v25: v24 with slower Orcs (#196): 1 MA less for the Brute, Blitzer and
 * Lineman, AG 7+ for the Brute, and the Thrower is a Runner with Sure Hands
 * (+1 on pick-ups) in place of Pass. Every Human position has AG 5+ (#192).
 */
export const rulesV25: RuleConfig = loadRuleConfig(rulesV25Json)

/**
 * Rules v26: v25 with a fourth team, the Dwarves (#211): Tackle, Block, Sure
 * Hands and Frenzy, and Thick Skull as a team trait. A team must field 7
 * players at setup, or all it has available (#200).
 */
export const rulesV26: RuleConfig = loadRuleConfig(rulesV26Json)

/**
 * Rules v27: v26 with a fifth team, the Drow (#224): Linemen (Brace),
 * Blitzers (Strip Ball), a Runner (Dump-Off) and Witches (Frenzy).
 */
export const rulesV27: RuleConfig = loadRuleConfig(rulesV27Json)

/**
 * Rules v28: v27 with a sixth team, the Undead (#229): Skeletons (Brace),
 * Ghouls (Dodge), Wights (Block) and a Mummy (Crushing Blow), and
 * Regeneration for all but the Ghouls as a team trait (#231).
 */
export const rulesV28: RuleConfig = loadRuleConfig(rulesV28Json)

/** Rules v29: v28 with nimbler Dwarf Blockers, AG 7+ instead of 8+. */
export const rulesV29: RuleConfig = loadRuleConfig(rulesV29Json)

/**
 * Position ids renamed in v18, old to new. Older rules versions still use the
 * old ids; anything keyed by position (icons, AI formations) looks them up by
 * the new id through `currentPositionId`.
 */
export const RENAMED_POSITIONS: Readonly<Record<string, string>> = { 'black-orc': 'brute', wardancer: 'dancer' }

/** A position id under its newest name: 'black-orc' is 'brute'. */
export function currentPositionId(position: string): string {
  return RENAMED_POSITIONS[position] ?? position
}

/** The team traits a player of this position has (#211, #231). */
export function traitsFor(roster: Roster, positionId: string): Skill[] {
  return (roster.traits ?? []).flatMap((t) => (typeof t === 'string' ? [t] : t.except.includes(positionId) ? [] : [t.skill]))
}
