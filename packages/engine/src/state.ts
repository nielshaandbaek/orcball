import type { RuleConfig } from './config'
import type { Modifier, RolledEvent } from './dice'
import type { Hex } from './hex'
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

export type PlayerStatus = 'standing' | 'prone' | 'stunned' | 'out' | 'casualty'

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
  /** True once the player has entered an enemy tackle zone without dodging. */
  stopped: boolean
  /** The hex the player just dodged into: leaving it costs no extra MA. */
  freeLeave: Hex | null
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
  /** Who took the first go this round; the next round starts with the other team. */
  firstGo: TeamId
  lastGoWasWait: boolean
  activation: Activation | null
  doubleActivation: DoubleActivation | null
  teams: Record<TeamId, TeamState>
  players: Record<string, Player>
  ball: { hex: Hex | null; carrier: string | null }
  pending: PendingDecision | null
}

export type Command =
  | { type: 'activate'; playerId: string; action: ActionType }
  | { type: 'wait' }
  | { type: 'endActivation' }
  /** One step to a neighbouring hex. `dodge` when stepping into an enemy tackle zone and rolling to keep going. */
  | { type: 'move'; to: Hex; dodge?: true }
  | { type: 'standUp' }
  | { type: 'decide'; choice: string }
  /** Spend Momentum on a double activation at the start of a go. Re-rolls are offered as decisions. */
  | { type: 'spendMomentum'; use: 'double' }

export type CommandType = Command['type']

export type GameEvent =
  | RolledEvent
  | { type: 'moved'; playerId: string; path: Hex[] }
  | { type: 'stoodUp'; playerId: string }
  | { type: 'winded'; playerId: string }
  | { type: 'knockedDown'; playerId: string }
  | { type: 'injured'; playerId: string; result: 'stunned' | 'out' | 'casualty' }
  | { type: 'phaseChanged'; from: Phase; to: Phase }
  | { type: 'activated'; playerId: string; action: ActionType }
  | { type: 'activationEnded'; playerId: string; failed: boolean }
  /** `forced` when the team had no players left to activate. */
  | { type: 'waited'; team: TeamId; forced: boolean }
  | { type: 'doubleActivationGained'; team: TeamId; source: 'failure' | 'momentum' }
  | { type: 'doubleActivationForfeited'; team: TeamId }
  | { type: 'momentumSpent'; team: TeamId; use: 'reroll' | 'double' }
  | { type: 'roundEnded'; half: number; round: number }

/** What the UI shows before a roll: target, each modifier by name, and the chance. */
export type RollPreview = {
  test: string
  target: number
  modifiers: Modifier[]
  chance: number
}

/** A command the UI can show: either legal, or greyed out with a one-line reason. */
export type CommandOption = { command: Command; available: true } | { command: Command; available: false; reason: string }
