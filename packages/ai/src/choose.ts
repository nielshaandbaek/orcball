import type { Command, TeamId } from '@orcball/engine'
import { defaultWeights, type Weights } from './evaluate'
import { chooseDeep } from './deep'
import { chooseNovice } from './novice'
import { actingTeam, type AiView } from './view'

// The computer's entry point: given what it can see, pick its next command.

export type AiLevel = 'novice' | 'intermediate' | 'expert'

export type AiOptions = {
  level: AiLevel
  /** Most time to think, in milliseconds. */
  budgetMs: number
  /** For tie-breaks and sampled dice: the same view, level and seed give the same command. */
  seed: number
  /** The evaluation's weights; the default file unless given (for tuning and comparing weights). */
  weights?: Weights
}

/** The command, its reason for the log, and a key shared by the commands of one plan (see novice.ts). */
export type AiChoice = { command: Command; reason: string; plan?: string }

export function chooseCommand(view: AiView, me: TeamId, options: AiOptions): AiChoice {
  if (actingTeam(view) !== me) throw new Error(`chooseCommand: it is ${actingTeam(view)}'s move, not ${me}'s`)
  const weights = options.weights ?? defaultWeights
  if (options.level === 'novice') return chooseNovice(view, me, weights, options.budgetMs)
  return chooseDeep(view, me, options.level, weights, options.budgetMs)
}
