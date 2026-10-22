export const RULES_VERSION = 'v10'

export * from './config'
export { engine } from './default-engine'
export * from './dice'
export * from './engine'
export * from './hex'
export * from './log'
export * from './match'
export * from './rng'
export * from './state'

import { engine } from './default-engine'
export const { availableCommands, legalCommands, apply, previewRoll } = engine
