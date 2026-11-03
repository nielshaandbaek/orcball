import { type Command, fromColRow, type Hex, hexEquals, legalCommands, otherTeam, rowLength, type TeamId, TEAM_SIDES } from '@orcball/engine'
import { z } from 'zod'
import formationsJson from '../formations/default.json' with { type: 'json' }
import { defaultWeights, type Weights } from './evaluate'
import { generatePlans, nextStep, type Plan, startCursor } from './plans'
import { decisionReason, planReason, where } from './reasons'
import { Search } from './search'
import { type AiView, simulate, stateOf } from './view'

// Novice: the plan with the best expected evaluation, looking one activation
// ahead (its own). Decisions are scored the same way, a step or two deep.
// Setup picks the best-scoring formation template for the roster, and the
// kick-off the target with the best expected outcome.

/**
 * The command, its reason in plain words, and a key for the plan it belongs
 * to: commands of the same plan share it, so the log can show the reason once.
 */
export type Choice = { command: Command; reason: string; plan?: string }

const SlotSchema = z.strictObject({ position: z.string(), col: z.int().min(1), row: z.int().min(1) })
const FormationSchema = z.strictObject({ name: z.string(), slots: z.array(SlotSchema).min(1) })
/** Formations per roster id, for kicking and receiving, laid out for the home side (the left half). */
export const FormationsSchema = z.record(
  z.string(),
  z.strictObject({ kick: z.array(FormationSchema).min(1), receive: z.array(FormationSchema).min(1) }),
)
export type Formation = z.infer<typeof FormationSchema>
export const formations = FormationsSchema.parse(formationsJson)

/** Kick targets tried: every other hex of the receiving half. */
const KICK_SAMPLES = 3

/**
 * A seed from the position itself, so the same position always gets the same
 * dice samples. Re-planning after every command then keeps to the same plan
 * instead of wavering between near-equal ones on sampling noise.
 */
export function positionSeed(view: AiView): number {
  const activated = Object.values(view.players)
    .filter((p) => p.activatedThisRound)
    .map((p) => p.id)
    .join(',')
  const key = `${view.half}:${view.round}:${view.turnOwner}:${view.activation?.playerId ?? ''}:${activated}`
  let h = 2_166_136_261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16_777_619)
  return h >>> 0
}

export function chooseNovice(view: AiView, me: TeamId, weights: Weights = defaultWeights, budgetMs = 10_000): Choice {
  const search = new Search(me, weights, positionSeed(view))
  if (view.pending) {
    const { choice } = search.decide(view)
    const picked = view.pending.choices.find((c) => c.id === choice) ?? { id: choice, label: choice }
    return { command: { type: 'decide', choice }, reason: decisionReason(view, view.pending, picked, me) }
  }
  if (view.phase === 'Setup') return setupCommand(view, me, search)
  if (view.phase === 'KickOff') return kickCommand(view, search)
  return playCommand(view, search, budgetMs)
}

function playCommand(view: AiView, search: Search, budgetMs: number): Choice {
  const start = Date.now()
  const legal = legalCommands(stateOf(view))
  let best: { plan: Plan; value: number } | null = null
  search.deadline = start + budgetMs
  for (const plan of generatePlans(view)) {
    if (best && Date.now() > search.deadline) break
    const value = search.planValue(view, plan)
    if (!best || value > best.value + 1e-9) best = { plan, value }
  }
  const wait = legal.find((c) => c.type === 'wait')
  if (wait) {
    const value = search.value(simulate(view, wait, { seed: 1 }).view)
    if (!best || value > best.value + 1e-9) return { command: wait, reason: 'Waits, keeping its players for later in the round', plan: 'wait' }
  }
  if (best) {
    const step = nextStep(view, best.plan, startCursor(best.plan))
    if (step) return { command: step.command, reason: planReason(view, best.plan, search.me, search), plan: `${best.plan.playerId}: ${best.plan.label}` }
  }
  // Nothing planned fits: end the activation if one is on, or any legal command.
  const fallback = legal.find((c) => c.type === 'endActivation') ?? wait ?? legal[0]
  if (!fallback) throw new Error(`chooseNovice: no legal commands in phase ${view.phase}`)
  return { command: fallback, reason: 'No plan fits' }
}

/** A formation slot on this team's side: the template is for home, so away mirrors it. */
function slotHex(team: TeamId, col: number, row: number): Hex {
  return fromColRow({ col: TEAM_SIDES[team] === 'left' ? col : rowLength(row) + 1 - col, row })
}

function rosterId(view: AiView, team: TeamId): string | null {
  const name = view.teams[team].name
  return Object.entries(view.config.rosters).find(([, r]) => r.name === name)?.[0] ?? null
}

