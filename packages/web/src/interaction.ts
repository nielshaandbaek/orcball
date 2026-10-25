import {
  canonicalJson,
  type Command,
  type CommandOption,
  type GameState,
  type Hex,
  hexEquals,
  reachableHexes,
} from '@orcball/engine'

// What a tap on the board means, decided only from the engine's command
// options and reachable hexes, so the UI holds no rules. A tap gives a command
// to send, a path to walk, a new selection, or a message (usually the
// engine's reason a move isn't allowed).

export type TapResult = { command?: Command; select?: string | null; message?: string; path?: Hex[] }

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

export function tapHex(state: GameState, options: CommandOption[], selected: string | null, hex: Hex, aiming = false): TapResult {
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
    if (aiming) {
      const option = find(options, (c) => c.type === 'pass' && hexEquals(c.target, hex))
      return option ? { command: option.command } : { message: 'Out of passing range' }
    }
    const occupant = playerAt(state, hex)
    if (occupant?.id === activeId) return {}
    if (occupant) {
      const option = find(options, (c) => TARGETED.has(c.type) && 'targetId' in c && c.targetId === occupant.id)
      return option ? { command: option.command } : { message: 'Nothing to do with that player on this action' }
    }
    const reach = reachableHexes(state, activeId).find((r) => hexEquals(r.hex, hex))
    return reach ? { path: reach.path } : { message: "Can't reach that hex this activation" }
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
