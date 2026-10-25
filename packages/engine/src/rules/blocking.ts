import { type Modifier, successChance } from '../dice'
import type { RuleContext, RuleModule } from '../engine'
import { distance, type Hex, hexEquals, hexKey, onPitch, pushHexes } from '../hex'
import type { CommandOption, DecisionChoice, GameState, PendingDecision, Player, RollPreview } from '../state'
import { type BallFollowUp, bounceBall, runFollowUp } from './ball'
import { knockDown, pushedIntoCrowd } from './injury'
import { offerReroll, resolveReroll } from './momentum'
import { maxMovement } from './movement'
import { endActivation } from './round'
import { blockTotals } from './zones'

// Blocking (RULES.md §5).
//
// A Block hits one adjacent standing opponent; a Blitz moves, blocks for 1 hex
// of MA, and after a successful Shove or Tackle can keep moving. Each side
// adds ST and assists, both totals are shown, and the attacker picks:
// - Shove: no roll. Attacker total ≥ defender total pushes the defender 1 hex;
//   lower, nothing happens. Off the pitch only with a margin of at least 2.
// - Tackle: D10 6+, ±1 per point of difference. Success pushes the defender
//   and knocks them down; failure ends the activation; a natural 1 knocks the
//   attacker down instead. A failed Tackle can be re-rolled with Momentum.
//
// With blocking.shoveNeedsEqualStrength (v11), a Shove is only offered when
// the attacker's total is at least the defender's.
//
// Pushes go to one of the 3 hexes on the far side of the defender, the
// attacker's choice. Calls where RULES.md is less specific, following Blood
// Bowl's order: an empty push hex first; with none, off the pitch if one is
// off it (the crowd); otherwise a chain push into an occupied hex, whose
// player is pushed on in turn. If a push can't go anywhere (a Shove without
// the margin at the touchline, with no one to chain-push) nobody moves, and a
// Blitz ends as after a Shove that's too weak. A
// player pushed onto a loose ball makes it bounce. Then the attacker may follow
// up into the vacated hex for free, ignoring tackle zones.

type BlockData = { attackerId: string; defenderId: string; attack: number; defence: number }

/** One push in progress: who is being pushed, and from where. */
type PushStep = { victimId: string; pusher: Hex }

type PushJob = {
  block: BlockData
  tackle: boolean
  allowCrowd: boolean
  /** Pushes still to resolve, innermost last. */
  stack: PushStep[]
  /** Chosen moves in the order they were chosen; null `to` is the crowd. */
  moves: { playerId: string; from: Hex; to: Hex | null }[]
}

function playerAt(state: GameState, hex: Hex): Player | null {
  return Object.values(state.players).find((p) => p.hex !== null && hexEquals(p.hex, hex)) ?? null
}


function tackleModifiers(state: GameState, attack: number, defence: number): Modifier[] {
  const diff = attack - defence
  if (diff === 0) return []
  return [{ name: 'Strength difference', value: diff * state.config.blocking.tackleModifierPerStrengthPoint }]
}

export function tacklePreview(state: GameState, attack: number, defence: number): RollPreview {
  const target = state.config.blocking.tackleTarget
  const modifiers = tackleModifiers(state, attack, defence)
  return { test: 'Tackle', target, modifiers, chance: successChance(target, modifiers) }
}

function blocker(state: GameState): Player | null {
  const a = state.activation
  if (state.phase !== 'Activation' || !a || state.pending || a.blocked) return null
  if (a.action !== 'block' && a.action !== 'blitz') return null
  const player = state.players[a.playerId]!
  if (player.status !== 'standing' || !player.hex) return null
  if (a.action === 'blitz' && a.maUsed + state.config.blocking.blitzBlockCost > maxMovement(state, player)) return null
  return player
}

function targets(state: GameState, attacker: Player): Player[] {
  return Object.values(state.players).filter(
    (p) => p.team !== attacker.team && p.hex !== null && p.status === 'standing' && distance(p.hex, attacker.hex!) === 1,
  )
}

/** What the block's push hexes allow for this victim, given who is where now. */
function pushChoices(state: GameState, job: PushJob, step: PushStep): DecisionChoice[] {
  const victim = state.players[step.victimId]!
  const hexes = pushHexes(step.pusher, victim.hex!)
  // A hex already chosen for someone earlier in the chain is taken.
  const claimed = job.moves.flatMap((m) => (m.to ? [hexKey(m.to)] : []))
  const free = hexes.filter((h) => onPitch(h) && !playerAt(state, h) && !claimed.includes(hexKey(h)))
  if (free.length > 0) return free.map((h) => ({ id: hexKey(h), label: 'Push here', hex: h }))
  if (job.allowCrowd && hexes.some((h) => !onPitch(h))) return [{ id: 'crowd', label: 'Push into the crowd' }]
  const occupied = hexes.filter((h) => onPitch(h) && playerAt(state, h) && !claimed.includes(hexKey(h)))
  return occupied.map((h) => ({ id: hexKey(h), label: 'Chain-push', hex: h }))
}