/** Which player goes where: each slot takes the first free player of its position, then anyone left. */
function assign(view: AiView, team: TeamId, formation: Formation): { playerId: string; hex: Hex }[] {
  const free = Object.values(view.players)
    .filter((p) => p.team === team && p.status !== 'out' && p.status !== 'casualty' && p.status !== 'ejected')
    .sort((a, b) => a.id.localeCompare(b.id))
  const taken = new Set<string>()
  const result: { playerId: string; hex: Hex }[] = []
  const open: Formation['slots'] = []
  for (const slot of formation.slots) {
    const player = free.find((p) => !taken.has(p.id) && p.position === slot.position)
    if (!player) {
      open.push(slot)
      continue
    }
    taken.add(player.id)
    result.push({ playerId: player.id, hex: slotHex(team, slot.col, slot.row) })
  }
  for (const slot of open) {
    const player = free.find((p) => !taken.has(p.id))
    if (!player) break
    taken.add(player.id)
    result.push({ playerId: player.id, hex: slotHex(team, slot.col, slot.row) })
  }
  return result
}

/** The formation this team sets up in: the best-scoring template, judged with the team's own players cleared. */
function bestFormation(view: AiView, team: TeamId, search: Search): Formation | null {
  const id = rosterId(view, team)
  const set = id ? formations[id] : undefined
  if (!set) return null
  const templates = view.kickingTeam === team ? set.kick : set.receive
  let best: { formation: Formation; value: number } | null = null
  for (const formation of templates) {
    const players = Object.fromEntries(Object.values(view.players).map((p) => [p.id, p.team === team ? { ...p, hex: null } : p]))
    for (const { playerId, hex } of assign(view, team, formation)) players[playerId]!.hex = hex
    const value = search.value({ ...view, players }, team)
    if (!best || value > best.value + 1e-9) best = { formation, value }
  }
  return best?.formation ?? null
}

export function setupCommand(view: AiView, me: TeamId, search: Search): Choice {
  const legal = legalCommands(stateOf(view))
  const isLegal = (c: Command) => legal.some((l) => JSON.stringify(l) === JSON.stringify(c))
  const formation = bestFormation(view, me, search)
  if (formation) {
    for (const { playerId, hex } of assign(view, me, formation)) {
      const at = view.players[playerId]!.hex
      if (at && hexEquals(at, hex)) continue
      const command: Command = { type: 'place', playerId, hex }
      if (isLegal(command)) return { command, reason: setupReason(view, me, formation), plan: `setup: ${formation.name}` }
    }
  }
  // Anyone still off the pitch goes on the first legal hex, up to a full team.
  const onPitch = Object.values(view.players).filter((p) => p.team === me && p.hex !== null).length
  if (onPitch < view.config.match.playersOnPitch) {
    const place = legal.find((c) => c.type === 'place' && view.players[c.playerId]!.hex === null)
    if (place) return { command: place, reason: 'Fills the team', plan: 'setup: fill' }
  }
  const end = legal.find((c) => c.type === 'endSetup')
  if (!end) throw new Error('chooseNovice: setup can’t end')
  return formation
    ? { command: end, reason: setupReason(view, me, formation), plan: `setup: ${formation.name}` }
    : { command: end, reason: 'Ends its setup' }
}

function setupReason(view: AiView, me: TeamId, formation: Formation): string {
  return `Sets up to ${view.kickingTeam === me ? 'kick' : 'receive'} in the ${formation.name} formation`
}

export function kickCommand(view: AiView, search: Search): Choice {
  const kicks = legalCommands(stateOf(view)).filter((c): c is Extract<Command, { type: 'kick' }> => c.type === 'kick')
  // Every other hex is enough: the kick scatters anyway.
  const candidates = kicks.filter((c) => (c.hex.q + 2 * c.hex.r) % 2 === 0)
  const receiver = otherTeam(view.kickingTeam)
  let best: { command: Command; value: number } | null = null
  for (const command of candidates.length > 0 ? candidates : kicks) {
    let value = 0
    for (let i = 0; i < KICK_SAMPLES; i++) {
      for (const o of search.outcomes(view, command)) value += (o.p * -search.settled(o.view, receiver, 2)) / KICK_SAMPLES
    }
    if (!best || value > best.value + 1e-9) best = { command, value }
  }
  if (!best) throw new Error('chooseNovice: nowhere to kick')
  const at = best.command.type === 'kick' ? ` towards ${where(best.command.hex)}` : ''
  return { command: best.command, reason: `Kicks off${at}` }
}
