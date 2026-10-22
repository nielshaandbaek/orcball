import { canonicalJson, type Command, type CommandOption, type GameState, type Hex, hexEquals } from '@orcball/engine'

// What a tap on the board means, decided only from the engine's command
// options, so the UI holds no rules. Returns a command to send, a new
// selection, or a message (usually the engine's reason a move isn't allowed).

export type TapResult = { command?: Command; select?: string | null; message?: string }

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

export function tapHex(state: GameState, options: CommandOption[], selected: string | null, hex: Hex): TapResult {
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

  return {}
}

/** Hexes to highlight as legal targets for the current selection or decision. */
export function targetHexes(state: GameState, options: CommandOption[], selected: string | null): Hex[] {
  if (state.pending) return state.pending.choices.flatMap((c) => (c.hex ? [c.hex] : []))
  if (state.phase === 'Setup' && selected) {
    return options.flatMap((o) => (o.available && o.command.type === 'place' && o.command.playerId === selected ? [o.command.hex] : []))
  }
  if (state.phase === 'KickOff') return options.flatMap((o) => (o.available && o.command.type === 'kick' ? [o.command.hex] : []))
  return []
}
