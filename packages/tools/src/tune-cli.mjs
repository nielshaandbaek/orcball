// Command line for tuning the evaluation weights by self-play:
//   pnpm --filter @orcball/tools tune --iterations 100 --out tuned.json
// Like ai-match-cli.mjs, it passes the options on to tune.test.ts as
// environment variables and prints the progress file as it grows.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    iterations: { type: 'string', default: '100' },
    // Matches per iteration between the two nudged variants.
    matches: { type: 'string', default: '12' },
    level: { type: 'string', default: 'novice' },
    parallel: { type: 'string', default: String(availableParallelism()) },
    rules: { type: 'string', default: 'rules-v12' },
    rosters: { type: 'string', default: 'orcs,elves' },
    'budget-ms': { type: 'string', default: '10000' },
    seed: { type: 'string', default: '1' },
    out: { type: 'string', default: 'tuned.json' },
  },
})

const work = mkdtempSync(join(tmpdir(), 'tune-'))
const progress = join(work, 'progress.txt')

const env = {
  ...process.env,
  TUNE: '1',
  TUNE_ITERATIONS: values.iterations,
  TUNE_MATCHES: values.matches,
  TUNE_LEVEL: values.level,
  TUNE_PARALLEL: values.parallel,
  TUNE_RULES: values.rules,
  TUNE_ROSTERS: values.rosters,
  TUNE_BUDGET_MS: values['budget-ms'],
  TUNE_SEED: values.seed,
  // Relative to where pnpm was started.
  TUNE_OUT: resolve(process.env.INIT_CWD ?? process.cwd(), values.out),
  TUNE_PROGRESS: progress,
}

let printed = 0
function printProgress() {
  if (!existsSync(progress)) return
  const text = readFileSync(progress, 'utf8')
  if (text.length > printed) process.stdout.write(text.slice(printed))
  printed = text.length
}

const timer = setInterval(printProgress, 5_000)
const child = spawn('vitest', ['run', 'src/tune.test.ts', '-t', 'tunes the weights', '--silent=false', '--reporter=dot'], {
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
