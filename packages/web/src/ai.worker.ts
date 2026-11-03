import { type AiLevel, type AiView, chooseCommand } from '@orcball/ai'
import type { Command, TeamId } from '@orcball/engine'

// The computer thinks here, off the page's thread, so the board stays
// responsive. It gets the match state without the dice generator (viewOf),
// so it can't see future rolls.

export type ComputerRequest = { id: number; view: AiView; team: TeamId; level: AiLevel; budgetMs: number; seed: number }
export type ComputerReply = { id: number; command: Command; reason: string } | { id: number; error: string }

self.onmessage = (event: MessageEvent<ComputerRequest>) => {
  const { id, view, team, level, budgetMs, seed } = event.data
  try {
    const { command, reason } = chooseCommand(view, team, { level, budgetMs, seed })
    self.postMessage({ id, command, reason } satisfies ComputerReply)
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message } satisfies ComputerReply)
  }
}
