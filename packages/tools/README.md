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

Two contenders play a run of matches: `random` (the random-play bot) or a computer level, `novice`, `intermediate` or `expert`. The home contender starts at home and the sides swap halfway through the run, to cancel out any home or away advantage; the rosters stay with their side. For each contender, the report gives wins, draws and losses, and the share of decisive matches won with its 95% margin of error. It also gives touchdowns per match; blocks per match and the share of them chosen as a Tackle; opposing players knocked down per match, in the contender's own activations; failed activations per match, each of which gives the other team a double activation; and the median and worst time per decision. Then come the PRD's metrics for the run: activations per match, rolls per activation, activations with no roll, and matches ending 0–0. A match that fails (a crash, an illegal command or state, or no full time) or has a decision slower than 5 seconds is printed with the command to replay it.

```sh
pnpm --filter @orcball/tools ai-match --home novice --away random --matches 200
pnpm --filter @orcball/tools ai-match --home random --away novice --first-seed 17 --matches 1  # replay one match
```

| Option | Default | |
| --- | --- | --- |
| `--home`, `--away` | `novice`, `random` | The two contenders; `--home` plays home in the first half of the run. A level can play with its own weights file: `novice:path/to/weights.json`. |
| `--matches` | `20` | Matches in the run. |
| `--rules` | `rules-v12` | Rules config id: `rules-v10` to `rules-v19`. Several, comma-separated, play the run under each and compare them. |
| `--rosters` | `orcs,elves` | Roster ids for home and away; with `--balance`, the first and second contender's. |
| `--balance` | | Each contender keeps its roster, so the rosters swap sides halfway too, and the report compares the rosters. |
| `--budget-ms` | `10000` | The computer's thinking time per decision, in ms. |
| `--first-seed` | `1` | Seeds run from here up; a seed reproduces its match. |
| `--report` | | Also write the report to this file. |
| `--shard` | | `2/4`: play only the second of four shards. A shard plays every fourth match of the run, so it gets both halves of it. |
| `--results` | | Save the run's matches to this JSON file, for `--combine`. |
| `--combine` | | A directory of saved results: play nothing and report them as one run. Give the same options as the shards had. |

While a run plays, it prints a line after each match: how far it is, the result, the time so far and an estimate of the time left.

```text
shard 2/4: 12/50 (24%) seed 46: novice 3-0 random. 6m 10s elapsed, about 19m 32s left
```

`pnpm test` plays a few short runs.

## Balance reports

Are the teams even? Two copies of one computer level play each other, each with its own roster. Each roster plays home in one half of the run, so neither gets the home edge.

```sh
pnpm --filter @orcball/tools ai-match --balance --home novice --away novice --matches 200
gh workflow run long-runs.yml -f run=balance -f level=intermediate -f matches=200 -f shards=8
```

The PRD's target is a win rate of 40–60% for either roster. Read the margin of error before acting on a result. Over 200 matches with a third drawn, about 133 are decisive, and the margin is about ±8 points. So even teams can show anything from about 42% to 58%.

To check a rule change before playtesting it, give both versions: `--rules rules-v12,rules-v13`. Each version plays the same seeds, and a last table compares the balance and the PRD metrics side by side.

## Tuning the weights

