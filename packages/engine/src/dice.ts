import { rollDie, type RngState } from './rng'

// Dice rules (RULES.md §1): every test is a D10 plus modifiers, succeeding if
// the total reaches the target. A natural 1 always fails and a natural 10
// always succeeds, so every test sits between 10% and 90%. Direction and
// distance rolls stay on a D6.

export type Modifier = { name: string; value: number }

export type RolledEvent = {
  type: 'rolled'
  test: string
  target: number
  modifiers: Modifier[]
  natural: number
  success: boolean
}

export function rollD10(rng: RngState): { value: number; rng: RngState } {
  return rollDie(rng, 10)
}

export function rollD6(rng: RngState): { value: number; rng: RngState } {
  return rollDie(rng, 6)
}

export function modifierTotal(modifiers: readonly Modifier[]): number {
  return modifiers.reduce((sum, m) => sum + m.value, 0)
}

function succeeds(natural: number, target: number, total: number): boolean {
  if (natural === 1) return false
  if (natural === 10) return true
  return natural + total >= target
}

/** Roll a D10 test. Every test in the rules goes through here. */
export function resolveTest(
  rng: RngState,
  test: string,
  target: number,
  modifiers: readonly Modifier[],
): { event: RolledEvent; rng: RngState } {
  const roll = rollD10(rng)
  const success = succeeds(roll.value, target, modifierTotal(modifiers))
  return {
    event: { type: 'rolled', test, target, modifiers: [...modifiers], natural: roll.value, success },
    rng: roll.rng,
  }
}

/** Exact chance a test succeeds, from 0.1 to 0.9, for the roll preview. */
export function successChance(target: number, modifiers: readonly Modifier[]): number {
  const total = modifierTotal(modifiers)
  let wins = 0
  for (let natural = 1; natural <= 10; natural++) if (succeeds(natural, target, total)) wins++
  return wins / 10
}
