import { type Modifier, successChance } from '../dice'
import type { RuleContext, RuleModule } from '../engine'
import { distance, type Hex, hexEquals, hexKey, onPitch, pushHexes } from '../hex'
import type { CommandOption, DecisionChoice, GameState, PendingDecision, Player, RollPreview } from '../state'
import { type BallFollowUp, bounceBall, runFollowUp } from './ball'
import { knockDown, pushedIntoCrowd } from './injury'
import { offerReroll, resolveReroll } from './momentum'
import { maxMovement } from './movement'
import { endActivation } from './round'
import { hasSkill } from './skills'
import { blockTotals, countAssists } from './zones'

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
// Skills (v12 rosters): Block is +1 to its side on a Tackle when that side has
// no assists (with blocking.blockSkillWithAssists, v13: whatever the assists);
// it does nothing for a Shove and doesn't save a natural 1. Brace:
// a blocked defender who hasn't activated this round may Brace before the
// attacker picks Shove or Tackle, for +1 to his total; he then counts as
// activated. With blocking.missedTackleChoice (v12), on a missed Tackle that
// isn't a natural 1 the defending coach chooses both down (a failure for the
// attacker) or nothing happens.
//
// Pushes go to one of the 3 hexes on the far side of the defender, the
// attacker's choice. Calls where RULES.md is less specific, following Blood
// Bowl's order: an empty push hex first; with none, off the pitch if one is
// off it (the crowd); otherwise a chain push into an occupied hex, whose
// player is pushed on in turn. If a push can't go anywhere (a Shove without
// the margin at the touchline, with no one to chain-push) nobody moves, and a
// Blitz ends as after a Shove that's too weak. A
// player pushed onto a loose ball makes it bounce. Then the attacker may follow
// up into the vacated hex for free, ignoring tackle zones. In v11
// (blocking.followUpBeforeBall) the follow-up is asked straight after the
// pushes, and the knock-down, injuries and loose ball come after it.
//
// A player pushed into the crowd moves to the hex just off the pitch, in the
// push direction, until the crowd injury takes him off (with the ball, if he
// carries it). So while the v11 follow-up question is open, he doesn't share
// his old edge hex with a player chain-pushed into it. Off the pitch he exerts
// no tackle zone.

type BlockData = {
  attackerId: string
  defenderId: string
  /** Strength totals, ST plus assists, plus Brace for the defender. These decide the Shove. */
  attack: number
  defence: number
  /** Block skill bonuses for the Tackle: the player has Block and his side has no assists. */
  attackerBlock?: boolean
  defenderBlock?: boolean
}

/** One push in progress: who is being pushed, and from where. */
type PushStep = { victimId: string; pusher: Hex }

type PushJob = {
  block: BlockData
  tackle: boolean
  allowCrowd: boolean
  /** Pushes still to resolve, innermost last. */
  stack: PushStep[]
  /** Chosen moves in the order they were chosen; null `to` is the crowd, and `crowd` the hex just off the pitch he waits on. */
  moves: { playerId: string; from: Hex; to: Hex | null; crowd?: Hex }[]
}

function playerAt(state: GameState, hex: Hex): Player | null {
  return Object.values(state.players).find((p) => p.hex !== null && hexEquals(p.hex, hex)) ?? null
}


type BlockSkills = { attackerBlock?: boolean; defenderBlock?: boolean }

function tackleModifiers(state: GameState, attack: number, defence: number, skills: BlockSkills): Modifier[] {
  const modifiers: Modifier[] = []
  const diff = attack - defence
  if (diff !== 0) modifiers.push({ name: 'Strength difference', value: diff * state.config.blocking.tackleModifierPerStrengthPoint })
  if (skills.attackerBlock) modifiers.push({ name: 'Block', value: 1 })
  if (skills.defenderBlock) modifiers.push({ name: "Defender's Block", value: -1 })
  return modifiers
}

export function tacklePreview(state: GameState, attack: number, defence: number, skills: BlockSkills = {}): RollPreview {
  const target = state.config.blocking.tackleTarget
  const modifiers = tackleModifiers(state, attack, defence, skills)
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
    job.moves.push({ playerId: victim.id, from: victim.hex!, to: null, crowd: crowdHex(step.pusher, victim.hex!) })
    return
  }
  const to = choice.hex!
  job.moves.push({ playerId: victim.id, from: victim.hex!, to })
  const occupant = playerAt(state, to)
  if (occupant) job.stack.push({ victimId: occupant.id, pusher: victim.hex! })
}

