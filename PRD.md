# OrcBall Prototype — PRD

Oct 17, 2026 · @Niels

## Overview

The prototype is a browser-based, two-player hot-seat version of OrcBall rules v9, built to playtest the rules quickly and measure whether a match fits in 20 minutes with low randomness.

OrcBall is a fantasy football board game inspired by Blood Bowl: 7 players a side on an 18 × 9 hex pitch, alternating activations, D10 tests with ±1 modifiers, Shove/Tackle blocking and a "roll only under pressure" rule. The software enforces the rules so playtests test the design, not the players' memory of it. It also records every action, so each session produces data we can tune from.

A paper prototype (printed hex map, tokens, dice) can run in parallel for feel. The software exists for speed, rule consistency and data.

## Goals and non-goals

The prototype succeeds if two people can play a full, rules-correct match and we learn from the data whether the design hits its targets.

**Goals**

- Play a full match (2 halves × 4 rounds) with every v9 rule enforced automatically.
- Make odds visible: show the target number and modifiers before every roll, so play feels like calculated risk.
- Change rule numbers (MA, AG, TO, modifiers, rounds per half, Momentum count) without code changes.
- Log every action, roll and timestamp, and let us replay a match step by step.
- Report the key design metrics after each match: length, rolls per activation, failure rate, score.

**Non-goals (for now)**

- Online multiplayer, accounts or matchmaking.
- An AI opponent.
- Art, animation, sound or a polished UI. Clean and readable is enough.
- The full skill list, star players, leagues or team progression.
- The kick-off event table and weather (not yet in the rules).

## Users and playtest scenarios

The main user is the designer; secondary users are invited playtesters who know Blood Bowl or chess but not OrcBall.

| User | Needs | Typical session |
| --- | --- | --- |
| Designer | Tune numbers, compare rule versions, read stats | Solo test of a scenario, or a full match against a friend |
| Playtester | Learn fast, see legal moves and odds, no rulebook lookups | One or two full matches, then a short feedback form |
| Observer | Watch and review a match afterwards | Replay of a saved match log |

**Scenarios to support**

1. **Full match:** two players share one screen and play 2 halves from kick-off to final whistle.
2. **Scenario setup:** the designer places players and the ball freely to test one situation (e.g. breaking a deep defence).
3. **Rule A/B test:** the same scenario is played under two rule configs and the stats compared.
4. **Replay review:** a saved match is stepped through action by action, with each roll and its odds shown.

## Scope

The MVP is the smallest thing that plays a full rules-correct match and logs it; everything else waits until the first playtests.

| Feature | Priority | Notes |
| --- | --- | --- |
| Hex pitch, setup and kick-off | P0 — MVP | 18 × 9, wide zones, free setup |
| Rounds, alternating activations, Wait, double activation | P0 — MVP | Core turn engine |
| Movement: zone of control, Dodge, Sprint, stand up | P0 — MVP |  |
| Blocking: Shove, Tackle, assists, push-back, follow-up | P0 — MVP |  |
| Armour & injury, Stunned / Out / Casualty | P0 — MVP |  |
| Ball: pick-up, pass, hand-off, catch, interception, scatter, throw-in | P0 — MVP |  |
| Fouls, Momentum tokens, touchdowns, half time | P0 — MVP |  |
| Two starter rosters (one strong, one agile) | P0 — MVP | Enough to test asymmetry |
| Odds preview before each roll | P0 — MVP | Target, modifiers, % chance |
| Action log with JSON export | P0 — MVP |  |
| Undo last action | P0 — MVP | For misclicks; logged |
| Rule config editor (numbers only) | P1 — Soon after |  |
| Replay viewer | P1 — Soon after |  |
| Post-match stats screen | P1 — Soon after |  |
| Scenario editor | P1 — Soon after |  |
| Physical dice mode (type in your own rolls) | P1 — Soon after | For table play with real dice |
| A handful of skills (Block, Dodge, Mighty Blow, Sure Hands) | P1 — Soon after |  |
| AI opponent | P2 — Later |  |
| Online multiplayer | P2 — Later |  |

## Functional requirements

The app enforces rules v9 and only offers legal actions; anything illegal is greyed out with a one-line reason.

**Board and setup**

- FR-1: Render an 18 × 9 hex pitch with end zones, halfway line and wide zones marked.
- FR-2: Setup enforces max 1 player per wide zone, own half only, max 7 on the pitch. No Line of Scrimmage minimum.
- FR-3: Kick-off: kicker picks a hex, the app scatters it (D6 direction × D6 hexes), then resolves catch, bounce or touchback.

**Rounds and activations**

- FR-4: Show whose go it is, the round and half, and which players have activated.
- FR-5: On each go the coach picks a player and an action, or Waits. Two Waits in a row end the round.
- FR-6: Enforce once-per-round-per-team limits on Blitz, Pass, Hand-off and Foul.
- FR-7: After a failed roll, fumble or interception, give the opponent a double activation and show it clearly.
- FR-8: Momentum: 2 per half, max one per round, spent on a re-roll or a double activation.

