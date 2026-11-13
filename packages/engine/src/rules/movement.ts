import type { Modifier } from '../dice'
import { successChance } from '../dice'
import type { RuleContext, RuleModule } from '../engine'
import { distance, type Hex, hexEquals, hexKey, neighbours, onPitch } from '../hex'
import type { Activation, ActionType, Command, CommandOption, GameState, Player, RollPreview, TeamId } from '../state'
import { knockDown } from './injury'
import { offerReroll, resolveReroll } from './momentum'
import { pickUp, pickUpCost } from './passing'
import { hasSkill, skillModifier } from './skills'
import { blockTotals, enemyTackleZones, exertsTackleZone, tackleZoneMap } from './zones'

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
//
// Leap (v19, the Leap skill): once per Move or Blitz, instead of a step, the
// player jumps to any empty hex on the pitch 1 or 2 hexes away, over whatever
// is in between, for 2 MA (Sprint MA too). Leaving his hex needs no Dodge and
// costs no Disengage; any hex jumped over isn't entered. He rolls an
// unmodified Agility test on landing; a failure (re-rollable with Momentum)
// knocks him down there and ends the activation. The normal reach leaves
// leaps out; reachableHexes includes them only when asked (the computer).

/** Actions that let the player move during the activation. Block doesn't. */
const MOVING_ACTIONS: ReadonlySet<ActionType> = new Set(['move', 'blitz', 'pass', 'handOff', 'foul'])

export { enemyTackleZones, exertsTackleZone } from './zones'

function occupied(state: GameState, hex: Hex): boolean {
  const players = state.players
  for (const id in players) {
    const at = players[id]!.hex
    if (at !== null && at.q === hex.q && at.r === hex.r) return true
  }
  return false
}

/** What a Leap costs, on top of any pick-up where he lands. */
export const LEAP_COST = 2

/** How far a Leap can go: any hex this many away or nearer. */
export const LEAP_RANGE = 2

/** The hexes 1 or 2 away, on the pitch: where a Leap from `hex` can land, if empty. */
export function leapLandings(hex: Hex): Hex[] {
  const landings: Hex[] = []
  for (let dq = -LEAP_RANGE; dq <= LEAP_RANGE; dq++) {
    for (let dr = Math.max(-LEAP_RANGE, -dq - LEAP_RANGE); dr <= Math.min(LEAP_RANGE, -dq + LEAP_RANGE); dr++) {
      if (dq === 0 && dr === 0) continue
      const to = { q: hex.q + dq, r: hex.r + dr }
      if (onPitch(to)) landings.push(to)
    }
  }
  return landings
}

/** Actions a Leap can be part of. */
const LEAPING_ACTIONS: ReadonlySet<ActionType> = new Set(['move', 'blitz'])

/** Whether the player may still Leap this activation (v19): he has the skill, it's a Move or Blitz, and he hasn't leapt yet. */
function mayLeap(player: Player, activation: Activation | null): boolean {
  return hasSkill(player, 'Leap') && !activation?.leapt && (activation === null || LEAPING_ACTIONS.has(activation.action))
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

function dodgeModifiers(state: GameState, hex: Hex, player: Player): Modifier[] {
  const modifiers: Modifier[] = []
  const { dodgeBonus, dodgeModifierPerExtraTackleZone } = state.config.movement
  if (dodgeBonus) modifiers.push({ name: 'Dodge bonus', value: dodgeBonus })
  modifiers.push(...skillModifier(player, 'Dodge'))
  const onLeaving = dodgesOnLeaving(state)
  const zones = enemyTackleZones(state, hex, player.team) - (onLeaving ? 0 : 1)
  if (zones <= 0) return modifiers
  const name = `${zones}${onLeaving ? '' : ' extra'} tackle zone${zones > 1 ? 's' : ''}`
  modifiers.push({ name, value: zones * dodgeModifierPerExtraTackleZone })
  return modifiers
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
  /** The steps that need a Dodge: bit i is set when the step onto `path[i]` does. See stepKinds(). */
  dodgeSteps: number
  /** The index in `path` of the first step taken Sprinting, or -1 if none is. See stepKinds(). */
  sprintFrom: number
  /** With `leaps`: the index in `path` of the step that is a Leap (counted in `dodges` too, for its roll). */
  leapStep?: number
}

/** What one step of a path takes: a Dodge roll, Sprint MA, both or neither. */
export type StepKind = { dodge: boolean; sprint: boolean }

/** Step by step, what the way to a reachable hex takes, in the order of its path (#113). */
export function stepKinds(reach: Reach): StepKind[] {
  return reach.path.map((_, i) => ({
    dodge: (reach.dodgeSteps & (1 << i)) !== 0,
    sprint: reach.sprintFrom >= 0 && i >= reach.sprintFrom,
  }))
}

type Label = Reach & { freeLeave: Hex | null; leapt: boolean }

/** A binary heap of labels: cheapest first, then fewest Dodges, then in the order they were added. */
class LabelQueue {
  private items: { label: Label; seq: number }[] = []
  private added = 0

  get size(): number {
    return this.items.length
  }

  private before(i: number, j: number): boolean {
    const a = this.items[i]!
    const b = this.items[j]!
    return (a.label.cost - b.label.cost || a.label.dodges - b.label.dodges || a.seq - b.seq) < 0
  }

  private swap(i: number, j: number): void {
    const t = this.items[i]!
    this.items[i] = this.items[j]!
    this.items[j] = t
  }

  push(label: Label): void {
    this.items.push({ label, seq: this.added++ })
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.before(i, parent)) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): Label {
    const top = this.items[0]!.label
    const last = this.items.pop()!
    if (this.items.length > 0) {
      this.items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.items.length && this.before(l, m)) m = l
        if (r < this.items.length && this.before(r, m)) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }
}