/** The push a Shove or Tackle starts, before any choice. */
function newPushJob(state: GameState, block: BlockData, tackle: boolean): PushJob {
  const attacker = state.players[block.attackerId]!
  return {
    block,
    tackle,
    allowCrowd: tackle || block.attack - block.defence >= state.config.blocking.shoveCrowdPushMargin,
    stack: [{ victimId: block.defenderId, pusher: attacker.hex! }],
    moves: [],
  }
}

/** Whether some choice of push hexes moves anyone at all. */
function pushCanGoSomewhere(state: GameState, job: PushJob): boolean {
  const step = job.stack.at(-1)
  if (!step) return true
  return pushChoices(state, job, step).some((choice) => {
    const next = { ...job, stack: [...job.stack], moves: [...job.moves] }
    choosePush(state, next, choice)
    return pushCanGoSomewhere(state, next)
  })
}

function shoveLabel(state: GameState, block: BlockData): string {
  if (block.attack < block.defence) return 'Shove (too weak: nothing happens)'
  if (!pushCanGoSomewhere(state, newPushJob(state, block, false))) return 'Shove (nowhere to push: nothing happens)'
  return 'Shove (push, no roll)'
}

/** Resolve the push chain, asking the attacker where each push goes when there's a choice. */
function continuePush(ctx: RuleContext, job: PushJob): void {
  const { state } = ctx
  while (job.stack.length > 0) {
    const step = job.stack.at(-1)!
    const choices = pushChoices(state, job, step)
    if (choices.length === 0) {
      // The push can't go anywhere: nobody moves.
      job.moves = []
      job.stack = []
      break
    }
    if (choices.length > 1) {
      ctx.ask({
        kind: 'blocking.push',
        team: state.players[job.block.attackerId]!.team,
        prompt: 'Where does the push go?',
        choices,
        data: job,
      })
      return
    }
    choosePush(state, job, choices[0]!)
  }
  finishPush(ctx, job)
}

function choosePush(state: GameState, job: PushJob, choice: DecisionChoice): void {
  const step = job.stack.pop()!
  const victim = state.players[step.victimId]!
  if (choice.id === 'crowd') {
    job.moves.push({ playerId: victim.id, from: victim.hex!, to: null })
    return
  }
  const to = choice.hex!
  job.moves.push({ playerId: victim.id, from: victim.hex!, to })
  const occupant = playerAt(state, to)
  if (occupant) job.stack.push({ victimId: occupant.id, pusher: victim.hex! })
}

function finishPush(ctx: RuleContext, job: PushJob): void {
  const { state } = ctx
  const { attackerId, defenderId } = job.block
  const attacker = state.players[attackerId]!

  // Move everyone, innermost of the chain first. Crowd-pushed players stay on
  // their edge hex until their injury roll takes them off.
  for (const move of [...job.moves].reverse()) {
    ctx.emit({ type: 'pushed', playerId: move.playerId, from: move.from, to: move.to })
    if (!move.to) continue
    const player = state.players[move.playerId]!
    player.hex = move.to
    if (state.ball.carrier === player.id) state.ball.hex = move.to
  }

  const defenderMove = job.moves.find((m) => m.playerId === defenderId)
  const vacated = defenderMove?.from ?? null
  // A Shove that moved nobody isn't a success, so even a Blitz is over.
  const pushedNobody = !job.tackle && job.moves.length === 0
  const afterBlock: BallFollowUp =
    state.activation!.action === 'block' || pushedNobody
      ? { kind: 'endActivation', failed: false }
      : { kind: 'endActivationIfDropped' }
  const then: BallFollowUp =
    vacated && attacker.status === 'standing'
      ? { kind: 'ask', decision: followUpDecision(attacker, vacated, job.block) }
      : afterBlock

  // Injuries without the ball first; whatever moves the ball goes last, with `then`.
  const crowd = job.moves.filter((m) => m.to === null).map((m) => m.playerId)
  const carrier = state.ball.carrier
  for (const id of crowd) if (id !== carrier) pushedIntoCrowd(ctx, id, { kind: 'none' })
  const defenderDown = job.tackle && !crowd.includes(defenderId)
  if (defenderDown && carrier !== defenderId) knockDown(ctx, defenderId, { kind: 'none' })

  if (carrier && crowd.includes(carrier)) return pushedIntoCrowd(ctx, carrier, then)
  if (defenderDown && carrier === defenderId) return knockDown(ctx, defenderId, then)
  const loose = state.ball.carrier === null && state.ball.hex
  if (loose && job.moves.some((m) => m.to && hexEquals(m.to, state.ball.hex!))) {
    return bounceBall(ctx, state.ball.hex!, then)
  }
  runFollowUp(ctx, then)
}