**Movement**

- FR-9: Highlight reachable hexes with their MA cost, including Disengage (+1) and Sprint (+2) hexes in a different shade.
- FR-10: Stop movement on entering an enemy TZ, unless the coach chooses to Dodge (show its odds first).
- FR-11: Apply Winded markers after a Sprint and clear them on the player's next activation.

**Blocking, injuries, fouls**

- FR-12: Show both Strength totals with assists before the coach picks Shove or Tackle.
- FR-13: Resolve push-backs (3 push hexes, chain pushes, crowd rule) with the attacker choosing the hex.
- FR-14: Roll armour and injury together (red/white D10) and apply Stunned / Out / Casualty.
- FR-15: Fouls add assists to the armour die; a natural 1 or 10 ejects the fouler.

**Ball**

- FR-16: Free pick-ups and catches when unmarked and accurate; rolls when marked or the ball is loose.
- FR-17: Pass range in hexes with band modifiers; show possible interceptors along the line before the throw.
- FR-18: Resolve fumbles, scatters (3 × D6), bounces and throw-ins on the hex grid.

**Dice and odds**

- FR-19: Every test shows target, each modifier by name and the final % before the coach confirms.
- FR-20: Natural 1 always fails, natural 10 always succeeds.

**Match flow**

- FR-21: Touchdowns end the round and drive, then reset for kick-off. Half time and full time after round 4.
- FR-22: Out players return at the next kick-off; Casualties are removed for the match.

## Playtest tooling

Every match is a dataset: the log is the source of truth, and replay, stats and A/B comparisons are all built from it.

- **Action log:** each entry records the action, the player, the hexes involved, every roll (target, modifiers, natural result, outcome), Momentum use and a timestamp. Exportable as JSON.
- **Replay:** load a log and step forwards or backwards one action at a time. The same seed and actions always rebuild the same game.
- **Undo:** take back the last action. Undos stay in the log, flagged, so stats can ignore or count them.
- **Rule config:** all numbers live in one versioned config file (e.g. `rules-v9.json`): stats per position, modifiers, Sprint bonus, rounds per half, Momentum count, injury bands. The log records which config a match used.
- **Stats screen** after each match:
  - match length in minutes, plus time per activation
  - rolls per activation, and share of activations with zero rolls
  - roll failure rate by action type
  - double activations triggered and Momentum spent
  - touchdowns, drives, injuries by type
- **Feedback form:** 3–5 quick questions after the match (fun, length, "did the dice decide it?"), saved with the log.

## Non-functional requirements

The prototype must be fast to change and trustworthy in its rules; looks and scale don't matter yet.

- **Platform:** runs in a current desktop browser and on a tablet (touch). No install, no server needed for hot-seat play.
- **Responsiveness:** any action resolves and redraws in under 200 ms, so the app never slows a 20-minute match.
- **Determinism:** a seeded random number generator; same seed + same actions = same match.
- **Correctness:** the rules engine is covered by automated tests, one or more per rule in v9.
- **Changeability:** a rule-number change is a config edit; a rule-logic change touches one module.
- **Offline:** works without a network; logs are saved locally and exported as files.
- **Readability:** board, odds and log readable at arm's length on a 10-inch tablet.

## Success metrics

Each metric maps to a design goal and comes straight from the match log or feedback form; first targets are guesses to refine after 10 matches.

| Design goal | Metric | First target |
| --- | --- | --- |
| 20-minute match | Median match length | 15–25 min |
| 20-minute match | Median time per activation | ≤ 10 s |
| Low randomness | Activations with zero rolls | ≥ 60% |
| Low randomness | Players answering "the dice decided it" | ≤ 25% |
| Defence not too strong | Matches ending 0–0 | ≤ 20% |
| Scoring feels right | Touchdowns per match (both teams) | 2–4 |
| Teams balanced | Win rate, strong vs agile roster | 40–60% |
| Tactical depth | Share of blocks chosen as Tackle vs Shove | 30–70% (both used) |

## Milestones

The build runs in four phases, each closed by a gate; dates are open until we know who builds it and how much time it gets.

&#91;embedded content: prototype roadmap · 4 phases, each with an exit gate\]

Phase 2 is the one that matters most: as soon as a full match plays, real playtests can start, even before the tooling is finished.

## Open questions

- [ ] Hot-seat on one screen, or two devices on a local network from the start?
- [ ] Which two starter rosters? Proposal: Orcs (strong, slow) vs Elves (agile, fragile), 3–4 positions each.
- [ ] Digital dice only, or a physical dice mode from day one?
- [ ] Should undo be unlimited, or only the last action?
- [ ] Ball scatter and the kick-off table are still Blood Bowl-style: test as-is, or rework before building?
- [ ] Who are the first playtesters, and how many matches before the first rules revision?