const dominates = (a: Label, b: Label) => a.dodges <= b.dodges && a.cost <= b.cost && (!a.stops || b.stops) && (!a.leapt || b.leapt)

/**
 * Every hex the player could reach this activation, with the cheapest way
 * there. With `leaps`, ways that use the player's Leap (v19) count too: only
 * ask for a Move or Blitz. Where there's a choice, fewer Dodges beats lower cost. For the active
 * player it starts from where they are now with the MA they've used; for
 * anyone else it's a fresh activation.
 */
export function reachableHexes(state: GameState, playerId: string, { leaps = false }: { leaps?: boolean } = {}): Reach[] {
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
    leapt: !leaps || !mayLeap(player, activation),
    dodgeSteps: 0,
    sprintFrom: -1,
  }

  // The state doesn't change while we search it: look up who stands where and the tackle zones once.
  const taken = new Set<string>()
  for (const p of Object.values(state.players)) if (p.hex) taken.add(hexKey(p.hex))
  const zones = tackleZoneMap(state, player.team)
  const zonesOn = (hex: Hex) => zones.get(hexKey(hex)) ?? 0
  const onLeaving = dodgesOnLeaving(state)
  const { disengageCost } = state.config.movement

  const labels = new Map<string, Label[]>()
  // Cheapest first, then fewest Dodges, then first found.
  const queue = new LabelQueue()
  queue.push(start)
  const consider = (key: string, candidate: Label) => {
    const existing = labels.get(key) ?? []
    if (existing.some((l) => dominates(l, candidate))) return
    labels.set(key, [...existing.filter((l) => !dominates(candidate, l)), candidate])
    queue.push(candidate)
  }
  while (queue.size > 0) {
    const label = queue.pop()
    if (label.stops) continue
    const marked = zonesOn(label.hex) > 0
    const disengage = marked && !(label.freeLeave && hexEquals(label.freeLeave, label.hex))
    const stepCostHere = 1 + (disengage ? disengageCost : 0)
    for (const next of neighbours(label.hex)) {
      const key = hexKey(next)
      if (!onPitch(next) || taken.has(key)) continue
      const cost = label.cost + stepCostHere + pickUpCost(state, next)
      if (cost > max) continue
      const step = label.path.length
      const sprint = cost > player.ma
      const base = {
        hex: next,
        cost,
        path: [...label.path, next],
        disengages: label.disengages + (disengage ? 1 : 0),
        sprint,
        standUp,
        dodgeSteps: label.dodgeSteps,
        sprintFrom: label.sprintFrom >= 0 ? label.sprintFrom : sprint ? step : -1,
      }
      const dodged = label.dodgeSteps | (1 << step)
      const leapt = label.leapt
      const candidates: Label[] = []
      if (onLeaving) {
        candidates.push({
          ...base,
          disengages: label.disengages,
          dodges: label.dodges + (marked ? 1 : 0),
          dodgeSteps: marked ? dodged : label.dodgeSteps,
          stops: false,
          freeLeave: null,
          leapt,
        })
        if (marked && label === start && canStrengthDisengage(state, player, activation, next)) {
          candidates.push({ ...base, disengages: 1, dodges: label.dodges, stops: true, freeLeave: null, leapt })
        }
      } else if (zonesOn(next) > 0) {
        candidates.push({ ...base, dodges: label.dodges, stops: true, freeLeave: null, leapt })
        // Dodging only helps if there's MA left to keep going.
        if (cost < max) candidates.push({ ...base, dodges: label.dodges + 1, dodgeSteps: dodged, stops: false, freeLeave: next, leapt })
      } else {
        candidates.push({ ...base, dodges: label.dodges, stops: false, freeLeave: null, leapt })
      }
      for (const candidate of candidates) consider(key, candidate)
    }
    // A Leap from here (v19, only when asked): to any hex 1 or 2 away, no Dodge or Disengage, one roll.
    if (!label.leapt) {
      for (const land of leapLandings(label.hex)) {
        const key = hexKey(land)
        if (taken.has(key)) continue
        const cost = label.cost + LEAP_COST + pickUpCost(state, land)
        if (cost > max) continue
        const step = label.path.length
        const sprint = cost > player.ma
        consider(key, {
          hex: land,
          cost,
          path: [...label.path, land],
          disengages: label.disengages,
          dodges: label.dodges + 1,
          sprint,
          standUp,
          dodgeSteps: label.dodgeSteps,
          sprintFrom: label.sprintFrom >= 0 ? label.sprintFrom : sprint ? step : -1,
          leapStep: step,
          // Landing in a tackle zone stops the move where entering one does (v10).
          stops: !onLeaving && zonesOn(land) > 0,
          freeLeave: null,
          leapt: true,
        })
      }
    }
  }

  const best = (ls: Label[]) =>
    [...ls].sort((a, b) => a.dodges - b.dodges || a.cost - b.cost || Number(a.stops) - Number(b.stops))[0]!
  return [...labels.values()].map((ls) => {
    const { freeLeave: _, leapt: __, ...reach } = best(ls)
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
  if (mayLeap(player, activation)) {
    for (const to of leapLandings(player.hex)) {
      if (occupied(state, to) || activation.maUsed + LEAP_COST + pickUpCost(state, to) > max) continue
      options.push({ command: { type: 'leap', to }, available: true })
    }
  }
  return options
}

/** Roll the Dodge into `to`, where the player now stands; a failure can be re-rolled with Momentum. */
function dodgeRoll(ctx: RuleContext, player: Player, to: Hex): void {
  const event = ctx.test('Dodge', player.ag, dodgeModifiers(ctx.state, to, player))
  if (event.success) {
    ctx.state.activation!.freeLeave = to
    return pickUp(ctx, player.id)
  }
  if (!offerReroll(ctx, { kind: 'movement.dodge', team: player.team, failed: event, data: { playerId: player.id } })) {
    fall(ctx, player.id)
  }
}

/** After a Leap lands: entering a tackle zone stops the move where it does (v10); then any loose ball here. */
function landed(ctx: RuleContext, player: Player): void {
  if (!dodgesOnLeaving(ctx.state) && enemyTackleZones(ctx.state, player.hex!, player.team) > 0) ctx.state.activation!.stopped = true
  pickUp(ctx, player.id)
}

/** A failed Dodge (or Leap) that stands: the player falls in the hex and the activation ends. */
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

    leap(ctx, { to }) {
      const { state } = ctx
      const activation = state.activation!
      const player = state.players[activation.playerId]!
      const from = player.hex!
      activation.moved = true
      activation.leapt = true
      activation.maUsed += LEAP_COST + pickUpCost(state, to)
      activation.freeLeave = null
      player.hex = to
      if (state.ball.carrier === player.id) state.ball.hex = to
      ctx.emit({ type: 'moved', playerId: player.id, path: [from, to] })
      if (activation.maUsed > player.ma && !player.winded) {
        player.winded = true
        ctx.emit({ type: 'winded', playerId: player.id })
      }
      const event = ctx.test('Leap', player.ag, [])
      if (event.success) return landed(ctx, player)
      if (!offerReroll(ctx, { kind: 'movement.leap', team: player.team, failed: event, data: { playerId: player.id } })) fall(ctx, player.id)
    },
  },

  decisions: {
    'movement.leap'(ctx, pending, choice) {
      const { event, data } = resolveReroll(ctx, pending, choice)
      const player = ctx.state.players[(data as { playerId: string }).playerId]!
      if (event.success) landed(ctx, player)
      else fall(ctx, player.id)
    },

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
    if (command.type === 'leap') {
      const player = activePlayer(state)
      return player ? { test: 'Leap', target: player.ag, modifiers: [], chance: successChance(player.ag, []) } : null
    }
    if (command.type !== 'move' || !command.dodge) return null
    const player = activePlayer(state)
    if (!player) return null
    const modifiers = dodgeModifiers(state, command.to, player)
    return { test: 'Dodge', target: player.ag, modifiers, chance: successChance(player.ag, modifiers) }
  },
}