function followUpDecision(attacker: Player, vacated: Hex, block: BlockData): PendingDecision {
  return {
    kind: 'blocking.followUp',
    team: attacker.team,
    prompt: 'Follow up into the empty hex?',
    choices: [
      { id: 'follow', label: 'Follow up', hex: vacated },
      { id: 'stay', label: 'Stay' },
    ],
    data: block,
  }
}

/** After the follow-up choice: a Block action is over; a Blitz carries on. */
function afterBlock(ctx: RuleContext): void {
  if (ctx.state.activation?.action === 'block') endActivation(ctx, { failed: false })
}

function startPush(ctx: RuleContext, block: BlockData, tackle: boolean): void {
  const { state } = ctx
  // A successful Shove or Tackle lets a Blitzer keep moving, even from inside a tackle zone.
  state.activation!.stopped = false
  continuePush(ctx, newPushJob(state, block, tackle))
}

function tackleFailed(ctx: RuleContext, block: BlockData, natural: number): void {
  if (natural === 1) knockDown(ctx, block.attackerId, { kind: 'endActivation', failed: true })
  else endActivation(ctx, { failed: true })
}

export const blocking: RuleModule = {
  name: 'blocking',

  options(state) {
    const attacker = blocker(state)
    if (!attacker) return []
    return targets(state, attacker).map((p): CommandOption => ({ command: { type: 'block', targetId: p.id }, available: true }))
  },

  commands: {
    block(ctx, { targetId }) {
      const { state } = ctx
      const activation = state.activation!
      const attacker = state.players[activation.playerId]!
      const defender = state.players[targetId]!
      if (activation.action === 'blitz') activation.maUsed += state.config.blocking.blitzBlockCost
      activation.blocked = true

      const { attack, defence } = blockTotals(state, attacker, defender)
      ctx.emit({ type: 'blockDeclared', attackerId: attacker.id, defenderId: defender.id, attack, defence })
      const chance = Math.round(tacklePreview(state, attack, defence).chance * 100)
      const data: BlockData = { attackerId: attacker.id, defenderId: defender.id, attack, defence }
      const tackleChoice = { id: 'tackle', label: `Tackle (${chance}%)` }
      // v11: no Shove for a weaker attacker, only the Tackle.
      const noShove = state.config.blocking.shoveNeedsEqualStrength === true && attack < defence
      ctx.ask({
        kind: 'blocking.shoveOrTackle',
        team: attacker.team,
        prompt: noShove
          ? `Your total ${attack} against ${defence}: too weak to Shove. Tackle?`
          : `Your total ${attack} against ${defence}. Shove or Tackle?`,
        choices: noShove ? [tackleChoice] : [{ id: 'shove', label: shoveLabel(state, data) }, tackleChoice],
        data,
      })
    },
  },

  decisions: {
    'blocking.shoveOrTackle'(ctx, pending, choice) {
      const block = pending.data as BlockData
      const tackle = choice.id === 'tackle'
      ctx.emit({ type: 'blockChosen', attackerId: block.attackerId, choice: tackle ? 'tackle' : 'shove' })

      if (!tackle) {
        if (block.attack >= block.defence) return startPush(ctx, block, false)
        // Too weak: nothing happens. That isn't a success, so even a Blitz is over.
        return endActivation(ctx, { failed: false })
      }

      const { target, modifiers } = tacklePreview(ctx.state, block.attack, block.defence)
      const event = ctx.test('Tackle', target, modifiers)
      if (event.success) return startPush(ctx, block, true)
      const team = ctx.state.players[block.attackerId]!.team
      if (!offerReroll(ctx, { kind: 'blocking.tackle', team, failed: event, data: block })) {
        tackleFailed(ctx, block, event.natural)
      }
    },

    'blocking.tackle'(ctx, pending, choice) {
      const { event, data } = resolveReroll(ctx, pending, choice)
      const block = data as BlockData
      if (event.success) startPush(ctx, block, true)
      else tackleFailed(ctx, block, event.natural)
    },

    'blocking.push'(ctx, pending, choice) {
      const job = pending.data as PushJob
      choosePush(ctx.state, job, choice)
      continuePush(ctx, job)
    },

    'blocking.followUp'(ctx, pending, choice) {
      const block = pending.data as BlockData
      if (choice.id === 'follow') {
        const attacker = ctx.state.players[block.attackerId]!
        attacker.hex = choice.hex!
        if (ctx.state.ball.carrier === attacker.id) ctx.state.ball.hex = choice.hex!
        ctx.emit({ type: 'followedUp', playerId: attacker.id, to: choice.hex! })
      }
      afterBlock(ctx)
    },
  },

  // Declaring a block rolls nothing; the Tackle odds belong to the Tackle choice.
  preview(state, command) {
    if (command.type === 'decide' && command.choice === 'tackle' && state.pending?.kind === 'blocking.shoveOrTackle') {
      const block = state.pending.data as BlockData
      return tacklePreview(state, block.attack, block.defence)
    }
    return null
  },
}