/** The off-pitch hex a crowd push goes to: straight on if that's off the pitch, else the first push hex that is. */
function crowdHex(pusher: Hex, victim: Hex): Hex {
  const straight = { q: 2 * victim.q - pusher.q, r: 2 * victim.r - pusher.r }
  if (!onPitch(straight)) return straight
  return pushHexes(pusher, victim).find((h) => !onPitch(h))!
}

function finishPush(ctx: RuleContext, job: PushJob): void {
  const { state } = ctx
  const { attackerId, defenderId } = job.block
  const attacker = state.players[attackerId]!

  // Move everyone, innermost of the chain first. Crowd-pushed players wait
  // just off the pitch until their injury roll takes them off.
  for (const move of [...job.moves].reverse()) {
    ctx.emit({ type: 'pushed', playerId: move.playerId, from: move.from, to: move.to })
    const hex = move.to ?? move.crowd
    if (!hex) continue
    const player = state.players[move.playerId]!
    player.hex = hex
    if (state.ball.carrier === player.id) state.ball.hex = hex
  }

  const defenderMove = job.moves.find((m) => m.playerId === defenderId)
  const vacated = defenderMove?.from ?? null
  const canFollow = vacated !== null && attacker.status === 'standing'
  // v11: the follow-up comes first; the knock-down, injuries and ball once it's answered.
  if (canFollow && state.config.blocking.followUpBeforeBall) return ctx.ask(followUpDecision(attacker, vacated, job.block, job))
  const then: BallFollowUp = canFollow
    ? { kind: 'ask', decision: followUpDecision(attacker, vacated, job.block, null) }
    : afterBlockFollowUp(state, job)
  resolveAftermath(ctx, job, then)
}

/** After the block: a Block action is over, and so is a Blitz whose Shove moved nobody. */
function afterBlockFollowUp(state: GameState, job: PushJob): BallFollowUp {
  // A Shove that moved nobody isn't a success, so even a Blitz is over.
  const pushedNobody = !job.tackle && job.moves.length === 0
  return state.activation!.action === 'block' || pushedNobody
    ? { kind: 'endActivation', failed: false }
    : { kind: 'endActivationIfDropped' }
}

/** The knock-down, crowd injuries and loose ball after the pushes, then `then`. */
function resolveAftermath(ctx: RuleContext, job: PushJob, then: BallFollowUp): void {
  const { state } = ctx
  const { defenderId } = job.block
  // Injuries without the ball first; whatever moves the ball goes last, with `then`.
  const crowdMoves = job.moves.filter((m) => m.to === null)
  const crowd = crowdMoves.map((m) => m.playerId)
  // The throw-in comes from the edge hex the player was pushed off.
  const edge = (id: string) => crowdMoves.find((m) => m.playerId === id)!.from
  const carrier = state.ball.carrier
  for (const id of crowd) if (id !== carrier) pushedIntoCrowd(ctx, id, edge(id), { kind: 'none' })
  const defenderDown = job.tackle && !crowd.includes(defenderId)
  // A defender falling with the ball, or onto a loose one, makes it bounce: that goes last, with `then`.
  const defenderHex = state.players[defenderId]!.hex
  const onLooseBall = carrier === null && state.ball.hex !== null && defenderHex !== null && hexEquals(defenderHex, state.ball.hex)
  const fallsWithBall = defenderDown && (carrier === defenderId || onLooseBall)
  const attacker = state.players[job.block.attackerId]!
  if (defenderDown && !fallsWithBall) knockDown(ctx, defenderId, { kind: 'none' }, attacker)

  if (carrier && crowd.includes(carrier)) return pushedIntoCrowd(ctx, carrier, edge(carrier), then)
  if (fallsWithBall) return knockDown(ctx, defenderId, then, attacker)
  const loose = state.ball.carrier === null && state.ball.hex
  if (loose && job.moves.some((m) => m.to && hexEquals(m.to, state.ball.hex!))) {
    return bounceBall(ctx, state.ball.hex!, then)
  }
  runFollowUp(ctx, then)
}

