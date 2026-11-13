import {
  canonicalJson,
  type Command,
  type CommandOption,
  type GameState,
  type Hex,
  hexEquals,
  reachableHexes,
  type StepKind,
  stepKinds,
  type TeamId,
} from '@orcball/engine'

// What a tap on the board means, decided only from the engine's command
// options and reachable hexes, so the UI holds no rules. A tap gives a command
// to send, a path to walk, a new selection, or a message (usually the
// engine's reason a move isn't allowed).

// A path is previewed before it's walked (#113): with a mouse by hovering, so
// one click moves; on touch by a first tap, so a second tap on the same hex moves.

export type TapResult = { command?: Command; select?: string | null; message?: string; path?: Hex[]; preview?: Hex }

/** How the tap was made: by touch (or pen), and the hex whose path a first tap is showing, if any. */
export type Pointer = { touch: boolean; previewed: Hex | null }

const MOUSE: Pointer = { touch: false, previewed: null }

/** The way the active player would go: hex centre to hex centre from where he stands, and what each step takes. */
export type Route = { hexes: Hex[]; steps: StepKind[] }

/** Whether the engine lets the active player take a step now: his action involves moving and he has MA left. */
export function canStep(options: CommandOption[]): boolean {
  return options.some((o) => o.available && o.command.type === 'move')
}

/** The route the active player would take to a hex, as the engine would walk it, or null if he can't get there. */
export function routeTo(state: GameState, target: Hex): Route | null {
  const player = state.activation ? state.players[state.activation.playerId] : null
  if (!player?.hex) return null
  const reach = reachableHexes(state, player.id).find((r) => hexEquals(r.hex, target))
  return reach ? { hexes: [player.hex, ...reach.path], steps: stepKinds(reach) } : null
}

/** What's left of a route from where the player stands now, or null if he's no longer on it. */
export function routeFrom(route: Route, at: Hex): Route | null {
  const i = route.hexes.findIndex((hex) => hexEquals(hex, at))
  return i < 0 || i === route.hexes.length - 1 ? null : { hexes: route.hexes.slice(i), steps: route.steps.slice(i) }
}

export function commandKey(command: Command): string {
  return canonicalJson(command)
}

function find(options: CommandOption[], match: (c: Command) => boolean): CommandOption | undefined {
  return options.find((o) => match(o.command))
}

function playerAt(state: GameState, hex: Hex) {
  return Object.values(state.players).find((p) => p.hex && hexEquals(p.hex, hex)) ?? null
}

/** Pending decision choices tied to this hex (push hexes, touchback players, interceptors). */
function decisionAt(state: GameState, hex: Hex): Command | null {
  const choice = state.pending?.choices.find((c) => c.hex && hexEquals(c.hex, hex))
  return choice ? { type: 'decide', choice: choice.id } : null
}

const TARGETED = new Set(['block', 'foul', 'handOff'])

/**
 * Who is selected during a human's setup (#151): the first player still on
 * the bench, so each tap on the pitch places the next one. Nobody once the
 * team is full or the bench is empty, during the computer's setup (`computer`
 * is the team it plays), or outside setup. Tapping a player still selects him.
 */
export function setupSelection(state: GameState, options: CommandOption[], computer: TeamId | null): string | null {
  if (state.phase !== 'Setup' || state.pending || state.turnOwner === computer) return null
  const team = state.turnOwner
  const onPitch = Object.values(state.players).filter((p) => p.team === team && p.hex !== null).length
  if (onPitch >= state.config.match.playersOnPitch) return null
  const next = Object.values(state.players).find(
    (p) => p.team === team && p.hex === null && options.some((o) => o.command.type === 'place' && o.command.playerId === p.id),
  )
  return next?.id ?? null
}

