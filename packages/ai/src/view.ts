import {
  applyLegal,
  availableCommands,
  type Command,
  type CommandOption,
  forcedRng,
  legalCommands,
  type GameEvent,
  type GameState,
  modifierTotal,
  previewRolls,
  type RngState,
  type RollPreview,
  seededRng,
  succeeds,
  type TeamId,
} from '@orcball/engine'

// What the computer sees of a match, and how it tries commands out.
//
// The RNG state would let a program work out every future roll, so the
// computer gets the state without it. To look ahead it applies commands with
// dice it picks itself: the faces for the outcome it wants to try, then its
// own seeded dice for any rolls after that.

/** The game state without the RNG. */
export type AiView = Omit<GameState, 'rng'>

export function viewOf(state: GameState): AiView {
  const { rng: _rng, ...view } = state
  return view
}

/** A state to hand the engine; with no dice given, any roll throws. */
export function stateOf(view: AiView, rng: RngState = forcedRng([])): GameState {
  return { ...view, rng }
}

/** The coach who acts next: the one a pending decision is addressed to, or whose go it is. */
export function actingTeam(view: AiView): TeamId {
  return view.pending?.team ?? view.turnOwner
}

const legalMemo = new WeakMap<AiView, Command[]>()

/**
 * The commands the computer considers: every legal one but Cancel (v16). It
 * never takes an activation back: it only starts one it means to use.
 */
export function aiLegal(state: GameState): Command[] {
  return legalCommands(state).filter((c) => c.type !== 'cancelActivation')
}

/** The legal commands in a position, worked out once per position: the search asks for them at every step of every plan. */
export function legalOf(view: AiView): Command[] {
  let legal = legalMemo.get(view)
  if (!legal) {
    legal = aiLegal(stateOf(view))
    legalMemo.set(view, legal)
  }
  return legal
}

export function optionsOf(view: AiView): CommandOption[] {
  return availableCommands(stateOf(view))
}

export function previewsOf(view: AiView, command: Command): RollPreview[] {
  return previewRolls(stateOf(view), command)
}

/** Dice for a simulated command: these faces first, then seeded dice. */
export type SimDice = { faces?: readonly number[]; seed: number }

/** Apply a legal command (from legalCommands or the pending choices: it isn't checked again). */
export function simulate(view: AiView, command: Command, dice: SimDice): { view: AiView; events: GameEvent[] } {
  const result = applyLegal(stateOf(view, forcedRng(dice.faces ?? [], seededRng(dice.seed))), command)
  return { view: viewOf(result.state), events: result.events }
}

export type Outcome = 'success' | 'failure' | 'natural1'

/**
 * A D10 face that gives this outcome on a test, or null if it can't happen.
 * A failure is a miss other than a natural 1 where there is one, since some
 * rules treat a natural 1 worse.
 */
export function faceFor(preview: RollPreview, outcome: Outcome): number | null {
  if (outcome === 'natural1') return 1
  const total = modifierTotal(preview.modifiers)
  const faces = [2, 3, 4, 5, 6, 7, 8, 9, 10]
  if (outcome === 'success') return faces.find((n) => succeeds(n, preview.target, total)) ?? null
  return faces.reverse().find((n) => !succeeds(n, preview.target, total)) ?? null
}

/** Apply a command whose first roll comes out as `outcome`; null if it can't. */
export function simulateOutcome(
  view: AiView,
  command: Command,
  outcome: Outcome,
  seed: number,
): { view: AiView; events: GameEvent[] } | null {
  const [preview] = previewsOf(view, command)
  if (!preview) throw new Error(`simulateOutcome: ${command.type} makes no roll`)
  const face = faceFor(preview, outcome)
  return face === null ? null : simulate(view, command, { faces: [face], seed })
}
