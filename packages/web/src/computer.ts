import { type AiLevel, viewOf } from '@orcball/ai'
import type { Command, GameState, TeamId } from '@orcball/engine'
import type { ComputerReply, ComputerRequest } from './ai.worker'

// The page's side of the computer opponent: ask the worker for the next
// command. The worker is started as soon as this module loads, so its script
// is fetched (and cached by the service worker for offline play) before the
// first match against the computer.

/** The command, its reason, and a key shared by the commands of one plan. */
export type ComputerChoice = { command: Command; reason: string; plan?: string }

/** The most the computer may think per command. */
const BUDGET_MS = 10_000

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, { resolve: (c: ComputerChoice) => void; reject: (e: Error) => void }>()

function start(): Worker | null {
  if (worker || typeof Worker === 'undefined') return worker
  worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<ComputerReply>) => {
    const reply = event.data
    const pending = waiting.get(reply.id)
    if (!pending) return
    waiting.delete(reply.id)
    if ('error' in reply) pending.reject(new Error(reply.error))
    else pending.resolve(reply.plan === undefined ? { command: reply.command, reason: reply.reason } : { command: reply.command, reason: reply.reason, plan: reply.plan })
  }
  worker.onerror = (event) => {
    for (const p of waiting.values()) p.reject(new Error(event.message || 'The computer stopped working'))
    waiting.clear()
  }
  return worker
}

start()

/** The computer's next command for `team`, at `level`. It sees the state without the dice. */
export function askComputer(game: GameState, team: TeamId, level: AiLevel, seed: number): Promise<ComputerChoice> {
  const w = start()
  if (!w) return Promise.reject(new Error('This browser can’t run the computer opponent (no Web Workers)'))
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    w.postMessage({ id, view: viewOf(game), team, level, budgetMs: BUDGET_MS, seed } satisfies ComputerRequest)
  })
}