/** `job` is set when the aftermath still has to be resolved once the follow-up is answered (v11). */
type FollowUpData = { block: BlockData; job: PushJob | null }

function followUpDecision(attacker: Player, vacated: Hex, block: BlockData, job: PushJob | null): PendingDecision {
  return {
    kind: 'blocking.followUp',
    team: attacker.team,
    prompt: 'Follow up into the empty hex?',
    choices: [
      { id: 'follow', label: 'Follow up', hex: vacated },
      { id: 'stay', label: 'Stay' },
    ],
    data: { block, job } satisfies FollowUpData,
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

/**
 * A natural 1 knocks the attacker down, a failure. Any other miss ends the
 * activation as a failure, unless blocking.missedTackleIsFailure is false
 * (v11): then nothing happens, the opponent gets no double activation, and a
 * Blitzer may keep moving.
 */
function tackleFailed(ctx: RuleContext, block: BlockData, natural: number): void {
  if (natural === 1) return knockDown(ctx, block.attackerId, { kind: 'endActivation', failed: true })
  const { blocking: rules } = ctx.state.config
  if (rules.missedTackleIsFailure !== false) return endActivation(ctx, { failed: true })
  if (rules.missedTackleChoice) {
    return ctx.ask({
      kind: 'blocking.missChoice',
      team: ctx.state.players[block.defenderId]!.team,
      prompt: 'The Tackle missed. Both down, or nothing happens?',
      choices: [
        { id: 'bothDown', label: 'Both down' },
        { id: 'nothing', label: 'Nothing happens' },
      ],
      data: block,
    })
  }
  missedNothing(ctx)
}

/** The totals and Block skill bonuses of a block about to be declared. */
function blockData(state: GameState, attacker: Player, defender: Player): BlockData {
  const { attack, defence } = blockTotals(state, attacker, defender, { block: true })
  const withAssists = state.config.blocking.blockSkillWithAssists === true
  return {
    attackerId: attacker.id,
    defenderId: defender.id,
    attack,
    defence,
    attackerBlock: hasSkill(attacker, 'Block') && (withAssists || countAssists(state, attacker, defender, { block: true }) === 0),
    defenderBlock: hasSkill(defender, 'Block') && (withAssists || countAssists(state, defender, attacker, { block: true }) === 0),
  }
}

/** A blocked defender may Brace if he has the skill and hasn't activated this round. */
function canBrace(defender: Player): boolean {
  return hasSkill(defender, 'Brace') && !defender.activatedThisRound
}

/** The odds of a block with given totals: the Tackle's chance, and whether a Shove is offered. */
export type BlockOdds = { attack: number; defence: number; tackle: RollPreview; canShove: boolean }

/**
 * The odds of blocking `targetId` with the active player, before the block is
 * declared (#180), or null if he can't block him. `braced` is the same after
 * the defender Braces, when he still can. Declaring rolls nothing, so the
 * engine's roll preview (which the computer's search reads) stays empty.
 */
export function previewBlock(state: GameState, targetId: string): (BlockOdds & { braced: BlockOdds | null }) | null {
  const attacker = blocker(state)
  const defender = state.players[targetId]
  if (!attacker || !defender || !targets(state, attacker).includes(defender)) return null
  const data = blockData(state, attacker, defender)
  const odds = (defence: number): BlockOdds => ({
    attack: data.attack,
    defence,
    tackle: tacklePreview(state, data.attack, defence, data),
    canShove: !(state.config.blocking.shoveNeedsEqualStrength === true && data.attack < defence),
  })
  return { ...odds(data.defence), braced: canBrace(defender) ? odds(data.defence + 1) : null }
}

/** Ask the attacker for Shove or Tackle, with the totals after any Brace. */
function askShoveOrTackle(ctx: RuleContext, data: BlockData): void {
  const { attack, defence } = data
  const chance = Math.round(tacklePreview(ctx.state, attack, defence, data).chance * 100)
  const tackleChoice = { id: 'tackle', label: `Tackle (${chance}%)` }
  // v11: no Shove for a weaker attacker, only the Tackle.
  const noShove = ctx.state.config.blocking.shoveNeedsEqualStrength === true && attack < defence
  ctx.ask({
    kind: 'blocking.shoveOrTackle',
    team: ctx.state.players[data.attackerId]!.team,
    prompt: noShove
      ? `Your total ${attack} against ${defence}: too weak to Shove. Tackle?`
      : `Your total ${attack} against ${defence}. Shove or Tackle?`,
    choices: noShove ? [tackleChoice] : [{ id: 'shove', label: shoveLabel(ctx.state, data) }, tackleChoice],
    data,
  })
}

/**
 * Both down after a missed Tackle (v12): both players are Knocked Down where
 * they stand, and the attacker's activation ends as a failure. The player
 * with the ball, if either, falls last, so the ball's bounce ends the chain.
 */
function bothDown(ctx: RuleContext, block: BlockData): void {
  const carrierIsAttacker = ctx.state.ball.carrier === block.attackerId
  const [first, last] = carrierIsAttacker ? [block.defenderId, block.attackerId] : [block.attackerId, block.defenderId]
  // Only the defender's fall is the attacker's doing, for Crushing Blow (v22).
  const by = (id: string) => (id === block.defenderId ? ctx.state.players[block.attackerId]! : null)
  knockDown(ctx, first, { kind: 'none' }, by(first))
  knockDown(ctx, last, { kind: 'endActivation', failed: true }, by(last))
}

/** A missed Tackle where nothing happens: a Block is over, a Blitzer may keep moving. */
function missedNothing(ctx: RuleContext): void {
  if (ctx.state.activation!.action === 'blitz') {
    ctx.state.activation!.stopped = false
    return
  }
  endActivation(ctx, { failed: false })
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

      const data = blockData(state, attacker, defender)
      const { attack, defence } = data
      ctx.emit({ type: 'blockDeclared', attackerId: attacker.id, defenderId: defender.id, attack, defence })
      if (canBrace(defender)) {
        return ctx.ask({
          kind: 'blocking.brace',
          team: defender.team,
          prompt: `Brace? +1 to his total (${defence} → ${defence + 1}), and he counts as activated this round.`,
          choices: [
            { id: 'brace', label: 'Brace (+1)' },
            { id: 'no', label: "Don't brace" },
          ],
          data,
        })
      }
      askShoveOrTackle(ctx, data)
    },
  },

  decisions: {
    'blocking.brace'(ctx, pending, choice) {
      const block = { ...(pending.data as BlockData) }
      if (choice.id === 'brace') {
        ctx.state.players[block.defenderId]!.activatedThisRound = true
        block.defence += 1
        ctx.emit({ type: 'braced', playerId: block.defenderId })
      }
      askShoveOrTackle(ctx, block)
    },

    'blocking.missChoice'(ctx, pending, choice) {
      const block = pending.data as BlockData
      const both = choice.id === 'bothDown'
      ctx.emit({ type: 'tackleMissChosen', team: pending.team, choice: both ? 'bothDown' : 'nothing' })
      if (both) bothDown(ctx, block)
      else missedNothing(ctx)
    },

    'blocking.shoveOrTackle'(ctx, pending, choice) {
      const block = pending.data as BlockData
      const tackle = choice.id === 'tackle'
      ctx.emit({ type: 'blockChosen', attackerId: block.attackerId, choice: tackle ? 'tackle' : 'shove' })

      if (!tackle) {
        if (block.attack >= block.defence) return startPush(ctx, block, false)
        // Too weak: nothing happens. That isn't a success, so even a Blitz is over.
        return endActivation(ctx, { failed: false })
      }

      const { target, modifiers } = tacklePreview(ctx.state, block.attack, block.defence, block)
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
      const { block, job } = pending.data as FollowUpData
      if (choice.id === 'follow') {
        const attacker = ctx.state.players[block.attackerId]!
        attacker.hex = choice.hex!
        if (ctx.state.ball.carrier === attacker.id) ctx.state.ball.hex = choice.hex!
        ctx.emit({ type: 'followedUp', playerId: attacker.id, to: choice.hex! })
      }
      if (job) return resolveAftermath(ctx, job, afterBlockFollowUp(ctx.state, job))
      afterBlock(ctx)
    },
  },

  // Declaring a block rolls nothing; the Tackle odds belong to the Tackle choice.
  preview(state, command) {
    if (command.type === 'decide' && command.choice === 'tackle' && state.pending?.kind === 'blocking.shoveOrTackle') {
      const block = state.pending.data as BlockData
      return tacklePreview(state, block.attack, block.defence, block)
    }
    return null
  },
}
