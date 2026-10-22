import { type Modifier, type RolledEvent, successChance } from '../dice'
import type { RuleContext, RuleModule } from '../engine'
import { allPitchHexes, distance, type Hex, hexEquals, line } from '../hex'
import type { CommandOption, GameState, Player, RollPreview } from '../state'
import { ballArrives, bounceBall, scatterBall } from './ball'
import { offerReroll, resolveReroll } from './momentum'
import { endActivation } from './round'
import { enemyTackleZones } from './zones'

// Pick-up, pass, hand-off and interception (RULES.md §7).
//
// - Pick-up: stepping onto a loose ball costs 1 extra MA (movement.ts adds it)
//   and happens after any Dodge, even if the step ends the move. Unmarked it's
//   automatic; marked it's AG at −1 per enemy tackle zone. A failure bounces
//   the ball and ends the activation.
// - Pass: to a hex within range. Opponents standing on the line between the
//   centres may intercept first (the defending coach picks one when there's a
//   choice): AG at −3 and −1 per enemy tackle zone. Then the throw: AG plus the
//   range band, −1 per enemy tackle zone on the thrower. A natural 1 or a
//   modified result at or below 1 is a fumble: the ball bounces from the
//   thrower. Any other failure scatters 3 times from the target. A success
//   lands on the target, an accurate pass.
// - Hand-off: to an adjacent standing teammate, no throw roll, then a catch.
//
// Passing or handing off ends the activation. It's a failed one (giving the
// opponent a double activation) after a fumble, an interception, a failed
// throw, or the throwing team dropping a catch.
//
// RULES.md lists the interception after the throw; this follows Blood Bowl,
// where it comes first.

function tackleZoneModifier(state: GameState, player: Player, perZone: number, label = 'tackle zone'): Modifier[] {
  const zones = enemyTackleZones(state, player.hex!, player.team)
  if (zones === 0) return []
  return [{ name: `${zones} ${label}${zones > 1 ? 's' : ''}`, value: zones * perZone }]
}

function ballLooseAt(state: GameState, hex: Hex): boolean {
  return state.ball.carrier === null && state.ball.hex !== null && hexEquals(state.ball.hex, hex)
}

// ——— Pick-up ———

/** Extra MA for stepping onto the ball, used by movement. */
export function pickUpCost(state: GameState, hex: Hex): number {
  return ballLooseAt(state, hex) ? state.config.ball.pickUpCost : 0
}

/** Pick up the ball if it's loose in the player's hex. Called by movement after a step. */
export function pickUp(ctx: RuleContext, playerId: string): void {
  const { state } = ctx
  const player = state.players[playerId]!
  if (!player.hex || !ballLooseAt(state, player.hex)) return
  const modifiers = tackleZoneModifier(state, player, state.config.ball.pickUpModifierPerTackleZone)
  if (modifiers.length > 0) {
    const event = ctx.test('Pick-up', player.ag, modifiers)
    if (!event.success) {
      if (!offerReroll(ctx, { kind: 'passing.pickUp', team: player.team, failed: event, data: { playerId } })) {
        pickUpFailed(ctx, player)
      }
      return
    }
  }
  pickedUp(ctx, player)
}

function pickedUp(ctx: RuleContext, player: Player): void {
  ctx.state.ball = { hex: player.hex, carrier: player.id }
  ctx.emit({ type: 'pickedUp', playerId: player.id })
}

function pickUpFailed(ctx: RuleContext, player: Player): void {
  bounceBall(ctx, player.hex!, { kind: 'endActivation', failed: true })
}

// ——— Pass ———

type PassData = { throwerId: string; target: Hex }

export function passBand(state: GameState, range: number) {
  return state.config.ball.passBands.find((band) => range <= band.maxRange) ?? null
}

