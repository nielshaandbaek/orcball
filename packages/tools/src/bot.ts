import {
  type Command,
  createMatch,
  engine,
  type GameEvent,
  type GameState,
  type MatchFile,
  newMatchFile,
  record,
  rollDie,
  type RngState,
  type RuleConfig,
  rulesV10,
  seededRng,
  TEAM_SIDES,
  toColRow,
} from '@orcball/engine'

// A bot that plays both sides with random legal commands, for finding crashes
// and stuck states. Its choices come from its own seeded RNG, separate from
// the match's dice, so a seed reproduces the whole match.
//
// Pure random setup never finishes (it keeps moving the same player around),
// so during setup the bot places a random number of players (1–7) on random
// legal hexes and then ends setup. A ball carrier steps towards the end zone
// it scores in two times out of three, so touchdowns and new drives happen.
// Everything else is a uniform pick.

export type BotResult = {
  seed: number
  file: MatchFile
  state: GameState
  events: GameEvent[]
  commands: number
  /** Why the match didn't finish cleanly, if it didn't. */
  problem: string | null
}

export type BotOptions = {
  config?: RuleConfig
  /** Give up and report a stuck match after this many commands. */
  maxCommands?: number
}

function pick<T>(rng: RngState, items: readonly T[]): { item: T; rng: RngState } {
  const roll = rollDie(rng, Math.max(items.length, 2))
  // rollDie needs 2+ sides; with one item, any roll picks it.
  return { item: items[(roll.value - 1) % items.length]!, rng: roll.rng }
}

function chooseCommand(state: GameState, legal: Command[], rng: RngState, quota: Record<string, number>) {
  if (state.phase === 'Setup' && !state.pending) {
    const team = state.turnOwner
    const placed = Object.values(state.players).filter((p) => p.team === team && p.hex !== null).length
    const end = legal.find((c) => c.type === 'endSetup')
    if (placed >= (quota[team] ?? 7) && end) return { item: end, rng }
    const places = legal.filter((c) => c.type === 'place' && state.players[c.playerId]!.hex === null)
    if (places.length > 0) return pick(rng, places)
    if (end) return { item: end, rng }
  }
  const carrier = state.activation && state.ball.carrier === state.activation.playerId ? state.players[state.ball.carrier]! : null
  const steps = legal.filter((c) => c.type === 'move')
  if (carrier && steps.length > 0) {
    const roll = rollDie(rng, 3)
    if (roll.value <= 2) {
      // Home scores at the high columns, away at column 1.
      const sign = TEAM_SIDES[carrier.team] === 'left' ? 1 : -1
      const forward = (c: Command) => (c.type === 'move' ? sign * toColRow(c.to).col - (c.dodge ? 0.5 : 0) : 0)
      const best = [...steps].sort((a, b) => forward(b) - forward(a))[0]!
      return { item: best, rng: roll.rng }
    }
    rng = roll.rng
  }
  return pick(rng, legal)
}

/** Things that should never be true of a state, whatever the commands. */
export function invariantProblems(state: GameState): string[] {
  const problems: string[] = []
  const seen = new Map<string, string>()
  for (const p of Object.values(state.players)) {
    if (!p.hex) continue
    const key = `${p.hex.q},${p.hex.r}`
    const other = seen.get(key)
    if (other) problems.push(`${p.id} and ${other} share a hex`)
    seen.set(key, p.id)
    if (p.status === 'out' || p.status === 'casualty' || p.status === 'ejected') problems.push(`${p.id} is ${p.status} but on the pitch`)
  }
  for (const team of ['home', 'away'] as const) {
    const onPitch = Object.values(state.players).filter((p) => p.team === team && p.hex).length
    if (onPitch > state.config.match.playersOnPitch) problems.push(`${team} has ${onPitch} players on the pitch`)
  }
  const { ball } = state
  if (ball.carrier) {
    const carrier = state.players[ball.carrier]!
    if (!carrier.hex) problems.push(`${carrier.id} carries the ball off the pitch`)
    else if (!ball.hex || ball.hex.q !== carrier.hex.q || ball.hex.r !== carrier.hex.r) problems.push('the ball is not with its carrier')
    if (carrier.status !== 'standing') problems.push(`${carrier.id} carries the ball while ${carrier.status}`)
  }
  if ((state.phase === 'Round' || state.phase === 'Activation') && !state.pending && !ball.hex && !ball.carrier) {
    problems.push('the ball is nowhere during play')
  }
  if (state.phase === 'Activation' && !state.activation) problems.push('Activation phase with no activation')
  return problems
}

/** Play one match with random commands, recording it, until full time or a problem. */
export function playRandomMatch(seed: number, options: BotOptions = {}): BotResult {
  const config = options.config ?? rulesV10
  const rosters = [config.rosters.orcs ?? Object.values(config.rosters)[0]!, config.rosters.elves ?? Object.values(config.rosters)[0]!] as const
  const maxCommands = options.maxCommands ?? 20_000

  let file = newMatchFile(config, [rosters[0], rosters[1]], seed)
  let state = createMatch(config, [rosters[0], rosters[1]], seed)
  // The bot's own dice, so its choices don't touch the match's.
  let rng: RngState = seededRng(seed ^ 0x5eed)
  const quota: Record<string, number> = {}
  const events: GameEvent[] = []
  let commands = 0

  const result = (problem: string | null): BotResult => ({ seed, file, state, events, commands, problem })

  while (state.phase !== 'FullTime') {
    if (commands >= maxCommands) return result(`stuck: no full time after ${maxCommands} commands (phase ${state.phase})`)
    if (state.phase === 'Setup' && !state.pending && quota[state.turnOwner] === undefined) {
      const roll = rollDie(rng, state.config.match.playersOnPitch)
      quota[state.turnOwner] = roll.value
      rng = roll.rng
    }
    if (state.phase !== 'Setup') for (const k of Object.keys(quota)) delete quota[k]

    const legal = engine.legalCommands(state)
    if (legal.length === 0) return result(`stuck: no legal commands in phase ${state.phase}`)
    const choice = chooseCommand(state, legal, rng, quota)
    rng = choice.rng
    try {
      const step = record(file, state, choice.item, null)
      file = step.file
      state = step.state
      events.push(...step.events)
    } catch (error) {
      return result(`crash on command ${commands + 1} ${JSON.stringify(choice.item)}: ${(error as Error).message}`)
    }
    commands++
    const problems = invariantProblems(state)
    if (problems.length > 0) return result(`illegal state after command ${commands}: ${problems.join('; ')}`)
  }
  return result(null)
}
