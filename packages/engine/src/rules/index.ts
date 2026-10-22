import type { RuleModule } from '../engine'
import { ball } from './ball'
import { blocking } from './blocking'
import { injury } from './injury'
import { momentum } from './momentum'
import { movement } from './movement'
import { passing } from './passing'
import { round } from './round'
import { setup } from './setup'

/** The rule modules the default engine runs, one per area of the rules. */
export const RULE_MODULES: readonly RuleModule[] = [setup, round, movement, blocking, ball, passing, injury, momentum]
