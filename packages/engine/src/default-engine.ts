import { createEngine } from './engine'
import { RULE_MODULES } from './rules'

/** The engine with every rule module wired in. */
export const engine = createEngine(RULE_MODULES)
