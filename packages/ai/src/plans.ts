import {
  type ActionType,
  type Command,
  distance,
  type Hex,
  hexEquals,
  legalCommands,
  maxMovement,
  type Player,
  type Reach,
  reachableHexes,
  standUpCost,
  toColRow,
} from '@orcball/engine'
import { type AiView, legalOf, stateOf } from './view'

// Whole-activation plans. The engine moves one hex per command, far too fine
// to search, so the computer chooses between plans: one player's whole
// activation, such as "move to (10,4)" or "Blitz: move to (10,4), block the
// Elf". A plan is carried out one command at a time with nextStep, which
// checks every command against the engine's legal commands; when the state
// no longer fits the plan (a failed roll ended the activation, a decision is
// pending) it stops and the caller decides again.

export type Plan = {
  playerId: string
  action: ActionType
  /** Whether the activation still has to start. */
  activate: boolean
  /** Stand up first (a prone player). */
  standUp: boolean
  /** Hexes to step through, in order, not including the start. */
  path: Hex[]
  /** The action's last command: a block, pass, hand-off or foul. */
  final: Command | null
  label: string
  /** For a Move plan: Dodges on the way, and whether the player ends Winded from Sprinting. */
  move?: { dodges: number; sprint: boolean }
}

/** Where a plan has got to. */
export type Cursor = { activated: boolean; stoodUp: boolean; steps: number; finalDone: boolean }

export const startCursor = (plan: Plan): Cursor => ({ activated: !plan.activate, stoodUp: !plan.standUp, steps: 0, finalDone: plan.final === null })

const sameCommand = (a: Command, b: Command) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The plan's next command and the cursor after it, or null when the plan is
 * over: done, or the state no longer fits it. Every command returned is legal.
 */
export function nextStep(view: AiView, plan: Plan, cursor: Cursor): { command: Command; cursor: Cursor } | null {
  if (view.pending) return null
  const legal = legalOf(view)
  const ok = (command: Command) => legal.some((c) => sameCommand(c, command))

  if (!cursor.activated) {
    const command: Command = { type: 'activate', playerId: plan.playerId, action: plan.action }
    return ok(command) ? { command, cursor: { ...cursor, activated: true } } : null
  }
  if (view.activation?.playerId !== plan.playerId) return null
  const player = view.players[plan.playerId]!

  if (!cursor.stoodUp) {
    const command: Command = { type: 'standUp' }
    if (player.status === 'prone' && ok(command)) return { command, cursor: { ...cursor, stoodUp: true } }
    if (player.status === 'prone') return null
  }

  if (cursor.steps < plan.path.length) {
    const to = plan.path[cursor.steps]!
    const isLast = cursor.steps === plan.path.length - 1
    const moves = legal.filter((c): c is Extract<Command, { type: 'move' }> => c.type === 'move' && hexEquals(c.to, to))
    const disengage = moves.find((c) => c.disengage)
    const dodge = moves.find((c) => c.dodge)
    const plain = moves.find((c) => !c.dodge && !c.disengage)
    // Last step: a Strength Disengage (no roll) or a plain step (which may
    // stop the move, v10) beats a Dodge. On the way: a Dodge where there is one,
    // since a plain step into a tackle zone would stop the move (v10).
    const command = isLast ? (disengage ?? plain ?? dodge) : (dodge ?? plain)
    return command ? { command, cursor: { ...cursor, steps: cursor.steps + 1 } } : null
  }

  if (!cursor.finalDone && plan.final) {
    return ok(plan.final) ? { command: plan.final, cursor: { ...cursor, finalDone: true } } : null
  }

  const end: Command = { type: 'endActivation' }
  return ok(end) ? { command: end, cursor: { ...cursor, finalDone: true, steps: plan.path.length } } : null
}

/** A hex as (column, row), as RULES.md and the board label them. */
const where = (hex: Hex) => {
  const { col, row } = toColRow(hex)
  return `(${col},${row})`
}

/** The cheapest ways to a hex next to `target`, fewest Dodges first, then least MA; `extraCost` is MA the final command needs. */
function approaches(ways: Reach[], target: Hex, limit: number, extraCost = 0, max = Infinity): Reach[] {
  return ways
    .filter((r) => distance(r.hex, target) === 1 && r.cost + extraCost <= max)
    .sort((a, b) => a.dodges - b.dodges || a.cost - b.cost)
    .slice(0, limit)
}

