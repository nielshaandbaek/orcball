import { type Command, rollDie, type RngState, seededRng, type TeamId } from '@orcball/engine'
import { actingTeam, type AiView, optionsOf } from './view'

// The computer's entry point: given what it can see, pick its next command.
// For now it picks a random legal command; the levels replace this.

export type AiLevel = 'novice' | 'intermediate' | 'expert'

export type AiOptions = {
  level: AiLevel
  /** Most time to think, in milliseconds. */
  budgetMs: number
  /** For tie-breaks and sampled dice: the same view, level and seed give the same command. */
  seed: number
}

export type AiChoice = { command: Command; reason: string }

function pick<T>(rng: RngState, items: readonly T[]): T {
  // rollDie needs 2+ sides; with one item, any roll picks it.
  return items[(rollDie(rng, Math.max(items.length, 2)).value - 1) % items.length]!
}

export function chooseCommand(view: AiView, me: TeamId, options: AiOptions): AiChoice {
  if (actingTeam(view) !== me) throw new Error(`chooseCommand: it is ${actingTeam(view)}'s move, not ${me}'s`)
  const legal = optionsOf(view)
    .filter((o) => o.available)
    .map((o) => o.command)
  if (legal.length === 0) throw new Error(`chooseCommand: no legal commands in phase ${view.phase}`)
  const rng = seededRng(options.seed)

  // Random setup never ends (it keeps moving the same player), so place a
  // full team on random hexes and then end setup.
  if (view.phase === 'Setup' && !view.pending) {
    const placed = Object.values(view.players).filter((p) => p.team === me && p.hex !== null).length
    const end = legal.find((c) => c.type === 'endSetup')
    const places = legal.filter((c) => c.type === 'place' && view.players[c.playerId]!.hex === null)
    if (end && (placed >= view.config.match.playersOnPitch || places.length === 0)) return { command: end, reason: 'Setup done' }
    if (places.length > 0) return { command: pick(rng, places), reason: 'Setup: a random hex' }
  }
  return { command: pick(rng, legal), reason: 'A random legal command' }
}