function throwModifiers(state: GameState, thrower: Player, target: Hex): Modifier[] {
  const band = passBand(state, distance(thrower.hex!, target))!
  const modifiers: Modifier[] = band.modifier !== 0 ? [{ name: band.name, value: band.modifier }] : []
  return [...modifiers, ...tackleZoneModifier(state, thrower, state.config.ball.passModifierPerTackleZone)]
}

/** Opponents who could intercept a pass to this hex: standing on the line, not at either end (FR-17). */
export function possibleInterceptors(state: GameState, thrower: Player, target: Hex): Player[] {
  const crossed = line(thrower.hex!, target).filter((h) => !hexEquals(h, thrower.hex!) && !hexEquals(h, target))
  return Object.values(state.players).filter(
    (p) => p.team !== thrower.team && p.status === 'standing' && p.hex && crossed.some((h) => hexEquals(h, p.hex!)),
  )
}

function interceptModifiers(state: GameState, interceptor: Player): Modifier[] {
  return [
    { name: 'Interception', value: state.config.ball.interceptionModifier },
    ...tackleZoneModifier(state, interceptor, state.config.ball.interceptionModifierPerTackleZone),
  ]
}

function carrierWithAction(state: GameState, action: 'pass' | 'handOff'): Player | null {
  const a = state.activation
  if (state.phase !== 'Activation' || !a || state.pending || a.action !== action) return null
  const player = state.players[a.playerId]!
  if (player.status !== 'standing' || state.ball.carrier !== player.id) return null
  return player
}

function intercept(ctx: RuleContext, data: PassData, interceptorId: string): void {
  const interceptor = ctx.state.players[interceptorId]!
  const event = ctx.test('Interception', interceptor.ag, interceptModifiers(ctx.state, interceptor))
  if (event.success) return intercepted(ctx, interceptor)
  if (!offerReroll(ctx, { kind: 'passing.intercept', team: interceptor.team, failed: event, data: { ...data, interceptorId } })) {
    throwBall(ctx, data)
  }
}

function intercepted(ctx: RuleContext, interceptor: Player): void {
  ctx.state.ball = { hex: interceptor.hex, carrier: interceptor.id }
  ctx.emit({ type: 'intercepted', playerId: interceptor.id })
  endActivation(ctx, { failed: true })
}

function isFumble(state: GameState, event: RolledEvent): boolean {
  const modified = event.natural + event.modifiers.reduce((sum, m) => sum + m.value, 0)
  return event.natural === 1 || modified <= state.config.ball.fumbleAtOrBelow
}

function throwBall(ctx: RuleContext, data: PassData): void {
  const thrower = ctx.state.players[data.throwerId]!
  const event = ctx.test('Pass', thrower.ag, throwModifiers(ctx.state, thrower, data.target))
  if (event.success && !isFumble(ctx.state, event)) return landPass(ctx, data, event)
  if (!offerReroll(ctx, { kind: 'passing.throw', team: thrower.team, failed: event, data })) landPass(ctx, data, event)
}

function landPass(ctx: RuleContext, data: PassData, event: RolledEvent): void {
  const { state } = ctx
  const thrower = state.players[data.throwerId]!
  if (isFumble(state, event)) {
    ctx.emit({ type: 'fumbled', playerId: thrower.id })
    return bounceBall(ctx, thrower.hex!, { kind: 'endActivation', failed: true })
  }
  // The ball leaves the thrower's hands.
  state.ball = { hex: thrower.hex, carrier: null }
  if (event.success) return ballArrives(ctx, data.target, { kind: 'endActivation', failed: false }, { accurate: true })
  scatterBall(ctx, data.target, state.config.ball.failedPassScatters, { kind: 'endActivation', failed: true })
}

