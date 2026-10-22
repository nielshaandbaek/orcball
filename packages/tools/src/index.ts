import { RULES_VERSION } from '@orcball/engine'

export { invariantProblems, playRandomMatch } from './bot'
export { formatReport, summarise } from './report'

export function describeEngine(): string {
  return `OrcBall rules ${RULES_VERSION}`
}
