import { type Modifier, type RolledEvent, resolveTest } from './dice'
import { canonicalJson, deepClone } from './json'
import type {
  Command,
  CommandOption,
  CommandType,
  DecisionChoice,
  GameEvent,
  GameState,
  PendingDecision,
  RollPreview,
} from './state'

// The engine is a state machine. Rule modules supply the commands on offer,
// what each command does, and how each kind of pending decision resumes. This
// file only wires them together and enforces the shared contract:
// - apply never mutates its input: modules change a deep copy;
// - only commands in legalCommands are accepted;
// - while a decision is pending, its answers are the only legal commands.

/** What a rule handler gets: a copy of the state to change, and helpers. */
export type RuleContext = {
  state: GameState
  emit(event: GameEvent): void
  /** Roll a D10 test, advance the RNG and log the rolled event. */
  test(test: string, target: number, modifiers: readonly Modifier[]): RolledEvent
  /** Pause until a coach answers. */
  ask(decision: PendingDecision): void
}

type CommandHandlers = {
  [T in CommandType]?: (ctx: RuleContext, command: Extract<Command, { type: T }>) => void
}

export type RuleModule = {
  name: string
  /** Commands this module offers in this state, legal or greyed out with a reason. */
  options?(state: GameState): CommandOption[]
  /** What each command type this module owns does. */
  commands?: CommandHandlers
  /** How each decision kind this module asks resumes once answered. */
  decisions?: Record<string, (ctx: RuleContext, pending: PendingDecision, choice: DecisionChoice) => void>
  /** The roll a command would make, if any, for the odds preview. */
  preview?(state: GameState, command: Command): RollPreview | null
  /** Runs after every command once nothing is pending, e.g. to check for a touchdown. */
  afterCommand?(ctx: RuleContext): void
}

export class IllegalCommandError extends Error {
  readonly command: Command

  constructor(command: Command, reason: string) {
    super(`Illegal command ${canonicalJson(command)}: ${reason}`)
    this.name = 'IllegalCommandError'
    this.command = command
  }
}

export type Engine = {
  availableCommands(state: GameState): CommandOption[]
  legalCommands(state: GameState): Command[]
  apply(state: GameState, command: Command): { state: GameState; events: GameEvent[] }
  previewRoll(state: GameState, command: Command): RollPreview | null
  /** Every roll a command would make, in order, e.g. a Dodge and then a pick-up. */
  previewRolls(state: GameState, command: Command): RollPreview[]
}

export function createEngine(modules: readonly RuleModule[]): Engine {
  const commandOwners = new Map<CommandType, RuleModule>()
  const decisionOwners = new Map<string, RuleModule>()
  for (const module of modules) {
    for (const type of Object.keys(module.commands ?? {}) as CommandType[]) {
      if (type === 'decide') throw new Error(`Rule module ${module.name}: 'decide' is handled by the engine`)
      const owner = commandOwners.get(type)
      if (owner) throw new Error(`Rule modules ${owner.name} and ${module.name} both handle '${type}'`)
      commandOwners.set(type, module)
    }
    for (const kind of Object.keys(module.decisions ?? {})) {
      const owner = decisionOwners.get(kind)
      if (owner) throw new Error(`Rule modules ${owner.name} and ${module.name} both answer '${kind}'`)
      decisionOwners.set(kind, module)
    }
  }

  function availableCommands(state: GameState): CommandOption[] {
    if (state.pending) {
      return state.pending.choices.map((choice) => ({
        command: { type: 'decide', choice: choice.id },
        available: true,
      }))
    }
    return modules.flatMap((module) => module.options?.(state) ?? [])
  }

  function legalCommands(state: GameState): Command[] {
    return availableCommands(state)
      .filter((option) => option.available)
      .map((option) => option.command)
  }

  function apply(state: GameState, command: Command): { state: GameState; events: GameEvent[] } {
    const key = canonicalJson(command)
    const option = availableCommands(state).find((o) => canonicalJson(o.command) === key)
    if (!option) {
      const reason = state.pending ? `waiting for an answer to '${state.pending.kind}'` : 'not on offer right now'
      throw new IllegalCommandError(command, reason)
    }
    if (!option.available) throw new IllegalCommandError(command, option.reason)

    const draft = deepClone(state)
    const events: GameEvent[] = []
    const ctx: RuleContext = {
      state: draft,
      emit: (event) => events.push(event),
      test(test, target, modifiers) {
        const result = resolveTest(draft.rng, test, target, modifiers)
        draft.rng = result.rng
        events.push(result.event)
        return result.event
      },
      ask(decision) {
        if (draft.pending) throw new Error(`Cannot ask '${decision.kind}': '${draft.pending.kind}' is still pending`)
        draft.pending = deepClone(decision)
      },
    }

    if (command.type === 'decide') {
      const pending = draft.pending!
      const choice = pending.choices.find((c) => c.id === command.choice)!
      const handler = decisionOwners.get(pending.kind)?.decisions?.[pending.kind]
      if (!handler) throw new Error(`No rule module answers '${pending.kind}'`)
      draft.pending = null
      handler(ctx, pending, choice)
    } else {
      const handler = commandOwners.get(command.type)?.commands?.[command.type] as
        | ((ctx: RuleContext, command: Command) => void)
        | undefined
      if (!handler) throw new Error(`No rule module handles '${command.type}'`)
      handler(ctx, command)
    }

    for (const module of modules) {
      if (draft.pending) break
      module.afterCommand?.(ctx)
    }

    return { state: draft, events }
  }

  function previewRolls(state: GameState, command: Command): RollPreview[] {
    return modules.flatMap((module) => module.preview?.(state, command) ?? [])
  }

  function previewRoll(state: GameState, command: Command): RollPreview | null {
    return previewRolls(state, command)[0] ?? null
  }

  return { availableCommands, legalCommands, apply, previewRoll, previewRolls }
}
