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

- `packages/engine`: the rules engine. Pure TypeScript, no DOM. Its only runtime dependency is Zod, for validating rule configs.
- `packages/web`: the React app.
- `packages/tools`: the random-play bot, match reports and golden replays. See `packages/tools/README.md`.
