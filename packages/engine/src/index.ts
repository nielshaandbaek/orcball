export const RULES_VERSION = 'v13'

export * from './config'
export { engine } from './default-engine'
export * from './dice'
export * from './engine'
export * from './hex'
export { canonicalJson } from './json'
export * from './log'
export * from './match'
export * from './rng'
export * from './state'
export { tacklePreview } from './rules/blocking'
export { maxMovement, type Reach, reachableHexes, standUpCost } from './rules/movement'
export { passBand, possibleInterceptors } from './rules/passing'
export { blockTotals, countAssists, enemyTackleZones, exertsTackleZone } from './rules/zones'

import { engine } from './default-engine'
export const { availableCommands, legalCommands, apply, applyLegal, previewRoll, previewRolls } = engine
