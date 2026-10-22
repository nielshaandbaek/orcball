import type { RuleModule } from '../engine'

// Rounds and activations (RULES.md §3): goes, Wait, action limits, double activations, ending the round, drives and halves.
// Rules arrive in #10 and #15.
export const round: RuleModule = {
  name: 'round',
}
