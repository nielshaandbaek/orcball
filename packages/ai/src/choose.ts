import type { Command, TeamId } from '@orcball/engine'
import { defaultWeights } from './evaluate'
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
}

/** The command, its reason for the log, and a key shared by the commands of one plan (see novice.ts). */
export type AiChoice = { command: Command; reason: string; plan?: string }

export function chooseCommand(view: AiView, me: TeamId, options: AiOptions): AiChoice {
  if (actingTeam(view) !== me) throw new Error(`chooseCommand: it is ${actingTeam(view)}'s move, not ${me}'s`)
  if (options.level === 'novice') return chooseNovice(view, me, defaultWeights, options.budgetMs)
  return chooseDeep(view, me, options.level, defaultWeights, options.budgetMs)
}
