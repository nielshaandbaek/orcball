import { createEngine } from './engine'
import { RULE_MODULES } from './rules'

export const RULES_VERSION = 'v10'

export * from './config'
export * from './dice'
export * from './engine'
export * from './hex'
export * from './match'
export * from './rng'
export * from './state'

/** The engine with every rule module wired in. */
export const engine = createEngine(RULE_MODULES)
export const { availableCommands, legalCommands, apply, previewRoll } = engine
