# OrcBall Prototype — Architecture

Oct 17, 2026 · @Niels

## At a glance

The prototype is a static web app around one pure rules engine; the UI sends commands in, gets state and events back, and saves the commands as the match log.

![[Screenshot 2026-10-21 at 20.38.23.png]]

The board turns clicks into commands for the store, which passes them to the engine and records them in the log. Rule modules use the core hex and dice code and read their numbers from the config. The tools package replays saved logs through the same engine for stats and tests.

## Principles

The rules live in one pure, UI-free engine; everything else (board, log, stats, replay, a future AI) is a client of it.

- **Engine is pure.** `apply(state, command) → { state, events }`. No DOM, no clock, no `Math.random`. Same input, same output.
- **Numbers are data.** Stats, modifiers, round counts and injury bands come from a versioned rule config, never hard-coded.
- **The log is the truth.** A match is its seed, its config and its list of commands. State, replay and stats are all rebuilt from that.
- **The engine asks, the UI answers.** When the rules need a choice (push hex, Dodge or stop, spend Momentum), the engine pauses with a pending decision instead of guessing.
- **Legal moves come from the engine.** The UI never decides what's allowed; it only shows what the engine offers.
- **Static and offline.** The MVP is a static web app with no server; saving is local and exporting is a file.

## Tech stack

TypeScript end to end in one repo, so the engine, UI and test tools share the same types.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) | Shared types between engine, UI and tools; catches rule bugs early |
| Repo | pnpm workspace, 3 packages: `engine`, `web`, `tools` | Keeps the engine free of UI dependencies |
| Engine | Plain TS; Zod is its only runtime dependency | Runs in the browser, in tests, in Node scripts and later on a server |
| UI | React + Vite | Fast to build and iterate; huge ecosystem |
| Board rendering | SVG hexes, drawn by React | Crisp at any size, easy click targets, no game-engine overhead for 158 hexes |
| UI state | Zustand store holding the engine state + view state | Small; the engine already owns the game logic |
| Random numbers | Seeded sfc32 PRNG, state stored in the game state | Deterministic replays; 32-bit maths keeps the state plain JSON (PCG32 would need BigInt) |
| Rule config | JSON files validated with Zod | Edit numbers without code; bad configs fail loudly |
| Storage | IndexedDB for saved matches, JSON file export/import | Offline, no server |
| Tests | Vitest (unit), Playwright (a few end-to-end flows) | Fast, TypeScript-native |
| Hosting | Static site (e.g. GitHub Pages or Netlify) | Free, a link is all a playtester needs |

## Rules engine

The engine is a state machine: a command moves the match from one phase to the next, and any choice the rules need becomes a pending decision the coach must answer.

**Public API**

```ts
createMatch(config: RuleConfig, rosters: [Roster, Roster], seed: number): GameState
availableCommands(state: GameState): CommandOption[]  // legal, or greyed out with a reason
legalCommands(state: GameState): Command[]
apply(state: GameState, cmd: Command): { state: GameState; events: GameEvent[] }
previewRoll(state: GameState, cmd: Command): RollPreview | null   // target, modifiers, % chance
```

**Phases** (top level of the state machine)

1. `Setup` → the coin toss winner chooses to kick or receive (first half only), then each coach places players, kicking team first.
2. `KickOff` → kicker picks a hex, ball scatters and lands.
3. `Round` → alternating goes: activate a player, Wait, or spend Momentum.
4. `Activation` → the chosen player moves, blocks, passes, etc., step by step.
5. `HalfTime` / `FullTime` → after a touchdown or half time the pitch is cleared and the match goes straight back to `Setup`; at full time `winner` is set.

**Pending decisions** pause the engine until the coach answers:

