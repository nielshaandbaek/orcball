import type { Modifier } from '../dice'
import { successChance } from '../dice'
import type { RuleContext, RuleModule } from '../engine'
import { type Hex, hexEquals, hexKey, neighbours, onPitch } from '../hex'
import type { ActionType, Command, CommandOption, GameState, Player, RollPreview, TeamId } from '../state'
import { knockDown } from './injury'
import { offerReroll, resolveReroll } from './momentum'
import { enemyTackleZones } from './zones'

// Movement (RULES.md §4).
//
// A player moves one hex per MA point, one step per command. Entering a hex
// in an enemy tackle zone ends the move, unless the coach Dodges: an AG roll
// at −1 per enemy tackle zone on that hex beyond the first. A successful Dodge
// lets the player keep going, and leaving that hex costs nothing extra.
// Leaving any other hex in an enemy tackle zone costs +1 MA (Disengage).
// Sprinting adds up to +2 MA but leaves the player Winded: no tackle zone and
// no assists until their next activation. Standing up costs half MA, rounded up.
//
// A step into an enemy tackle zone is offered as two commands, stop or Dodge,
// and the Dodge's odds come from previewRoll.

/** Actions that let the player move during the activation. Block doesn't. */
const MOVING_ACTIONS: ReadonlySet<ActionType> = new Set(['move', 'blitz', 'pass', 'handOff', 'foul'])

export { enemyTackleZones, exertsTackleZone } from './zones'

function occupied(state: GameState, hex: Hex): boolean {
  return Object.values(state.players).some((p) => p.hex !== null && hexEquals(p.hex, hex))
}

/** Most MA a player can spend in one activation, Sprinting included. */
export function maxMovement(state: GameState, player: Player): number {
  return player.ma + state.config.movement.sprintBonus
}

export function standUpCost(state: GameState, player: Player): number {
  return Math.ceil(player.ma / state.config.movement.standUpMaDivisor)
}

function dodgeModifiers(state: GameState, hex: Hex, team: TeamId): Modifier[] {
  const extra = enemyTackleZones(state, hex, team) - 1
  if (extra <= 0) return []
  return [{ name: `${extra} extra tackle zone${extra > 1 ? 's' : ''}`, value: extra * state.config.movement.dodgeModifierPerExtraTackleZone }]
}

/** What it costs to step from `from` to a neighbour, given the hex just dodged into. */
function stepCost(state: GameState, from: Hex, team: TeamId, freeLeave: Hex | null): { cost: number; disengage: boolean } {
  const disengage = enemyTackleZones(state, from, team) > 0 && !(freeLeave && hexEquals(freeLeave, from))
  return { cost: 1 + (disengage ? state.config.movement.disengageCost : 0), disengage }
}

export type Reach = {
  hex: Hex
  /** Total MA the activation will have spent on arrival, standing up included. */
  cost: number
  /** Steps from the player's hex to this one, not including the start. */
  path: Hex[]
  /** Steps on the way that pay the Disengage cost. */
  disengages: number
  /** Dodges on the way, including into this hex if it ends in a Dodge. */
  dodges: number
  /** Arriving needs Sprint MA, so the player ends Winded. */
  sprint: boolean
  /** The player has to stand up first. */
  standUp: boolean
  /** The hex is in an enemy tackle zone and the player stops there without dodging. */
  stops: boolean
}

type Label = Reach & { freeLeave: Hex | null }

const dominates = (a: Label, b: Label) => a.dodges <= b.dodges && a.cost <= b.cost && (!a.stops || b.stops)

/**
 * Every hex the player could reach this activation, with the cheapest way
 * there. Where there's a choice, fewer Dodges beats lower cost. For the active
 * player it starts from where they are now with the MA they've used; for
 * anyone else it's a fresh activation.
 */