/**
 * Candidate plans for the team that's acting: every player who can still
 * activate (or the active player, mid-activation), each with its actions and
 * useful targets. Move plans go to every reachable hex: at the measured engine
 * speed that's affordable one activation ahead (see ARCHITECTURE.md,
 * Performance). Wait and Momentum aren't plans; the caller adds them.
 */
export function generatePlans(view: AiView): Plan[] {
  const state = stateOf(view)
  const legal = legalCommands(state)
  const plans: Plan[] = []
  const active = view.activation

  const forPlayer = (player: Player, action: ActionType, activate: boolean) => {
    const reach = reachableHexes(state, player.id)
    const standUp = player.status === 'prone'
    const max = maxMovement(state, player)
    const used = active?.playerId === player.id ? active.maUsed : 0
    // Staying put is a way too: the player's own hex, after standing up if he's down.
    const here: Reach[] = player.hex
      ? [{ hex: player.hex, cost: used + (standUp ? standUpCost(state, player) : 0), path: [], disengages: 0, dodges: 0, sprint: false, standUp, stops: false, dodgeSteps: 0, sprintFrom: -1 }]
      : []
    const ways = [...here, ...reach]
    const base = { playerId: player.id, action, activate, standUp }
    const enemies = Object.values(view.players).filter((p) => p.team !== player.team && p.hex !== null)
    const mates = Object.values(view.players).filter((p) => p.team === player.team && p.id !== player.id && p.hex !== null && p.status === 'standing')
    const carrying = view.ball.carrier === player.id

    if (action === 'move') {
      plans.push({ ...base, path: [], final: null, label: standUp ? `${player.id} stands up` : `${player.id} stays` })
      for (const r of reach) plans.push({ ...base, path: r.path, final: null, label: `${player.id} moves to ${where(r.hex)}`, move: { dodges: r.dodges, sprint: r.sprint } })
    }

    if (action === 'block' && player.status === 'standing' && player.hex) {
      for (const e of enemies) {
        if (e.status === 'standing' && distance(e.hex!, player.hex) === 1) {
          plans.push({ ...base, path: [], final: { type: 'block', targetId: e.id }, label: `${player.id} blocks ${e.id}` })
        }
      }
    }

    if (action === 'blitz' && !active?.blocked) {
      const cost = view.config.blocking.blitzBlockCost
      for (const e of enemies) {
        if (e.status !== 'standing') continue
        for (const r of approaches(ways, e.hex!, 2, cost, max)) {
          plans.push({ ...base, path: r.path, final: { type: 'block', targetId: e.id }, label: `${player.id} Blitzes ${e.id} from ${where(r.hex)}` })
        }
      }
    }

    if (action === 'handOff' && carrying) {
      for (const m of mates) {
        for (const r of approaches(ways, m.hex!, 1)) {
          plans.push({ ...base, path: r.path, final: { type: 'handOff', targetId: m.id }, label: `${player.id} hands off to ${m.id}` })
        }
      }
    }

    if (action === 'pass' && carrying && player.hex) {
      const longest = view.config.ball.passBands.at(-1)!.maxRange
      for (const m of mates) {
        const range = distance(player.hex, m.hex!)
        if (range >= 1 && range <= longest) {
          plans.push({ ...base, path: [], final: { type: 'pass', target: m.hex! }, label: `${player.id} passes to ${m.id}` })
        }
      }
    }

    if (action === 'foul') {
      for (const e of enemies) {
        if (e.status !== 'prone' && e.status !== 'stunned') continue
        for (const r of approaches(ways, e.hex!, 1)) {
          plans.push({ ...base, path: r.path, final: { type: 'foul', targetId: e.id }, label: `${player.id} fouls ${e.id}` })
        }
      }
    }
  }

  if (active) {
    const player = view.players[active.playerId]!
    if (view.turnOwner === player.team) {
      // Mid-activation: the active player's own action, or stop here.
      plans.push({ playerId: player.id, action: active.action, activate: false, standUp: false, path: [], final: null, label: `${player.id} ends the activation` })
      forPlayer(player, active.action, false)
      // A move plan's "stay" duplicates "end"; drop it.
      return plans.filter((p, i) => i === 0 || p.path.length > 0 || p.final !== null || p.standUp)
    }
    return plans
  }

  for (const command of legal) {
    if (command.type !== 'activate') continue
    const player = view.players[command.playerId]!
    if (player.status === 'stunned') {
      plans.push({ playerId: player.id, action: 'move', activate: true, standUp: false, path: [], final: null, label: `${player.id} turns face up` })
      continue
    }
    forPlayer(player, command.action, true)
  }
  return plans
}
