import type { RuleConfig } from './config'
import type { Modifier, RolledEvent } from './dice'
import type { Hex, Side } from './hex'
import type { Json } from './json'
import type { RngState } from './rng'

// The whole match lives in one GameState: plain data that survives a JSON
// round trip. It carries its own rule config, so a state is all a replay,
// a test or a future server needs.

export type TeamId = 'home' | 'away'

export const TEAMS: readonly TeamId[] = ['home', 'away']

export function otherTeam(team: TeamId): TeamId {
  return team === 'home' ? 'away' : 'home'
}

/**
 * The end each team defends. Home sets up in the left half and scores in the
 * right end zone; away the other way round. Teams keep their ends all match.
 */
export const TEAM_SIDES: Record<TeamId, Side> = { home: 'left', away: 'right' }

/** 'stunned' is face down. 'out' is off for the drive, 'casualty' and 'ejected' for the match. */
export type PlayerStatus = 'standing' | 'prone' | 'stunned' | 'out' | 'casualty' | 'ejected'

export type Player = {
  id: string
  team: TeamId
  /** Position id within the team's roster, e.g. 'blitzer'. */
  position: string
  ma: number
  st: number
  /** AG as a D10 target, e.g. 6 for 6+. */
  ag: number
  to: number
  skills: string[]
  /** null = off the pitch. */
  hex: Hex | null
  status: PlayerStatus
  activatedThisRound: boolean
  winded: boolean
}

export type ActionType = 'move' | 'block' | 'blitz' | 'pass' | 'handOff' | 'foul'

/** Actions a team has used this round, for the once-per-round limits. */
export type UsedLimits = { blitz: number; pass: number; handOff: number; foul: number }

export type TeamState = {
  /** Roster name, e.g. 'Orcs'. */
  name: string
  score: number
  /** Momentum tokens left this half. */
  momentum: number
  /** At most one Momentum token per round. */
  momentumUsedThisRound: boolean
  usedThisRound: UsedLimits
}

/** The player whose activation is under way, the action they declared, and how far they've moved. */
export type Activation = {
  playerId: string
  action: ActionType
  /** MA spent so far, including standing up and Disengages. */
  maUsed: number
  /** True once the player can't move any further: entered an enemy tackle zone without dodging, or Strength Disengaged. */
  stopped: boolean
  /** True once the player has taken a step this activation. */
  moved: boolean
  /** The hex the player just dodged into: leaving it costs no extra MA. */
  freeLeave: Hex | null
  /** True once the player has made their block (Block and Blitz allow one). */
  blocked: boolean
}

/**
 * A double activation the team will take on its next go, or is taking now.
 * `left` counts down from 2 as the team activates players.
 */
export type DoubleActivation = { team: TeamId; left: number }

export type Phase = 'Setup' | 'KickOff' | 'Round' | 'Activation' | 'Touchdown' | 'HalfTime' | 'FullTime'

/** One option for a pending decision, e.g. 'dodge' or a push hex. */
export type DecisionChoice = {
  id: string
  label: string
  hex?: Hex
}

/**
 * A choice the rules need before the engine can go on. While one is pending,
 * the only legal commands are its answers.
 */
export type PendingDecision = {
  /** Which rule asked, e.g. 'dodgeOrStop'. Each rule module owns its kinds. */
  kind: string
  /** The coach who answers. */
  team: TeamId
  prompt: string
  choices: DecisionChoice[]
  /** Whatever the asking rule needs to carry on once it has the answer. */
  data: Json
}

export type GameState = {
  configId: string
  configHash: string
  config: RuleConfig
  rng: RngState
  phase: Phase
  half: number
  /** 0 before the first kick-off of a half. */
  round: number
  /** Whose go it is (or who is setting up). */
  turnOwner: TeamId
  /** The team that kicks off this drive; it also sets up first. */
  kickingTeam: TeamId
  /** The team that kicked off the first half, once the coin toss is settled. The other kicks off the second. */
  openingKicker: TeamId | null
  /** Who took the first go this round; the next round starts with the other team. */
  firstGo: TeamId
  lastGoWasWait: boolean
  activation: Activation | null
  doubleActivation: DoubleActivation | null
  teams: Record<TeamId, TeamState>
  players: Record<string, Player>
  ball: { hex: Hex | null; carrier: string | null }
  pending: PendingDecision | null
  /** Set at full time: the team with more touchdowns, or 'draw'. */
  winner: TeamId | 'draw' | null
}

export type Command =
  | { type: 'activate'; playerId: string; action: ActionType }
  | { type: 'wait' }
  | { type: 'endActivation' }
  /**
   * One step to a neighbouring hex. `dodge` when the step rolls a Dodge (into
   * an enemy tackle zone in v10, out of one in v11); `disengage` for a
   * Strength Disengage (v11).
   */
  | { type: 'move'; to: Hex; dodge?: true; disengage?: true }
  | { type: 'standUp' }
  | { type: 'place'; playerId: string; hex: Hex }
  | { type: 'unplace'; playerId: string }
  | { type: 'endSetup' }
  | { type: 'foul'; targetId: string }
  | { type: 'block'; targetId: string }
  | { type: 'pass'; target: Hex }
  | { type: 'handOff'; targetId: string }
  | { type: 'kick'; hex: Hex }
  | { type: 'decide'; choice: string }
  /** Spend Momentum on a double activation at the start of a go. Re-rolls are offered as decisions. */
  | { type: 'spendMomentum'; use: 'double' }

