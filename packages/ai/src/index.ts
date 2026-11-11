export { type AiChoice, type AiLevel, type AiOptions, chooseCommand } from './choose'
export {
  actingTeam,
  type AiView,
  faceFor,
  type Outcome,
  optionsOf,
  previewsOf,
  type SimDice,
  simulate,
  simulateOutcome,
  stateOf,
  viewOf,
} from './view'
export {
  defaultWeights,
  type Evaluation,
  evaluate,
  FEATURES,
  type Feature,
  featureDifferences,
  loadWeights,
  type Weights,
  WeightsError,
  WeightsSchema,
} from './evaluate'
export { chooseDeep, type DeepLevel } from './deep'
export { chooseNovice, formations } from './novice'
export { type Cursor, generatePlans, nextStep, type Plan, type PlanTarget, planTarget, startCursor } from './plans'
export { Search } from './search'
export { decisionReason, named, oddsText, planAction, planReason, playerLabel, purposes, successLine, where } from './reasons'
