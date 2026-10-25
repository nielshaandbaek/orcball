import type { Modifier } from '../dice'
import { successChance } from '../dice'
import type { RuleContext, RuleModule } from '../engine'
import { distance, type Hex, hexEquals, hexKey, neighbours, onPitch } from '../hex'
import type { Activation, ActionType, Command, CommandOption, GameState, Player, RollPreview, TeamId } from '../state'
import { knockDown } from './injury'
import { offerReroll, resolveReroll } from './momentum'
import { pickUp, pickUpCost } from './passing'
import { blockTotals, enemyTackleZones, exertsTackleZone } from './zones'

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
//
// Rules v11 (config movement.tackleZones 'dodgeOnLeaving') turns this round:
// entering a tackle zone is free and doesn't stop the player, and every step
// out of a hex in an enemy tackle zone is a Dodge, at −1 per enemy tackle zone
// on the hex dodged into. There's no Disengage cost. A failed Dodge leaves the
// player Knocked Down in the hex they dodged into. With movement
// .strengthDisengage, a marked player who is at least as strong (ST + assists)
// as each marker may instead step 1 hex to a hex in no enemy tackle zone, with
// no roll; that step is their whole move.

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

/** Rules v11: Dodge on leaving a tackle zone rather than on entering one. */
function dodgesOnLeaving(state: GameState): boolean {
  return state.config.movement.tackleZones === 'dodgeOnLeaving'
}

function dodgeModifiers(state: GameState, hex: Hex, team: TeamId): Modifier[] {
  const onLeaving = dodgesOnLeaving(state)
  const zones = enemyTackleZones(state, hex, team) - (onLeaving ? 0 : 1)
  if (zones <= 0) return []
  const name = `${zones}${onLeaving ? '' : ' extra'} tackle zone${zones > 1 ? 's' : ''}`
  return [{ name, value: zones * state.config.movement.dodgeModifierPerExtraTackleZone }]
}

/** Opponents exerting a tackle zone on the player's hex. */
function markers(state: GameState, player: Player): Player[] {
  return Object.values(state.players).filter(
    (p) => p.team !== player.team && exertsTackleZone(p) && distance(p.hex!, player.hex!) === 1,
  )
}

/**
 * Whether a Strength Disengage to `to` is allowed (v11): the player is marked,
 * hasn't stepped yet this activation, is at least as strong as each marker,
 * and `to` is in no enemy tackle zone.
 */
function canStrengthDisengage(state: GameState, player: Player, activation: Activation | null, to: Hex): boolean {
  if (!state.config.movement.strengthDisengage || activation?.moved) return false
  if (enemyTackleZones(state, to, player.team) > 0) return false
  const marking = markers(state, player)
  if (marking.length === 0) return false
  return marking.every((m) => {
    const { attack, defence } = blockTotals(state, player, m)
    return attack >= defence
  })
}

/** What it costs to step from `from` to a neighbour, given the hex just dodged into. */
function stepCost(state: GameState, from: Hex, team: TeamId, freeLeave: Hex | null): { cost: number; disengage: boolean } {
  const disengage = enemyTackleZones(state, from, team) > 0 && !(freeLeave && hexEquals(freeLeave, from))
  return { cost: 1 + (disengage ? state.config.movement.disengageCost : 0), disengage }
}