export const passing: RuleModule = {
  name: 'passing',

  options(state) {
    const options: CommandOption[] = []
    const thrower = carrierWithAction(state, 'pass')
    if (thrower) {
      const longest = state.config.ball.passBands.at(-1)!.maxRange
      for (const hex of allPitchHexes()) {
        const range = distance(thrower.hex!, hex)
        if (range >= 1 && range <= longest) options.push({ command: { type: 'pass', target: hex }, available: true })
      }
    }
    const giver = carrierWithAction(state, 'handOff')
    if (giver) {
      for (const p of Object.values(state.players)) {
        if (p.team === giver.team && p.id !== giver.id && p.status === 'standing' && p.hex && distance(p.hex, giver.hex!) === 1) {
          options.push({ command: { type: 'handOff', targetId: p.id }, available: true })
        }
      }
    }
    return options
  },

  commands: {
    pass(ctx, { target }) {
      const { state } = ctx
      const thrower = state.players[state.activation!.playerId]!
      ctx.emit({ type: 'passed', playerId: thrower.id, target })
      const data: PassData = { throwerId: thrower.id, target }
      const candidates = possibleInterceptors(state, thrower, target)
      if (candidates.length === 0) return throwBall(ctx, data)
      if (candidates.length === 1) return intercept(ctx, data, candidates[0]!.id)
      ctx.ask({
        kind: 'passing.chooseInterceptor',
        team: candidates[0]!.team,
        prompt: 'Who tries to intercept?',
        choices: candidates.map((p) => ({ id: p.id, label: p.id, hex: p.hex! })),
        data,
      })
    },

    handOff(ctx, { targetId }) {
      const { state } = ctx
      const giver = state.players[state.activation!.playerId]!
      const receiver = state.players[targetId]!
      ctx.emit({ type: 'handedOff', playerId: giver.id, toId: receiver.id })
      state.ball = { hex: giver.hex, carrier: null }
      ballArrives(ctx, receiver.hex!, { kind: 'endActivation', failed: false }, { accurate: true })
    },
  },

  decisions: {
    'passing.chooseInterceptor'(ctx, pending, choice) {
      intercept(ctx, pending.data as PassData, choice.id)
    },

    'passing.intercept'(ctx, pending, choice) {
      const { event, data } = resolveReroll(ctx, pending, choice)
      const { interceptorId, ...pass } = data as PassData & { interceptorId: string }
      if (event.success) intercepted(ctx, ctx.state.players[interceptorId]!)
      else throwBall(ctx, pass)
    },

    'passing.throw'(ctx, pending, choice) {
      const { event, data } = resolveReroll(ctx, pending, choice)
      landPass(ctx, data as PassData, event)
    },

    'passing.pickUp'(ctx, pending, choice) {
      const { event, data } = resolveReroll(ctx, pending, choice)
      const player = ctx.state.players[(data as { playerId: string }).playerId]!
      if (event.success) pickedUp(ctx, player)
      else pickUpFailed(ctx, player)
    },
  },

  preview(state, command): RollPreview | null {
    if (command.type === 'pass') {
      const thrower = carrierWithAction(state, 'pass')
      if (!thrower) return null
      const modifiers = throwModifiers(state, thrower, command.target)
      return { test: 'Pass', target: thrower.ag, modifiers, chance: successChance(thrower.ag, modifiers) }
    }
    if (command.type === 'handOff') {
      const receiver = state.players[command.targetId]
      if (!receiver?.hex) return null
      const modifiers = tackleZoneModifier(state, receiver, state.config.ball.catchModifierPerTackleZone)
      if (modifiers.length === 0) return null
      return { test: 'Catch', target: receiver.ag, modifiers, chance: successChance(receiver.ag, modifiers) }
    }
    if (command.type === 'move' && state.activation && ballLooseAt(state, command.to)) {
      // Stepping onto a marked ball: the pick-up roll, judged from the hex the player arrives in.
      const mover = state.players[state.activation.playerId]!
      const zones = enemyTackleZones(state, command.to, mover.team)
      if (zones === 0) return null
      const modifiers = [{ name: `${zones} tackle zone${zones > 1 ? 's' : ''}`, value: zones * state.config.ball.pickUpModifierPerTackleZone }]
      return { test: 'Pick-up', target: mover.ag, modifiers, chance: successChance(mover.ag, modifiers) }
    }
    return null
  },
}