The computer scores positions with a weighted sum of features (`packages/ai/src/evaluate.ts`); the weights are in `packages/ai/weights/default.json`. Two tools try to improve them. Neither has beaten the hand-set weights yet (#64; results below), so treat a result as a candidate to check, never as an improvement by itself.

### Self-play (SPSA)

1. Each iteration nudges every weight except `score` at once, each up or down at random, by `c` of its scale. A weight's scale is its starting size, or 0.25 for a weight at or near 0.
2. The weights with the nudges added play the weights with them subtracted, in a batch of matches with the sides swapped halfway.
3. The weights move towards whichever variant won more, by how much more it won. The steps shrink as the run goes on.

`score` stays fixed because scaling every weight alike changes no choice. Every iteration plays new seeds, and `--seed` sets the nudges, so a run can be repeated exactly.

```sh
pnpm --filter @orcball/tools tune --iterations 300 --matches 24 --c 0.75 --a 0.5 --out tuned.json
```

| Option | Default | |
| --- | --- | --- |
| `--iterations` | `100` | Iterations, each one batch of matches. |
| `--matches` | `12` | Matches per iteration. |
| `--c`, `--a` | `0.3`, `0.25` | Nudge size, and the first step for a batch won outright, in scales. |
| `--level` | `novice` | The level both sides play at. Novice is fast, and every level uses the same weights. |
| `--parallel` | the number of cores | Processes playing each batch. |
| `--rules`, `--rosters`, `--budget-ms` | as for ai-match | |
| `--seed` | `1` | Seeds the nudges. |
| `--features` | every weight but `score` | The weights to tune, comma-separated; the rest stay as they are. |
| `--out` | `tuned.json` | The weights, written after every iteration, so a run stopped early keeps the weights it reached. |

It prints a line after each iteration: the result for the plus variant (wins minus losses, over the matches) and every weight that has moved so far.

The run needs thousands of matches. On a 6-core Mac an iteration of 24 Novice matches takes about a minute. On GitHub's 2-core runners a Novice match takes about 20 s, so an iteration of 12 takes about 2 minutes, and a run is limited to about 170 iterations by the 6-hour job limit. The Long runs workflow can run it all the same (`-f run=tune -f iterations=150`).

### Fitting to what happens next

`ai-match --samples` records the feature differences at the start of every go. `tune --fit <results dir>` then fits the weights to the touchdowns each side went on to score from there. It uses ridge regression towards the current weights, with the strength chosen by cross-validation over whole matches. The Long runs workflow does both with `-f run=fit`.

This uses every go of a match, so it needs far fewer matches. But weights that predict well don't necessarily play well. Fitted to 400 Novice matches, `ball` came out negative: under Novice, a ball picked up deep in a team's own half often leads to a bad outcome. With that weight, the computer avoided picking up the ball. Its predictions were better, and it lost 104–56.

### Results so far (rules v12, Novice)

| Weights | Against the hand-set weights, 200 matches | Decisive won |
| --- | --- | --- |
| SPSA on GitHub, 183 × 12 matches | 64–68–68 | 48% |
| Fitted to 400 matches | 56–40–104 | 35% |
| SPSA on a Mac, 300 × 24 matches | 64–58–78 | 45% |

With 15 features, the hand-set weights seem to be close to the best these features allow. Better play probably needs features the evaluation doesn't have yet.

### Attacking features (rules v14, Novice, #86)

Three features were added for attacking play: `carrierLane`, `carrierScreen` and `receivers` (see `evaluate.ts`). Their default weights are 0, so they don't change play. Played against the weights without them, each over 800 matches, sides swapped:

| Weights (lane / screen / receivers) | Against the default weights | Decisive won |
| --- | --- | --- |
| Hand-set, −0.3 / 0.3 / 0.3 | 284–264–252 | 53% (49%–57%) |
| SPSA on GitHub, 150 × 12 matches, starting from 0 | 273–280–247 | 53% (48%–57%) |

Neither reaches 55%. SPSA took the three weights to about 0, so as defined they add little.

Then `carrierReach`, the open path: how many go's the carrier needs to reach the end zone round the other players, with each Dodge out of a tackle zone costing 2 MA more (3 for one go, 2 for two, 1 for three, else 0). Against the weights without it:

| `carrierReach` | Level | Matches | Against the weights without it | Decisive won |
| --- | --- | --- | --- | --- |
| 0.5 | Novice | 400 | 157–121–122 | 56% (50%–62%) |
| 2 | Novice | 400 | 149–132–119 | 56% (50%–61%) |
| **1** | Novice | 1,200 | 465–375–360 | **56% (53%–60%)** |
| **1** | Intermediate | 200 | 56–103–41 | 58% (48%–67%) |

Weight 1 is in `default.json`. Touchdowns per match went up from about 0.44 to 0.56 at Novice. Search time: median about 3 ms at Novice, worst under 1 s.

### The ball features tuned together (rules v16, Intermediate, #98)

`forwardThreats` was added: free team-mates ahead of the carrier in the opponent's half, at most two. Then SPSA tuned only the four ball features (`--features carrierLane,carrierScreen,receivers,forwardThreats`) from 0, at Novice (150 × 12 matches) and at Intermediate (50 × 12). The Novice run's weights, now in `default.json`: `carrierLane` −0.17, `carrierScreen` −0.01, `receivers` −0.04, `forwardThreats` +0.09.

| Run (Intermediate, v16) | Matches | Result | |
| --- | --- | --- | --- |
| Tuned against the weights before | 1,200 | 247–766–187 | **57% (52%–61%)** decisive won; 0.26 against 0.19 TD/match |
| Tuned against Novice | 400 | 126–231–43 | 75% (67%–81%) decisive won |
| Orcs–Elves balance, tuned | 400 | 39–223–138 | 0.54 TD/match, 54% 0–0 |
| Orcs–Elves balance, before | 400 | 44–249–107 | 0.43 TD/match, 62% 0–0 |

More scoring and fewer 0–0s, but the Elves gain more from it than the Orcs (Orcs win 22% of decided matches, from 29%). Worst decision time 10.0 s (the budget), from about 8.5 s.

### Checking candidate weights, and after a rule change

The weights are set for the current rules and rosters. To check candidate weights, after a rule change or a new feature, play them against the current ones. They should win at least 55% of the decisive matches:

```sh
gh workflow run long-runs.yml -f run=ai-match -f home=novice:packages/ai/weights/candidate.json -f away=novice -f matches=200 -f shards=8
```

Paths are relative to where pnpm starts: the repo root in the workflow. Only weights that pass become `default.json`. Give them a descriptive `id`, e.g. `tuned-v13`, and commit them like any other change.

## Long runs on GitHub

Long computer-against-computer runs, balance reports, tuning and the engine benchmark also run on GitHub, so they don't tie up a laptop. Start one from the Actions tab (**Long runs → Run workflow**) or from the command line, with the same options as above; the report lands in the run's summary.

A computer-against-computer run is split into `shards` parallel jobs (default 4, at most 20). Each shard's log shows its progress lines as it plays; open a shard job in the run to follow it. When all shards are done, a `report` job combines them. If a shard fails or times out, the report says how many matches are missing.

```sh
gh workflow run long-runs.yml -f run=ai-match -f home=novice -f away=random -f matches=200
gh workflow run long-runs.yml -f run=ai-match -f home=novice -f away=novice -f matches=200 -f shards=8
gh workflow run long-runs.yml -f run=bench -f bench-matches=20
gh run watch                                   # follow it
```

A GitHub runner is slower than a recent Mac, so compare benchmark numbers only with other runs on GitHub. Each job stops after 6 hours; more shards make each one shorter. Every shard uses Actions minutes, so the total cost is the same however the run is split.