export type Reach = {
  hex: Hex
  /** Total MA the activation will have spent on arrival, standing up and any pick-up included. */
  cost: number
  /** Steps from the player's hex to this one, not including the start. */
  path: Hex[]
  /** Steps on the way that pay the Disengage cost, or 1 for a Strength Disengage (v11). */
  disengages: number
  /** Dodges on the way, including into this hex if it ends in a Dodge. */
  dodges: number
  /** Arriving needs Sprint MA, so the player ends Winded. */
  sprint: boolean
  /** The player has to stand up first. */
  standUp: boolean
  /** The player can't move on from this hex: stopped in an enemy tackle zone, or Strength Disengaged. */
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
      const cost = label.cost + step.cost + pickUpCost(state, next)
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
      if (dodgesOnLeaving(state)) {
        const marked = enemyTackleZones(state, label.hex, player.team) > 0
        candidates.push({ ...base, disengages: label.disengages, dodges: label.dodges + (marked ? 1 : 0), stops: false, freeLeave: null })
        if (marked && label === start && canStrengthDisengage(state, player, activation, next)) {
          candidates.push({ ...base, disengages: 1, dodges: label.dodges, stops: true, freeLeave: null })
        }
      } else if (enemyTackleZones(state, next, player.team) > 0) {
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
    const cost = activation.maUsed + stepCost(state, player.hex, player.team, activation.freeLeave).cost + pickUpCost(state, to)
    if (cost > max) continue
    if (dodgesOnLeaving(state)) {
      const marked = enemyTackleZones(state, player.hex, player.team) > 0
      options.push({ command: marked ? { type: 'move', to, dodge: true } : { type: 'move', to }, available: true })
      if (marked && canStrengthDisengage(state, player, activation, to)) {
        options.push({ command: { type: 'move', to, disengage: true }, available: true })
      }
      continue
    }
    options.push({ command: { type: 'move', to }, available: true })
    if (enemyTackleZones(state, to, player.team) > 0 && cost < max) {
      options.push({ command: { type: 'move', to, dodge: true }, available: true })
    }
  }
  return options
}

/** Roll the Dodge into `to`, where the player now stands; a failure can be re-rolled with Momentum. */
function dodgeRoll(ctx: RuleContext, player: Player, to: Hex): void {
  const event = ctx.test('Dodge', player.ag, dodgeModifiers(ctx.state, to, player.team))
  if (event.success) {
    ctx.state.activation!.freeLeave = to
    return pickUp(ctx, player.id)
  }
  if (!offerReroll(ctx, { kind: 'movement.dodge', team: player.team, failed: event, data: { playerId: player.id } })) {
    fall(ctx, player.id)
  }
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

    move(ctx, { to, dodge, disengage }) {
      const { state } = ctx
      const activation = state.activation!
      const player = state.players[activation.playerId]!
      const from = player.hex!
      const leavingZone = enemyTackleZones(state, from, player.team) > 0
      activation.moved = true

      activation.maUsed += stepCost(state, from, player.team, activation.freeLeave).cost + pickUpCost(state, to)
      activation.freeLeave = null
      player.hex = to
      if (state.ball.carrier === player.id) state.ball.hex = to
      ctx.emit({ type: 'moved', playerId: player.id, path: [from, to] })
      if (activation.maUsed > player.ma && !player.winded) {
        player.winded = true
        ctx.emit({ type: 'winded', playerId: player.id })
      }

      if (disengage) {
        activation.stopped = true
        ctx.emit({ type: 'disengaged', playerId: player.id, to })
        return pickUp(ctx, player.id)
      }
      if (dodgesOnLeaving(state)) {
        if (!leavingZone) return pickUp(ctx, player.id)
        return dodgeRoll(ctx, player, to)
      }

      // A loose ball in the hex is picked up after any Dodge, even if the move stops here.
      if (enemyTackleZones(state, to, player.team) === 0) return pickUp(ctx, player.id)
      if (!dodge) {
        activation.stopped = true
        return pickUp(ctx, player.id)
      }
      dodgeRoll(ctx, player, to)
    },
  },

  decisions: {
    'movement.dodge'(ctx, pending, choice) {
      const { event, data } = resolveReroll(ctx, pending, choice)
      const playerId = (data as { playerId: string }).playerId
      if (event.success) {
        ctx.state.activation!.freeLeave = ctx.state.players[playerId]!.hex
        pickUp(ctx, playerId)
      } else fall(ctx, playerId)
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
