# @orcball/tools

Node-side tools that drive the engine: a random-play bot, a match report, golden replays and a computer-against-computer runner.

## Random play

`playRandomMatch(seed)` plays both sides with random legal commands until full time. It records the match and checks the state after every command. It reports a crash, an illegal state (two players on a hex, a ball apart from its carrier, …) or a stuck state (no legal commands, or no full time after 20,000 commands). The bot's choices come from its own seeded dice, so a seed reproduces the whole match.

```sh
pnpm --filter @orcball/tools random-play                 # 1,000 matches, as in CI, with a report
RANDOM_MATCHES=100 pnpm --filter @orcball/tools random-play
RANDOM_SEED=123 pnpm --filter @orcball/tools random-play # replay one seed, e.g. one CI printed
```

`pnpm test` runs 50 of them.

## Golden replays

`golden/*.json` are three saved random matches that include touchdowns, each stored with its final state and every event. `pnpm test` replays them, and any rule change that alters what happens in them fails the build.

When a change is meant to alter them, regenerate the files and review the diff before committing:

```sh
pnpm --filter @orcball/tools golden:update
```

## Engine benchmark

How fast the engine simulates, for the computer opponent's search: `apply`, `availableCommands` and `reachableHexes` calls per second, on positions from random matches. The results and what they mean are in `ARCHITECTURE.md` (Computer opponent → Performance).

```sh
pnpm --filter @orcball/tools bench                  # positions from 5 random matches
BENCH_MATCHES=20 pnpm --filter @orcball/tools bench
```

## Computer against computer

Two contenders play a run of matches: `random` (the random-play bot) or a computer level, `novice`, `intermediate` or `expert`. The home contender starts at home and the sides swap halfway through the run, to cancel out any home or away advantage; the rosters stay with their side. The report gives wins, draws and losses, touchdowns per match, activations per match, and the median and worst time per decision for each contender. A match that fails (a crash, an illegal command or state, or no full time) or has a decision slower than 5 seconds is printed with the command to replay it.

```sh
pnpm --filter @orcball/tools ai-match --home novice --away random --matches 200
pnpm --filter @orcball/tools ai-match --home random --away novice --first-seed 17 --matches 1  # replay one match
```

| Option | Default | |
| --- | --- | --- |
| `--home`, `--away` | `novice`, `random` | The two contenders; `--home` plays home in the first half of the run. |
| `--matches` | `20` | Matches in the run. |
| `--rules` | `rules-v12` | Rules config id: `rules-v10`, `rules-v11` or `rules-v12`. |
| `--rosters` | `orcs,elves` | Roster ids for home and away. |
| `--budget-ms` | `10000` | The computer's thinking time per decision, in ms. |
| `--first-seed` | `1` | Seeds run from here up; a seed reproduces its match. |
| `--report` | | Also write the report to this file. |

`pnpm test` plays two short runs.

## Long runs on GitHub

Long computer-against-computer runs and the engine benchmark also run on GitHub, so they don't tie up a laptop. Start one from the Actions tab (**Long runs → Run workflow**) or from the command line, with the same options as above; the report lands in the run's summary.

```sh
gh workflow run long-runs.yml -f run=ai-match -f home=novice -f away=random -f matches=200
gh workflow run long-runs.yml -f run=bench -f bench-matches=20
gh run watch                                   # follow it
```

A GitHub runner is slower than a recent Mac, so compare benchmark numbers only with other runs on GitHub. A run stops after 6 hours.
