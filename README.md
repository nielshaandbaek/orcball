# OrcBall

Browser prototype for playtesting OrcBall, a fantasy football board game. The rules are in `RULES.md`, what we're building is in `PRD.md`, and how it's built is in `ARCHITECTURE.md`.

## Development

Needs Node 26 and pnpm 12.

```sh
pnpm install
pnpm --filter @orcball/web dev   # run the app
pnpm test                        # run all tests
pnpm typecheck
pnpm build
```

Packages:

- `packages/engine`: the rules engine. Pure TypeScript, no runtime dependencies, no DOM.
- `packages/web`: the React app.
- `packages/tools`: Node scripts for stats, replays and test bots.
