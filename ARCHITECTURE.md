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
| Repo | pnpm workspace, 4 packages: `engine`, `web`, `tools`, `ai` | Keeps the engine free of UI dependencies |
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

- `rules-v10.json` holds rounds per half, Momentum per half, Sprint bonus, injury bands, pass bands, modifier values and the rosters' position stats. `rules-v11.json` sits beside it. Its optional switches (`movement.tackleZones`, `movement.strengthDisengage`, `blocking.shoveNeedsEqualStrength`) turn on the v11 rules; left out, they give v10's, so the v10 config and its hash don't change. `rules-v12.json` adds `blocking.missedTackleChoice` and the first skills on positions (Block, Brace); skill names are checked against the list the engine knows. `rules-v13.json` adds `blocking.blockSkillWithAssists`: Block counts on assisted Tackles too. `rules-v14.json` changes only the Elves' roster: one Wardancer and three Linemen. `rules-v15.json` adds `ball.naturalTenAlwaysPasses` (a natural 10 on a pass is never a fumble), sets `movement.sprintBonus` to 1 and takes 1 MA off every Elf position. `rules-v16.json` adds `activations.noEmptyActivation` (an activation can't end before the player has done something, and Waiting in place of a double's second activation is a Wait) and `activations.cancelBeforeActing` (the `cancelActivation` command), and gives the Elf Catchers the new Dodge and Catch skills; Guard is known to the engine but on no position yet. A skill only acts for players whose roster gives it, so new skills need no switch.
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
- **Layout (#128):** wider than 900px the match screen fills the window. The board is as big as its area allows, and under it a bar holds the ticker and messages on the left and the play panel laid out sideways: whose go it is, a dot per player left to activate, Wait and Momentum, the selected player's card (his actions are in his pop-up), the active player's controls, the roll preview a line per roll, Undo. The bar is one fixed height whatever is in it, so the board never changes size with it: a greyed-out button's reason is its tooltip (`ReasonButton`; tapped anyway, as on a touch screen, it goes in the message line), and the ticker and message are cut short at two lines. During setup the bench lies over the other team's half of the board, see-through, with Peek to hide it for two seconds. On windows wider than 21:10 the panel goes beside the board instead; on narrow screens everything stacks and scrolls, with the bench in the panel.
- **Header:** the score with each team's Momentum as tokens beside it, round and half, Log, Full screen, New match, and a "⋯" menu with Export match, Import match and icons or initials.
- **Decisions:** pending decisions appear as a small prompt next to the player (e.g. "Dodge (50%) / Stop"), never as a modal over the board.
- **Actions on the board:** tapping one of your players shows his actions in the same kind of prompt; during his activation, tapping him again shows Stand up, Aim pass and End activation (they also open by themselves when nothing is left to do on the board). The prompt opens towards his own end, clear of any target, and stays on screen, so a phone needn't scroll to the panel. The panel keeps the same buttons.
- **Match log:** a scrolling list of events in plain words ("Orc Blitzer tackles Elf Catcher: 6+ +1, rolled 8, down"). Hidden by default (#127): the header's Log button, or the one-line ticker under the board with the newest entry, opens it as a panel over the board. While it's open the computer waits.
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

- **AI opponent:** now planned; see "Computer opponent" below.
- **Online play:** a small server (e.g. Node on WebSockets) runs the same engine, holds the authoritative state and the RNG, and sends events to both clients. Since the match is just commands, reconnects and spectators come cheap.
- **Physical board companion:** the same engine can run as a referee app beside a real board: you enter moves, it handles odds, rolls and bookkeeping.

## Computer opponent

The computer opponent is one more client of the engine: it reads the same state and command options as the UI, and answers with commands. Requirements are in `PRD.md` under "Computer opponents".

**Where it lives**

- A fourth package, `ai`: plain TypeScript with only `engine` and Zod (for the weights file, as the engine uses it for the rule config) as dependencies, so it runs anywhere the engine does.
- In the web app it runs in a Web Worker, so the page stays responsive while it thinks. No server, and offline play keeps working.
- In `tools` it runs in Node for computer-against-computer batches.

**API**

```ts
chooseCommand(view: AiView, me: TeamId, options: { level: AiLevel; budgetMs: number; seed: number }):
  { command: Command; reason: string }
type AiLevel = 'novice' | 'intermediate' | 'expert'
```

The app calls it whenever the computer's team has to act: on its go, during its activation, or when a pending decision is addressed to it. It returns one command at a time. During the computer's activation, decisions that belong to the human (catch or let it bounce, picking an interceptor) are still answered in the UI as usual.

**Fairness**

- `AiView` is the `GameState` without the RNG. The RNG state would let a program work out every future roll, so the computer never sees it.
- When it looks ahead, it doesn't roll dice: it branches on outcomes (success, failure, natural 1) weighted by the odds from `previewRolls`, and replays each branch with forced dice. D6 results (scatter, bounce, throw-in) are sampled a few times rather than enumerated.
- It uses no other information than a coach has: the board, the log and the odds.

**Plans, not steps**

- The engine moves one hex per command, which is far too fine-grained to search. The computer searches over **plans**: a whole activation such as "Blitzer: move to (10,4), Tackle the Elf carrier", "Thrower: step back 2, pass to (14,3)", or Wait.
- Candidate plans come from the command options and `reachableHexes`, pruned to useful targets: the ball, scoring hexes, marking or caging the carrier, assist hexes, blocks, passes and hand-offs to team-mates, and fouls.
- A chosen plan is carried out one command at a time. Whenever the state differs from what the plan expected (a failed roll, a decision), it plans again.

**Choosing: expected value with search depth**

- Every candidate is scored by the **expected value** of the position it leads to: each outcome's evaluation, weighted by its chance. This one method handles every safe-versus-gamble choice (Shove or Tackle, Dodge or Strength Disengage, Wait or activate). Because failures are scored by what they cost (the opponent's double activation, an injury risk, a loose ball), it plays safer when ahead and gambles when behind, without special cases.
- **Levels differ only in search depth**, with no deliberate mistakes:
  - **Novice:** looks one activation ahead (its own).
  - **Intermediate:** also considers the opponent's best reply.
  - **Expert:** iterative deepening, as far as the time budget allows.
- **Time budget:** at most 10 seconds per decision. The search deepens until the budget runs out and then plays its best plan so far, so on a slow phone Expert sees a little less far ahead. Novice should answer almost at once.
- **Decisions** (push hex, follow-up, catch, re-roll, interceptor) and the coin toss are scored the same way, one step deep.
- **Setup and kick-off** aren't searched: a few formation templates per roster (data, like the rule config) are scored with the evaluation, and the kick target is the candidate hex with the best expected outcome.

**As built: plans and Novice** (`packages/ai/src/plans.ts`, `search.ts`, `novice.ts`)

- **Candidates:** for each player who can still activate: a Move to every hex `reachableHexes` gives (affordable one activation ahead at the measured speed), a Block on each adjacent standing opponent, a Blitz on each standing opponent from the two cheapest approach hexes (fewest Dodges, then least MA), a Pass from where the carrier stands to each team-mate in range, a Hand-off from the cheapest hex next to each team-mate, and a Foul from the cheapest hex next to each opponent who is down. A Stunned player's only plan is turning face up. Mid-activation, the active player's own action, or stopping.
- **Carrying out:** `chooseCommand` re-plans before every command and sends the first command of the best plan. A plan step is checked against the engine's legal commands, so a plan never sends an illegal one; when the state no longer fits (a failed roll ended the activation), the plan stops.
- **Chance:** every roll the engine previews branches into success, failure and a natural 1, with the preview's odds. A Momentum re-roll is branched the same way, from the failed roll. A pass someone may intercept is sampled 4 times, since the interception roll comes first. Everything else (D6 scatter and bounces, armour, injury) is one sample from the computer's dice. Those dice are seeded from the position and the command, not a running count, so plans are compared on the same luck and re-planning halfway through a plan sees the dice it saw at the start.
- **Decisions** inside a plan, the computer's or the opponent's, are answered two steps deep: each choice's expected value, with the decisions it leads to answered too. Where a block pushes and whether the attacker follows up don't count as steps: they roll no dice and come before the knock-down, so counting them scored a Tackle before its knock-down happened, as no better than a Shove (#119). The opponent's answers maximise its own score, which, the evaluation being zero-sum, is minus ours. Once a plan's own commands are done, or after three decisions in a row (a ball bouncing from player to player), the rest is scored that way rather than followed further.
- **Safety:** a search past the time budget, or past 40,000 simulated commands, stops looking ahead and takes the evaluation as it stands.
- **Novice** takes the plan with the best expected value, or Waits if that's better. It doesn't spend Momentum on double activations: one activation ahead, it can't see what the second activation would bring. It does use Momentum for re-rolls when the re-roll's expected value beats the token's.
- **Setup** uses the formation templates in `packages/ai/formations/default.json`: per roster, two for kicking and two for receiving, laid out for the home side and mirrored for away. Each is scored with the evaluation against the opponent's setup so far, and the best one is placed. **Kick-off** tries every other hex in the receiving half, three samples each, and kicks at the best.

**As built: Intermediate and Expert** (#63, `packages/ai/src/deep.ts`)

- **Plies:** a ply is one go: a plan (a whole activation) or a Wait. Intermediate searches two plies, its own plan and then the best go of whoever acts next. Expert deepens one ply at a time, up to four. It stops when a search took more than a tenth of the budget, since the next one would likely not finish. It plays the best plan of the deepest search it finished.
- **Expectimax with a beam:** every candidate is first scored one ply deep, as Novice scores it. The best 8 at the top (4 below it) are searched further. A plan is followed through its decisions to where the activation ends. The play goes on from its likeliest end positions, at most 3 and until they cover 80% of the chance. The rarer ones are scored as they stand, adjusted by the average change the search made to the others. The computer maximises the evaluation, the other team minimises it, and the dice are averaged over.
- **Replies are pruned exactly:** a plain move (no rolls) by a player without the ball only counts in the evaluation through who he ends up next to, how near he is to a loose ball, and whether he Sprinted. Moves that roll the same Dodges on the same hexes and end alike score the same one ply deep (`moveKey`; `deep.test.ts` checks this on positions from random play), so below the top only one of them is tried. Most reply moves are such duplicates.
- **Time:** the 10-second budget is hard. A search that runs out stops, and a candidate it didn't finish isn't counted. At the top, a search cut short still counts if it got through the previous best (searched first).
- **Keeping a plan:** a deep search takes a fraction of a second to seconds, and a plan is a dozen commands. So when the match goes as the chosen plan expected (a step with no roll, a roll that succeeds), the next command comes from the plan without searching again. Anything unexpected gives a position the plan didn't expect, and the computer searches again.
- Decisions, setup and kick-off are as for Novice.

**Evaluation**

- A weighted sum of features: score; who has the ball; how far the carrier is from scoring; the carrier's safety (enemy tackle zones on him, opponents who can still reach him this round); team-mates around the carrier; for a loose ball, which side is nearer to it; players standing, down, out or injured on each side; marked opponents; the lead, counting for more the less of the match is left; Momentum; pending double activations.
- Every feature is one team's value minus the other's, so a position scores the same for one team as minus the other's (zero-sum), and the same for either end of the pitch. `evaluate(view, me)` (`packages/ai/src/evaluate.ts`) returns the total and each feature's contribution, which the reasons in the log draw on.
- The weights are a JSON file (`packages/ai/weights/default.json`), validated like the rule config, so tuning is a data change. Roster styles (Orcs grind, Elves run) can come later as weight overrides plus a single risk-attitude setting.
- The weights are tuned by computer-against-computer play.

**Reasons in the log**

Each plan carries a short reason built from its plan and its main scoring terms, e.g. "Blitzer 1 Blitzes Elf Catcher 1: Tackle 60%, ball carrier". The UI writes it into the log next to the action.

As built (#61, `packages/ai/src/reasons.ts`): a reason is the plan's action with names ("Blitzer 1 Blitzes Elves Lineman 1 from (10, 5)"), then what it's for, "to win the ball and knock a player down", from the evaluation terms that gain most along the plan's all-success line (at most two, gains under 0.25 left out), then the odds of the rolls the plan itself makes, as the board previews them: "(Dodge 70%, Tackle 50%)". Rolls the board shows no odds for (an unmarked pick-up or catch) aren't listed, and nothing depends on the dice to come. Decisions read as actions ("Tackles (50%)", "Follows up", "Gives the ball to Wardancer 1"), setup as "Sets up to kick in the Wall formation". Each choice also carries a plan key shared by the commands of one plan, so the log shows the reason once; ending an activation adds no reason.

**Determinism**

The computer has its own seeded RNG (seeded from the match seed and the command count) for tie-breaks and D6 samples. The same position at the same level gives the same command, so a bad move can be reproduced. The match file needs no change: the computer's commands are logged like anyone else's.

**In the web app**

- **Start screen:** Opponent: human, or computer at Novice, Intermediate or Expert. The computer's team is random by default and can be picked.
- **Pacing:** the computer plays one command at a time, with a short pause (about 0.7 s) between them, and walks paths hex by hex so the human can follow.
- **Undo:** not available in a match against the computer.
- **As built (#62):** `packages/web/src/ai.worker.ts` runs `chooseCommand` in the worker; `computer.ts` starts the worker when the app loads (so the service worker caches it for offline play) and sends it `viewOf(state)`, never the dice. The store asks it whenever `actingTeam` is the computer's (its go, its activation, a decision addressed to it) and sends the answer after the pause. Who the computer is and its reasons are saved in IndexedDB beside the match, not in the match file, so a reload resumes the computer's go. An imported match plays hot-seat. The log shows a reason once per plan, before the actions it led to.
- **Rules:** the computer targets the current rules version. It only learns the rules through the engine, so a rule change needs no AI code change, at most a re-tune of the weights.

**In the tools**

- A match runner plays computer against computer (any level against any level, or against the random bot) for N matches, swapping sides halfway to cancel out any home or away advantage.
- It reports wins, draws and losses, touchdowns, activations and the time per decision.
- The same runner gives balance reports: rules versions or rosters against each other at a fixed level.

**Performance**

`pnpm --filter @orcball/tools bench` measures the engine on positions from random matches. On a laptop (Apple A18 Pro, Node 26, rules v12, 245 positions), before and after the speed-ups for #63:

| Call | Before | After |
| --- | --- | --- |
| `apply` | 44,000/s | 83,000/s |
| `availableCommands` | 377,000/s | 540,000/s |
| `reachableHexes` (one player) | 3,700/s | 10,600/s |

- **`apply`** shares the rule config with the copy (it never changes during a match) and copies players field by field (`clone.ts`; `clone.test.ts` checks the copy shares nothing else). `applyLegal` skips the legality check for a search that took its commands from `legalCommands`.
- **`reachableHexes`** looks up who stands where and the tackle zones once per call instead of per step, and keeps its queue in a heap.
- **The search** memoises per position: a command's outcomes, the evaluation, decisions and legal commands. Plans that share their first steps share the work, and each reply search drops its memos when it's done.

Novice's time over 250 positions from Novice matches went from 25 s to 3.2 s (median 3 ms a decision, worst 0.2 s). Intermediate on a fifth of them: median 0.17 s, worst 2 s, without the time limit.

**Done when** (see Decisions below)

- Novice wins at least 90% of matches against the random bot (draws don't count as wins).
- Each level wins at least 60% of matches against the level below, over at least 200 matches with sides swapped.
- No decision takes longer than 10 seconds on a laptop.

## Decisions

Resolved Oct 21, 2026.

- [x] **Rendering:** React + SVG. Animation is a non-goal, and since the engine doesn't depend on the renderer, a canvas library can still replace it later.
- [x] **Undo depth:** last command only, and not after a roll (see Logging, replay, undo, stats).
- [x] **Odds:** shown to both coaches. In hot-seat play both see the screen anyway.
- [x] **Match logs:** stored locally in IndexedDB and exported as JSON files. No upload until playtesters use their own devices.
- [x] **Devices:** hot-seat on one screen, as decided in the PRD. Two devices waits for online play.
- [x] **Builder:** Claude Code builds it and the designer reviews. Work is tracked as GitHub issues on `nielshaandbaek/orcball`.

Computer opponent, resolved Oct 31, 2026:

- [x] **Beating the random bot:** at least 90% of matches won; draws don't count as wins. Each level must also win at least 60% of matches against the level below.
- [x] **Computer against computer:** a batch run in `tools` that prints a report. Watching such a match in the browser can come later.
- [x] **Computer's side:** random by default, and the start screen can pick it.
- [x] **Slow devices:** the 10-second budget is a hard limit; on a slow phone Expert searches less deep rather than taking longer.