- Use a Momentum re-roll after a failed Dodge (Dodge or stop is a choice between two step commands, with the Dodge's odds from `previewRoll`)
- Shove or Tackle, then which push hex and whether to follow up
- Use a Momentum re-roll after a failed roll
- Pick an interceptor (defending coach)
- Take a double activation or Wait

While a decision is pending, `legalCommands` returns only the answers to it. That keeps the UI dumb and the rules in one place.

**Inside the engine**, rules are split by area (`setup`, `round`, `movement`, `blocking`, `ball`, `passing`, `injury`, `momentum`, `drive`), each a set of pure functions over the state. A later rule change should touch one of these modules plus the config. `createEngine(modules)` wires them together, so tests can also run the engine with a stand-in module.

## Action flow

Every tap becomes a command; if the rules need a choice, the engine stops and asks, and the answer is just another command.

![[Screenshot 2026-10-21 at 20.39.25.png]]

Because answers to prompts are commands too, the log captures every decision a coach made, and a replay never needs the UI.

## Hex grid model

The engine uses axial coordinates for all maths and converts to row/column only for display and setup rules.

- **Layout:** pointy-top hexes, so each of the 9 rows runs straight from one end zone to the other. Odd rows have 18 hexes; even rows have 17 and sit half a hex in from each end, so both ends match.
- **Coordinates:** axial `(q, r)` inside the engine; `(col, row 1–9)` for humans and setup rules, with col 1–18 in odd rows and 1–17 in even rows (end zones = first and last col of each row, halfway line between col 9 and 10 of the long rows, halfway hexes = col 9 of the short rows, wide zones = rows 1–2 and 8–9).
- **Neighbours:** the 6 axial direction vectors; direction 1–6 doubles as the D6 face for scatter and bounce.
- **Distance:** cube distance, used for movement costs and pass range bands (1–3, 4–6, 7–9, 10–12).
- **Lines:** cube linear interpolation between hex centres gives the hexes a pass crosses, which decides who may intercept. Where the line runs along a hex edge, both hexes count, so the list can hold more than one hex per step.
- **Push hexes:** the 3 neighbours of the defender that are not adjacent to the attacker.
- **Pathing:** movement range is a Dijkstra search over MA, with +1 for Disengage, stops on entering enemy TZs, and Dodge/Sprint branches flagged so the UI can shade them.

All of this sits in one small `hex` module with its own tests, since every other rule depends on it.

## Data model

The whole match fits in one serialisable `GameState` object; nothing about the game lives outside it.

```ts
type Hex = { q: number; r: number }
type TeamId = 'home' | 'away'

type Player = {
  id: string; team: TeamId; position: string   // e.g. 'orc-blitzer'
  ma: number; st: number; ag: number; to: number // AG as target, e.g. 6 = 6+
  skills: string[]
  hex: Hex | null                               // null = off pitch
  status: 'standing' | 'prone' | 'stunned' | 'out' | 'casualty' | 'ejected'
  activatedThisRound: boolean
  winded: boolean
}

type GameState = {
  configId: string                              // e.g. 'rules-v10'
  configHash: string
  config: RuleConfig                            // carried along, so a state is self-contained
  rng: RngState                                 // seeded, advances on each roll
  phase: Phase
  half: 1 | 2; round: number
  turnOwner: TeamId                             // whose go it is
  kickingTeam: TeamId                           // kicks off this drive, sets up first
  openingKicker: TeamId | null                  // kicked off the first half; the other team kicks the second
  firstGo: TeamId                               // first go this round; alternates
  lastGoWasWait: boolean                        // two Waits end the round
  activation: { playerId: string; action: ActionType } | null
  doubleActivation: { team: TeamId; left: number } | null
  teams: Record<TeamId, { score: number; momentum: number; momentumUsedThisRound: boolean; usedThisRound: UsedLimits }>
  players: Record<string, Player>
  ball: { hex: Hex | null; carrier: string | null }
  pending: PendingDecision | null
  winner: TeamId | 'draw' | null                // set at full time
}

type Command =
  | { type: 'activate'; playerId: string; action: ActionType }
  | { type: 'wait' }
  | { type: 'endActivation' }
  | { type: 'move'; to: Hex; dodge?: true }      // one step; the UI sends a path from reachableHexes step by step
  | { type: 'standUp' }
  | { type: 'place'; playerId: string; hex: Hex } | { type: 'unplace'; playerId: string } | { type: 'endSetup' }
  | { type: 'kick'; hex: Hex }
  | { type: 'foul'; targetId: string }
  | { type: 'block'; targetId: string }          // then Shove or Tackle, push hex and follow-up are decisions
  | { type: 'pass'; target: Hex } | { type: 'handOff'; targetId: string }
  | { type: 'decide'; choice: string }          // also answers Momentum re-roll offers
  | { type: 'spendMomentum'; use: 'double' }

type GameEvent =
  | { type: 'rolled'; test: string; target: number; modifiers: Modifier[]; natural: number; success: boolean }
  | { type: 'moved'; playerId: string; path: Hex[] }
  | { type: 'knockedDown'; playerId: string }
  | { type: 'armourRolled'; playerId: string; red: number; white: number; modifiers: Modifier[]; broken: boolean }
  | { type: 'injured'; playerId: string; result: 'stunned' | 'out' | 'casualty' }
  // …pushed, ballBounced, touchdown, roundEnded
```

Events are what the UI animates and what the stats are counted from.

## Dice, rule config, logging and replay

A match file is just `{ format, seed, configId, configHash, rosters, entries[] }`, where each entry is a command with its events, a timestamp and an `undone` flag; replaying the commands through the engine rebuilds every state exactly.

**Dice**

- One `rollD10(test)` / `rollD6(purpose)` helper inside the engine draws from the seeded RNG stored in `GameState`.
- Every test goes through one function: `resolveTest(target, modifiers)` applies ±1 modifiers, natural 1 / 10, and returns a `rolled` event. One place to change if the dice rules change again.
- **Physical dice mode (P1):** the roll becomes a pending decision answered with the number the coach typed in. The log records it as a command, so replays still work.

**Rule config**

- `rules-v10.json` holds rounds per half, Momentum per half, Sprint bonus, injury bands, pass bands, modifier values and the rosters' position stats. `rules-v11.json` sits beside it. Its optional switches (`movement.tackleZones`, `movement.strengthDisengage`, `blocking.shoveNeedsEqualStrength`) turn on the v11 rules; left out, they give v10's, so the v10 config and its hash don't change.
- Validated with a Zod schema at load; a match refuses to start on an invalid config.
- Every match log stores the config id plus a hash of its contents, so stats are never mixed across rule versions by accident.

**Logging, replay, undo, stats**

- **Log:** commands are the source of truth; events and timestamps are stored beside them for stats and review.
- **Replay:** re-apply commands from the start to any step. Fast enough at a few hundred commands per match.
- **Undo:** drop the last command and replay. Only the last command can be undone, and not once it has used the dice (any die, not only a D10 test): replaying from the same seed would let a coach see the dice and then choose differently. The undone command is kept in the log, flagged.
- **Stats:** a `tools` function reads one or many logs and outputs the PRD metrics (length, rolls per activation, failure rates, Tackle/Shove split). Runs in the browser for one match and in Node for a batch.

## UI layer

The UI renders the engine state and turns clicks into commands; it holds no rules of its own.

- **Screens:** match setup (rosters, config, seed) → board → post-match stats. A replay viewer reuses the board in read-only mode.
- **Board:** SVG hex grid with players as tokens. Overlays for reachable hexes (normal, Disengage, Sprint), enemy tackle zones, pass range bands and possible interceptors.
- **Side panel:** whose go it is, round and half, Momentum left, activated players, and the roll preview (target, each modifier by name, final %).
- **Decisions:** pending decisions appear as a small prompt next to the player (e.g. "Dodge (50%) / Stop"), never as a modal over the board.
- **Log panel:** a scrolling list of events in plain words ("Orc Blitzer tackles Elf Catcher: 6+ +1, rolled 8, down").
- **Input:** mouse and touch the same way: tap a player, tap an action, tap a hex. Undo button always visible.

## Testing strategy

Most testing happens on the engine, where a fixed seed makes every rule reproducible.

- **Rule tests:** at least one unit test per v10 rule, written as "given this board, this command, these dice → expect this state". Dice are forced through a test RNG.
- **Hex tests:** neighbours, distance, lines and push hexes checked against hand-drawn cases, including pitch edges.
- **Odds tests:** `previewRoll` must match the true odds; a quick Monte Carlo check (10,000 rolls) per test type catches modifier bugs.
- **Golden replays:** a few saved match logs are replayed in CI; any change to their final state flags a rules change.
- **Random play:** a bot that picks random legal commands plays 1,000 matches per CI run. It catches crashes and stuck states, and gives a first rough read on match length in activations.
- **UI tests:** a handful of Playwright flows (start a match, move, block, score), not more.

## Later extensions

Both big extensions plug into the same engine API, so the MVP doesn't need to plan for them beyond keeping the engine pure.

- **AI opponent:** a bot calls `legalCommands`, scores each option (simple heuristics first, Monte Carlo search later) and returns a command. The random-play bot from testing is its first version. A decent AI also lets us simulate thousands of matches per rule change.
- **Online play:** a small server (e.g. Node on WebSockets) runs the same engine, holds the authoritative state and the RNG, and sends events to both clients. Since the match is just commands, reconnects and spectators come cheap.
- **Physical board companion:** the same engine can run as a referee app beside a real board: you enter moves, it handles odds, rolls and bookkeeping.

## Decisions

Resolved Oct 21, 2026.

- [x] **Rendering:** React + SVG. Animation is a non-goal, and since the engine doesn't depend on the renderer, a canvas library can still replace it later.
- [x] **Undo depth:** last command only, and not after a roll (see Logging, replay, undo, stats).
- [x] **Odds:** shown to both coaches. In hot-seat play both see the screen anyway.
- [x] **Match logs:** stored locally in IndexedDB and exported as JSON files. No upload until playtesters use their own devices.
- [x] **Devices:** hot-seat on one screen, as decided in the PRD. Two devices waits for online play.
- [x] **Builder:** Claude Code builds it and the designer reviews. Work is tracked as GitHub issues on `nielshaandbaek/orcball`.
