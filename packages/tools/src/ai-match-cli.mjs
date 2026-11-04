// Command line for the computer-against-computer runner:
//   pnpm --filter @orcball/tools ai-match --home novice --away random --matches 200
// It passes the options on to ai-match.test.ts as environment variables, since
// the tools run their TypeScript through Vitest.
//
// The matches run in one synchronous loop, which holds Vitest's console output
// back until the end. So the test appends a progress line after each match to
// a file, and this script prints whatever is new in it every few seconds.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
    // "2/4": play only the second of four shards of the run.
    shard: { type: 'string' },
    // Save this run's matches as JSON, for --combine.
    results: { type: 'string' },
    // A directory of saved results: play nothing, report them as one run.
    combine: { type: 'string' },
  },
})

// Paths are relative to where pnpm was started.
const path = (p) => (p ? resolve(process.env.INIT_CWD ?? process.cwd(), p) : '')
// A contender's weights file too: `novice:weights.json`.
const contender = (name) => (name.includes(':') ? `${name.slice(0, name.indexOf(':'))}:${path(name.slice(name.indexOf(':') + 1))}` : name)
const work = mkdtempSync(join(tmpdir(), 'ai-match-'))
const progress = join(work, 'progress.txt')

const env = {
  ...process.env,
  AI_MATCH: '1',
  AI_HOME: contender(values.home),
  AI_AWAY: contender(values.away),
  AI_MATCHES: values.matches,
  AI_RULES: values.rules,
  AI_ROSTERS: values.rosters,
  AI_BUDGET_MS: values['budget-ms'],
  AI_FIRST_SEED: values['first-seed'],
  AI_SHARD: values.shard ?? '',
  AI_RESULTS: path(values.results),
  AI_COMBINE: path(values.combine),
  AI_PROGRESS: progress,
  AI_REPORT: path(values.report),
}

let printed = 0
function printProgress() {
  if (!existsSync(progress)) return
  const text = readFileSync(progress, 'utf8')
  if (text.length > printed) process.stdout.write(text.slice(printed))
  printed = text.length
}

const timer = setInterval(printProgress, 5_000)
const child = spawn('vitest', ['run', 'src/ai-match.test.ts', '-t', 'runs the requested matches', '--silent=false', '--reporter=dot'], {
  env,
  stdio: 'inherit',
  shell: true,
})
child.on('exit', (code) => {
  clearInterval(timer)
  printProgress()
  rmSync(work, { recursive: true, force: true })
  process.exit(code ?? 1)
})
