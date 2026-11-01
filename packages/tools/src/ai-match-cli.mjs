// Command line for the computer-against-computer runner:
//   pnpm --filter @orcball/tools ai-match --home novice --away random --matches 200
// It passes the options on to ai-match.test.ts as environment variables, since
// the tools run their TypeScript through Vitest.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    home: { type: 'string', default: 'novice' },
    away: { type: 'string', default: 'random' },
    matches: { type: 'string', default: '20' },
    rules: { type: 'string', default: 'rules-v12' },
    rosters: { type: 'string', default: 'orcs,elves' },
    'budget-ms': { type: 'string', default: '10000' },
    'first-seed': { type: 'string', default: '1' },
    report: { type: 'string' },
  },
})

const env = {
  ...process.env,
  AI_MATCH: '1',
  AI_HOME: values.home,
  AI_AWAY: values.away,
  AI_MATCHES: values.matches,
  AI_RULES: values.rules,
  AI_ROSTERS: values.rosters,
  AI_BUDGET_MS: values['budget-ms'],
  AI_FIRST_SEED: values['first-seed'],
  // Also write the report to this file (relative to where pnpm was started).
  AI_REPORT: values.report ? resolve(process.env.INIT_CWD ?? process.cwd(), values.report) : '',
}
const result = spawnSync('vitest', ['run', 'src/ai-match.test.ts', '-t', 'runs the requested matches', '--silent=false', '--reporter=dot'], { env, stdio: 'inherit', shell: true })
process.exit(result.status ?? 1)
