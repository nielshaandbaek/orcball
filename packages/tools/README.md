# @orcball/tools

Node-side tools that drive the engine: a random-play bot, a match report and golden replays.

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