export function tapHex(
  state: GameState,
  options: CommandOption[],
  selected: string | null,
  hex: Hex,
  /** Aiming a pass, or the Leap button is on (v19): a tap picks the target. */
  mode: 'pass' | 'leap' | null = null,
  pointer: Pointer = MOUSE,
): TapResult {
  if (state.pending) {
    const command = decisionAt(state, hex)
    return command ? { command } : { message: state.pending.prompt }
  }

  if (state.phase === 'Setup') {
    const occupant = playerAt(state, hex)
    if (occupant && occupant.team === state.turnOwner && occupant.id !== selected) return { select: occupant.id }
    if (!selected) return { message: 'Pick one of your players first' }
    const option = find(options, (c) => c.type === 'place' && c.playerId === selected && hexEquals(c.hex, hex))
    if (!option) return { message: 'That player can’t go there' }
    return option.available ? { command: option.command, select: null } : { message: option.reason }
  }

  if (state.phase === 'KickOff') {
    const option = find(options, (c) => c.type === 'kick' && hexEquals(c.hex, hex))
    return option?.available ? { command: option.command } : { message: "Kick into the receiving team's half" }
  }

  if (state.phase === 'Round') {
    const occupant = playerAt(state, hex)
    return { select: occupant?.id ?? null }
  }

  if (state.phase === 'Activation' && state.activation) {
    const activeId = state.activation.playerId
    if (mode === 'pass') {
      const option = find(options, (c) => c.type === 'pass' && hexEquals(c.target, hex))
      return option ? { command: option.command } : { message: 'Out of passing range' }
    }
    if (mode === 'leap') {
      const option = find(options, (c) => c.type === 'leap' && hexEquals(c.to, hex))
      return option?.available ? { command: option.command } : { message: 'He can only leap to a highlighted hex, 1 or 2 away' }
    }
    const occupant = playerAt(state, hex)
    if (occupant?.id === activeId) return {}
    if (occupant) {
      const option = find(options, (c) => TARGETED.has(c.type) && 'targetId' in c && c.targetId === occupant.id)
      return option ? { command: option.command } : { message: 'Nothing to do with that player on this action' }
    }
    if (!canStep(options)) return { message: 'This action doesn’t move the player' }
    const reach = reachableHexes(state, activeId).find((r) => hexEquals(r.hex, hex))
    if (!reach) return { message: "Can't reach that hex this activation" }
    // On touch the first tap only shows the way; the second tap on the same hex goes.
    if (pointer.touch && !(pointer.previewed && hexEquals(pointer.previewed, hex))) return { preview: hex, message: 'Tap the hex again to move there' }
    return { path: reach.path }
  }

  return {}
}

/** Hexes to highlight as legal targets for setup, the kick, or a decision. */
export function targetHexes(state: GameState, options: CommandOption[], selected: string | null): Hex[] {
  if (state.pending) return state.pending.choices.flatMap((c) => (c.hex ? [c.hex] : []))
  if (state.phase === 'Setup' && selected) {
    return options.flatMap((o) => (o.available && o.command.type === 'place' && o.command.playerId === selected ? [o.command.hex] : []))
  }
  if (state.phase === 'KickOff') return options.flatMap((o) => (o.available && o.command.type === 'kick' ? [o.command.hex] : []))
  return []
}

/**
 * The command for the next step of a path: a Dodge when stepping into a tackle
 * zone with more of the path to go and the engine offers one, else a plain step.
 * In v11, a Strength Disengage is the last step of its path, or the no-roll
 * alternative to a Dodge that goes further. Null if the engine offers neither
 * (the path is blocked).
 */
export function nextStep(options: CommandOption[], next: Hex, more: boolean): { command: Command; stopInstead: Command | null } | null {
  const plain = find(options, (c) => c.type === 'move' && hexEquals(c.to, next) && !c.dodge && !c.disengage)
  const dodge = find(options, (c) => c.type === 'move' && hexEquals(c.to, next) && c.dodge === true)
  const disengage = find(options, (c) => c.type === 'move' && hexEquals(c.to, next) && c.disengage === true)
  if (!more && disengage?.available) return { command: disengage.command, stopInstead: null }
  if (more && dodge?.available) {
    const stop = plain?.available ? plain : disengage?.available ? disengage : null
    return { command: dodge.command, stopInstead: stop?.command ?? null }
  }
  if (plain?.available) return { command: plain.command, stopInstead: null }
  if (dodge?.available) return { command: dodge.command, stopInstead: null }
  return null
}