export type CommandType = Command['type']

export type InjuryResult = 'stunned' | 'out' | 'casualty'

/** How the ball got from one hex to the next. */
export type BallMove = 'scatter' | 'bounce' | 'throwIn' | 'kick' | 'pass'

export type GameEvent =
  | RolledEvent
  | { type: 'moved'; playerId: string; path: Hex[] }
  /** A Strength Disengage: one step out of the tackle zones, no roll, then no more moving. */
  | { type: 'disengaged'; playerId: string; to: Hex }
  | { type: 'stoodUp'; playerId: string }
  | { type: 'winded'; playerId: string }
  | { type: 'knockedDown'; playerId: string }
  | { type: 'injured'; playerId: string; result: InjuryResult }
  /** Red and white D10s thrown together; the white die only counts if the armour broke. */
  | { type: 'armourRolled'; playerId: string; red: number; white: number; modifiers: Modifier[]; broken: boolean }
  /** Pushed into the crowd: only the white die, armour counts as broken. */
  | { type: 'injuryRolled'; playerId: string; white: number }
  | { type: 'turnedFaceUp'; playerId: string }
  | { type: 'fouled'; playerId: string; targetId: string }
  /** Both Strength totals, ST plus assists, shown before the coach picks Shove or Tackle. */
  | { type: 'blockDeclared'; attackerId: string; defenderId: string; attack: number; defence: number }
  | { type: 'blockChosen'; attackerId: string; choice: 'shove' | 'tackle' }
  /** `to` is null for a push into the crowd. */
  | { type: 'pushed'; playerId: string; from: Hex; to: Hex | null }
  | { type: 'followedUp'; playerId: string; to: Hex }
  | { type: 'pickedUp'; playerId: string }
  /** The coach chose not to catch a loose ball landing on this player (v11); it bounces on. */
  | { type: 'catchDeclined'; playerId: string }
  | { type: 'passed'; playerId: string; target: Hex }
  | { type: 'fumbled'; playerId: string }
  | { type: 'intercepted'; playerId: string }
  | { type: 'handedOff'; playerId: string; toId: string }
  | { type: 'touchdown'; playerId: string; team: TeamId }
  /** The drive is over: everyone off the pitch, ready to set up again. */
  | { type: 'driveEnded'; kickingTeam: TeamId }
  | { type: 'halfEnded'; half: number }
  | { type: 'matchEnded'; score: Record<TeamId, number>; winner: TeamId | 'draw' }
  | { type: 'ejected'; playerId: string }
  /** A crowd-pushed player who wasn't hurt: into the reserves until the next kick-off. */
  | { type: 'toReserves'; playerId: string }
  | { type: 'phaseChanged'; from: Phase; to: Phase }
  | { type: 'activated'; playerId: string; action: ActionType }
  | { type: 'activationEnded'; playerId: string; failed: boolean }
  /** `forced` when the team had no players left to activate. */
  | { type: 'waited'; team: TeamId; forced: boolean }
  | { type: 'doubleActivationGained'; team: TeamId; source: 'failure' | 'momentum' }
  | { type: 'doubleActivationForfeited'; team: TeamId }
  | { type: 'momentumSpent'; team: TeamId; use: 'reroll' | 'double' }
  /** `firstGo` is the team with the initiative: the first activation of the round. */
  | { type: 'roundStarted'; half: number; round: number; firstGo: TeamId }
  | { type: 'roundEnded'; half: number; round: number }
  | { type: 'ballMoved'; from: Hex; to: Hex; how: BallMove }
  /** The ball left the pitch; it comes back in from `lastHex`. */
  | { type: 'ballOut'; lastHex: Hex }
  | { type: 'ballCaught'; playerId: string }
  | { type: 'ballSettled'; hex: Hex }
  | { type: 'coinTossChoice'; team: TeamId; choice: 'kick' | 'receive' }
  | { type: 'placed'; playerId: string; hex: Hex }
  | { type: 'unplaced'; playerId: string }
  | { type: 'setupEnded'; team: TeamId }
  | { type: 'kicked'; team: TeamId; hex: Hex }
  | { type: 'touchback'; team: TeamId }
  | { type: 'ballGiven'; playerId: string }

/** What the UI shows before a roll: target, each modifier by name, and the chance. */
export type RollPreview = {
  test: string
  target: number
  modifiers: Modifier[]
  chance: number
}

/** A command the UI can show: either legal, or greyed out with a one-line reason. */
export type CommandOption = { command: Command; available: true } | { command: Command; available: false; reason: string }