export function reachableHexes(state: GameState, playerId: string): Reach[] {
  const player = state.players[playerId]
  if (!player?.hex || (player.status !== 'standing' && player.status !== 'prone')) return []
  const activation = state.activation?.playerId === playerId ? state.activation : null
  const standUp = player.status === 'prone'
  const max = maxMovement(state, player)

  const start: Label = {
    hex: player.hex,
    cost: (activation?.maUsed ?? 0) + (standUp ? standUpCost(state, player) : 0),
    path: [],
    disengages: 0,
    dodges: 0,
    sprint: false,
    standUp,
    stops: activation?.stopped ?? false,
    freeLeave: activation?.freeLeave ?? null,
  }

  const labels = new Map<string, Label[]>()
  const queue: Label[] = [start]
  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost || a.dodges - b.dodges)
    const label = queue.shift()!
    if (label.stops) continue
    for (const next of neighbours(label.hex)) {
      if (!onPitch(next) || occupied(state, next)) continue
      const step = stepCost(state, label.hex, player.team, label.freeLeave)
      const cost = label.cost + step.cost
      if (cost > max) continue
      const base = {
        hex: next,
        cost,
        path: [...label.path, next],
        disengages: label.disengages + (step.disengage ? 1 : 0),
        sprint: cost > player.ma,
        standUp,
      }
      const candidates: Label[] = []
      if (enemyTackleZones(state, next, player.team) > 0) {
        candidates.push({ ...base, dodges: label.dodges, stops: true, freeLeave: null })
        // Dodging only helps if there's MA left to keep going.
        if (cost < max) candidates.push({ ...base, dodges: label.dodges + 1, stops: false, freeLeave: next })
      } else {
        candidates.push({ ...base, dodges: label.dodges, stops: false, freeLeave: null })
      }
      for (const candidate of candidates) {
        const key = hexKey(next)
        const existing = labels.get(key) ?? []
        if (existing.some((l) => dominates(l, candidate))) continue
        labels.set(key, [...existing.filter((l) => !dominates(candidate, l)), candidate])
        queue.push(candidate)
      }
    }
  }

  const best = (ls: Label[]) =>
    [...ls].sort((a, b) => a.dodges - b.dodges || a.cost - b.cost || Number(a.stops) - Number(b.stops))[0]!
  return [...labels.values()].map((ls) => {
    const { freeLeave: _, ...reach } = best(ls)
    return reach
  })
}

function activePlayer(state: GameState): Player | null {
  if (state.phase !== 'Activation' || !state.activation || state.pending) return null
  if (!MOVING_ACTIONS.has(state.activation.action) && state.players[state.activation.playerId]!.status !== 'prone') {
    return null
  }
  return state.players[state.activation.playerId]!
}

function stepOptions(state: GameState): CommandOption[] {
  const player = activePlayer(state)
  if (!player?.hex) return []
  const activation = state.activation!

  if (player.status === 'prone') return [{ command: { type: 'standUp' }, available: true }]
  if (player.status !== 'standing' || activation.stopped || !MOVING_ACTIONS.has(activation.action)) return []

  const max = maxMovement(state, player)
  const options: CommandOption[] = []
  for (const to of neighbours(player.hex)) {
    if (!onPitch(to) || occupied(state, to)) continue
    const cost = activation.maUsed + stepCost(state, player.hex, player.team, activation.freeLeave).cost
    if (cost > max) continue
    options.push({ command: { type: 'move', to }, available: true })
    if (enemyTackleZones(state, to, player.team) > 0 && cost < max) {
      options.push({ command: { type: 'move', to, dodge: true }, available: true })
    }
  }
  return options
}

/** A failed Dodge that stands: the player falls in the hex and the activation ends. */
function fall(ctx: RuleContext, playerId: string): void {
  knockDown(ctx, playerId, { kind: 'endActivation', failed: true })
}

export const movement: RuleModule = {
  name: 'movement',

  options: stepOptions,

  commands: {
    standUp(ctx) {
      const { state } = ctx
      const player = state.players[state.activation!.playerId]!
      state.activation!.maUsed += standUpCost(state, player)
      player.status = 'standing'
      ctx.emit({ type: 'stoodUp', playerId: player.id })
    },

    move(ctx, { to, dodge }) {
      const { state } = ctx
      const activation = state.activation!
      const player = state.players[activation.playerId]!
      const from = player.hex!

      activation.maUsed += stepCost(state, from, player.team, activation.freeLeave).cost
      activation.freeLeave = null
      player.hex = to
      ctx.emit({ type: 'moved', playerId: player.id, path: [from, to] })
      if (activation.maUsed > player.ma && !player.winded) {
        player.winded = true
        ctx.emit({ type: 'winded', playerId: player.id })
      }

      if (enemyTackleZones(state, to, player.team) === 0) return
      if (!dodge) {
        activation.stopped = true
        return
      }
      const event = ctx.test('Dodge', player.ag, dodgeModifiers(state, to, player.team))
      if (event.success) {
        activation.freeLeave = to
        return
      }
      if (!offerReroll(ctx, { kind: 'movement.dodge', team: player.team, failed: event, data: { playerId: player.id } })) {
        fall(ctx, player.id)
      }
    },
  },

  decisions: {
    'movement.dodge'(ctx, pending, choice) {
      const { event, data } = resolveReroll(ctx, pending, choice)
      const playerId = (data as { playerId: string }).playerId
      if (event.success) ctx.state.activation!.freeLeave = ctx.state.players[playerId]!.hex
      else fall(ctx, playerId)
    },
  },

  preview(state, command: Command): RollPreview | null {
    if (command.type !== 'move' || !command.dodge) return null
    const player = activePlayer(state)
    if (!player) return null
    const modifiers = dodgeModifiers(state, command.to, player.team)
    return { test: 'Dodge', target: player.ag, modifiers, chance: successChance(player.ag, modifiers) }
  },
}
