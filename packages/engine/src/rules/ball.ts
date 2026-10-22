import type { RuleModule } from '../engine'

// Ball handling (RULES.md §7): scatter, bounce, catch, throw-in, pick-up, pass, hand-off, interception.
// Rules arrive in #8 and #12.
export const ball: RuleModule = {
  name: 'ball',
}
