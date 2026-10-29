# OrcBall Prototype — PRD

Oct 17, 2026 · @Niels

## Overview

The prototype is a browser-based, two-player hot-seat version of OrcBall rules v10, built to playtest the rules quickly and measure whether a match fits in 20 minutes with low randomness.

OrcBall is a fantasy football board game inspired by Blood Bowl: 7 players a side on a 9-row hex pitch with rows of 18 and 17 hexes, alternating activations, D10 tests with ±1 modifiers, Shove/Tackle blocking and a "roll only under pressure" rule. The software enforces the rules so playtests test the design, not the players' memory of it. It also records every action, so each session produces data we can tune from.

A paper prototype (printed hex map, tokens, dice) can run in parallel for feel. The software exists for speed, rule consistency and data.

## Goals and non-goals

The prototype succeeds if two people can play a full, rules-correct match and we learn from the data whether the design hits its targets.

**Goals**

- Play a full match (2 halves × 4 rounds) with every v10 rule enforced automatically.
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
| Hex pitch, setup and kick-off | P0 — MVP | 9 rows of 18 / 17 hexes, wide zones, halfway hexes, free setup |
| Rounds, alternating activations, Wait, double activation | P0 — MVP | Core turn engine |
| Movement: zone of control, Dodge, Sprint, stand up | P0 — MVP |  |
| Blocking: Shove, Tackle, assists, push-back, follow-up | P0 — MVP |  |
| Armour & injury, Stunned / Out / Casualty | P0 — MVP |  |
| Ball: pick-up, pass, hand-off, catch, interception, scatter, throw-in | P0 — MVP |  |
| Fouls, Momentum tokens, touchdowns, half time | P0 — MVP |  |
| Two starter rosters (one strong, one agile) | P0 — MVP | Orcs vs Elves, 3–4 positions each |
| Odds preview before each roll | P0 — MVP | Target, modifiers, % chance |
| Action log with JSON export | P0 — MVP |  |
| Undo last action | P0 — MVP | For misclicks; not after a roll; logged |
| Rule config editor (numbers only) | P1 — Soon after |  |
| Replay viewer | P1 — Soon after |  |
| Post-match stats screen | P1 — Soon after |  |
| Scenario editor | P1 — Soon after |  |
| Physical dice mode (type in your own rolls) | P1 — Soon after | For table play with real dice |
| A handful of skills (Block, Dodge, Mighty Blow, Sure Hands) | P1 — Soon after | Full draft list in [Skills (draft)](#skills-draft) |
| AI opponent | P2 — Later | Requirements in [Computer opponents](#computer-opponents-requirements) |
| Online multiplayer | P2 — Later |  |

## Functional requirements

The app enforces rules v10 and only offers legal actions; anything illegal is greyed out with a one-line reason.

**Board and setup**

- FR-1: Render the 158-hex pitch (rows of 18 and 17) with end zones, halfway line, halfway hexes and wide zones marked.
- FR-2: Setup enforces max 1 player per wide zone, own half only (never a halfway hex), max 7 on the pitch. No Line of Scrimmage minimum.
- FR-3: Kick-off: kicker picks a hex, the app scatters it (D6 direction × D6 hexes), then resolves catch, bounce or touchback. Landing on a halfway hex is a touchback.

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
- **Undo:** take back the last action, unless it rolled dice. Undos stay in the log, flagged, so stats can ignore or count them.
- **Rule config:** all numbers live in one versioned config file (e.g. `rules-v10.json`): stats per position, modifiers, Sprint bonus, rounds per half, Momentum count, injury bands. The log records which config a match used.
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
- **Correctness:** the rules engine is covered by automated tests, one or more per rule in v10.
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

## Skills (draft)

Status: open for the designer to fill in. Nothing here is built yet.

The skill list follows the Blood Bowl Competition Rules categories. OrcBall skills follow two rules:

- **No re-rolls.** A Blood Bowl skill that gives a re-roll becomes either **+1 on that roll** or a **new ability**. Momentum stays the only re-roll in the game.
- **Small steps.** Every modifier is worth 10% on the D10, so +1 is a real but modest edge. A skill shouldn't stack more than +1 on any one roll.

"Suggested" is my recommendation, written for the v11 rules: Dodge when leaving a tackle zone, Strength Disengage, Shove or Tackle, and armour and injury on a red and a white D10. "Your call" is for your version. Leave it empty to accept the suggestion, or write "cut" to drop the skill.

### General

| Skill | Blood Bowl | Suggested for OrcBall | Your call |
|---|---|---|---|
| Block | Not knocked down on a Both Down result | A natural 1 on his Tackle is just a miss; he isn't knocked down. Already in RULES.md §5. | |
| Dauntless | Rolls to match a stronger opponent's ST when blocking | Against a stronger defender, his ST counts as the defender's ST. So he can always Shove, and he Tackles at even odds before assists. | |
| Dirty Player | +1 to the armour or injury roll on a foul | +1 to the red die when he fouls | |
| Fend | An attacker can't follow up after pushing him | Same: an attacker who pushes him can't follow up | |
| Frenzy | Must follow up; blocks a second time if the first block pushed | Must follow up. After a successful Shove he must block the same player again (Shove or Tackle) if the player is still standing and adjacent. | |
| Kick | Halves the kick-off scatter | If he is on the pitch at kick-off, the kick scatters the lowest of 3D6 hexes instead of 2D6 | |
| Kick-Off Return | Moves up to 3 squares once the kick is placed | Once the ball has scattered, before it comes down, he may move up to 2 hexes, ignoring tackle zones | |
| Pass Block | Moves up to 3 squares when an opponent declares a pass | When an opponent declares a Pass, he may step 1 hex before the throw, with no Dodge, for example into the pass line | |
| Pro | Re-roll one die per turn on a 4+ | Once per activation, +1 on any one roll he makes, declared before rolling | |
| Shadowing | May follow a player who dodges away from him | When a player he marks leaves his tackle zone, he may step into the hex that player left | |
| Strip Ball | A carrier he pushes drops the ball | A ball carrier he pushes with a Shove drops the ball, which bounces | |
| Sure Hands | Re-roll a failed pick-up; ignores Strip Ball | +1 on pick-ups; Strip Ball doesn't work on him | |
| Tackle | Opponents can't use Dodge when dodging away from him or blocked by him | A player Dodging out of his tackle zone gets an extra −1, and the Dodge skill doesn't help them | |
| Wrestle | On Both Down, both players are placed prone with no armour roll | Third block option: Wrestle. No roll; both players are placed prone with no armour roll, and a carrier drops the ball. His activation ends. | |

### Agility

| Skill | Blood Bowl | Suggested for OrcBall | Your call |
|---|---|---|---|
| Catch | Re-roll a failed catch | +1 on catches, including the choice to catch a loose ball | |
| Diving Catch | +1 to catch an accurate pass; may catch a ball landing in an adjacent square | May try to catch a pass, scatter or bounce coming down in an adjacent empty hex; he moves into it to catch | |
| Diving Tackle | −2 to an opponent dodging away from him; he then goes prone | When a player Dodges out of his tackle zone, he may dive: −2 on that Dodge, then he is placed prone (no armour roll) | |
| Dodge | Re-roll a failed dodge; helps against Defender Stumbles | +1 on Dodges, and −1 on Tackles against him. The second half is already in RULES.md §5. | |
| Jump Up | Stands up for free; may block from prone | Standing up costs no MA | |
| Leap | Jumps over one square, ignoring tackle zones, with an AG roll | Jumps to a free hex 2 away in a straight line, over anything, for 2 MA. AG roll at −1 instead of any Dodge; on a fail he is Knocked Down where he lands. | |
| Side Step | Chooses where he is pushed | Chooses where he is pushed: any free neighbouring hex | |
| Sneaky Git | Not sent off for a foul unless he rolls a double | Only a natural 10 on the red die ejects him (10% instead of 20%) | |
| Sprint | One extra Go For It | Sprint allows +3 MA instead of +2 | |
| Sure Feet | Re-roll a failed Go For It | Sprinting doesn't leave him Winded | |

### Passing

| Skill | Blood Bowl | Suggested for OrcBall | Your call |
|---|---|---|---|
| Accurate | +1 to pass | A missed pass scatters once from the target instead of 3 times | |
| Dump-Off | When blocked, may make a Quick pass first | When he is blocked, before the Shove or Tackle, he may throw a Quick pass (1–3 hexes). It doesn't use the team's Pass for the round. | |
| Hail Mary Pass | Throws anywhere; never accurate | May throw to any hex. The ball always scatters 3 times from the target, and can't be intercepted. | |
| Leader | An extra team re-roll | +1 Momentum token per half while he is on the pitch at kick-off. Momentum is the game's own re-roll, so you may prefer to cut this. | |
| Nerves of Steel | Ignores tackle zones when passing or catching | Same: no −1 per tackle zone on his passes or catches | |
| Pass | Re-roll a failed pass | +1 on passes | |
| Safe Throw | A successful interception is cancelled on a roll; can't fumble | Interceptions of his passes are at an extra −2 | |

### Strength

| Skill | Blood Bowl | Suggested for OrcBall | Your call |
|---|---|---|---|
| Break Tackle | Uses ST instead of AG for one dodge per turn | +1 ST for the Strength Disengage, so he can break away from stronger markers | |
| Grab | Chooses any free square to push into | When he pushes, he picks any free hex next to the defender, not only the 3 far ones | |
| Guard | Assists even when marked | Same: gives assists even when in other enemy tackle zones | |
| Juggernaut | On a Blitz, cancels Fend, Stand Firm and Wrestle | On a Blitz, his Shove ignores Fend and Stand Firm, and pushes into the crowd without the 2-point margin | |
| Mighty Blow | +1 to armour or injury | +1 to the red or white die (his choice) after his successful Tackle. Already in RULES.md §5. | |
| Multiple Block | Blocks two players at once, each at +2 ST | Blocks two adjacent opponents at once, Tackle only, at −1 on each roll. It counts as one block. | |
| Piling On | Re-rolls armour or injury, then goes prone | After his successful Tackle he may pile on: +1 on the red and the white die, then he is placed prone and his activation ends | |
| Stand Firm | May choose not to be pushed | May choose not to be pushed. A Tackle still knocks him down where he stands. | |
| Strong Arm | +1 to passes beyond Quick range | His passes count one range band shorter (a Long pass is thrown as Short) | |
| Thick Skull | Knocked out only on a 9 | A white die of 8 counts as Stunned instead of Out | |

### Extraordinary

These belong to big guys, secret weapons and special teams that the starter rosters don't have. I'd leave them until those rosters come in. Most are drawbacks that balance a strong player.

| Skill | Blood Bowl | Suggested for OrcBall | Your call |
|---|---|---|---|
| Always Hungry | May eat the team-mate he tries to throw | Later, with Throw Team-Mate | |
| Animosity | May refuse to hand off or pass to some team-mates | Later | |
| Ball & Chain | Moves randomly and blocks whatever it hits | Later | |
| Blood Lust | Must feed on a team-mate or leave the pitch | Later | |
| Bombardier | Throws bombs | Later | |
| Bone-head | On a 1, does nothing this turn and loses tackle zones | Later. Fits the "drawback" idea: D10 1 at activation, no action and no tackle zone until next activation | |
| Chainsaw | Attacks with an armour roll at +3 instead of blocking | Later | |
| Decay | Rolls twice on the casualty table | Later | |
| Fan Favourite | Adds to the fan factor | Cut: no fans in OrcBall | |
| Hypnotic Gaze | Removes an adjacent opponent's tackle zone | Later. New ability: AG roll, on a success an adjacent opponent loses his tackle zone until his next activation | |
| Loner | Must roll to use team re-rolls | Cut, or: can't use Momentum | |
| No Hands | Can't touch the ball | Same: can never pick up, catch or carry the ball | |
| Nurgle's Rot | Victims may join the Nurgle team | Cut: no leagues | |
| Really Stupid | On a low roll, does nothing unless a team-mate helps | Later | |
| Regeneration | May recover from a casualty | Later. On a white-die Casualty, D10 6+ makes it Out instead | |
| Right Stuff | Can be thrown by a team-mate | Later, with Throw Team-Mate | |
| Secret Weapon | Sent off at the end of the drive | Later | |
| Stab | Attacks with an armour roll instead of blocking | Later | |
| Stakes | +1 armour against some undead teams | Cut | |
| Stunty | Easy dodging, worse passing, easier to injure | Later, for goblins and halflings: +1 on Dodges, −1 on passes, −1 Toughness | |
| Take Root | On a 1, can't move for the rest of the drive | Later | |
| Throw Team-Mate | Throws a Right Stuff team-mate | Later | |
| Titchy | +1 to dodge; opponents ignore his tackle zone when dodging | Later | |
| Wild Animal | Rolls to act unless blocking or blitzing | Later | |

### Mutations (later)

Each OrcBall mutation gives an **advantage and a disadvantage**. These are starting ideas only.

| Mutation | Blood Bowl | Advantage (idea) | Disadvantage (idea) | Your call |
|---|---|---|---|---|
| Big Hand | Ignores tackle zones and rain on pick-ups | No −1 per tackle zone on pick-ups | −1 on passes | |
| Claw(s) | Armour breaks on 8+ | +1 on the red die after his successful Tackle | −1 on catches and pick-ups | |
| Disturbing Presence | −1 to opponents passing or catching near him | Opponents within 2 hexes get −1 on passes and catches | His own team-mates within 2 hexes get −1 on catches too | |
| Extra Arms | +1 to pick up, catch and intercept | +1 on catches, pick-ups and interceptions | −1 Toughness | |
| Foul Appearance | Opponents roll to block him | An opponent blocking him rolls D10: on a 1–2 the block doesn't happen and the activation ends | Team-mates can't hand off to him | |
| Horns | +1 ST on a Blitz | +1 ST when he blocks on a Blitz | −1 MA | |
| Prehensile Tail | −1 to opponents dodging away | Opponents Dodging out of his tackle zone get −1 | −1 on Dodges himself | |
| Tentacles | May stop opponents leaving his tackle zone | A player leaving his tackle zone must beat his ST in a D10 roll, or stays put and his move ends | Can't Sprint | |
| Two Heads | +1 to dodge | +1 on Dodges | −1 on passes | |
| Very Long Legs | +1 to interceptions, better Leap | +1 on interceptions; may Leap | −1 Toughness | |

## Teams (draft)

Status: open for the designer to fill in. Today the prototype has two teams, Orcs and Elves (`rules-v11.json`), and neither uses skills yet.

The six new teams are cut down from their Blood Bowl rosters to 7 a side. Each keeps 4 or 5 positions, and the position limits add up to 7 or 8 players. Stats are converted as in RULES.md §1: MA and ST stay the same; AG 1/2/3/4 becomes 9+/8+/6+/4+; AV becomes TO. Skills use the Blood Bowl names from [Skills (draft)](#skills-draft), so they follow whatever OrcBall versions you settle on there. "Your call" is for changes: a limit, a stat, a skill, or "cut".

Things to settle before building these:

- **Skills come first.** Most of these teams get their character from skills: Dwarves from Block, Tackle and Thick Skull, Dark Elves from the Witch Elf's Frenzy. Without skills, Humans, Dark Elves and Skaven are close to the current Orcs and Elves with different numbers.
- **Big guys.** The Ogre, Mummy, Rat Ogre and Troll have ST 5. That's +2 against ST 3 on a Tackle (70%), and they can always Shove and Strength Disengage. In Blood Bowl, drawbacks like Bone-head and Really Stupid hold them back; those are "Later" in the skills table. My suggestion: leave the big guys out of the first version of each team, and bring them in with their drawbacks.
- **Very fast players.** A Gutter Runner (MA 9, +2 Sprint) covers 11 of the 18 hexes in one activation. From the halfway line that's a touchdown with no help. Consider MA 8 for OrcBall.
- **Goblins** in Blood Bowl rely on secret weapons and Throw Team-Mate. Without those they are the weakest team by far. They could wait until Throw Team-Mate is in, or get an OrcBall-only boost.
- **Choosing teams.** The start screen will need a team picker for each side; today it's always Orcs at home and Elves away.

### Human

All-rounders: average at everything.

| Position | Max | MA | ST | AG | TO | Skills | Your call |
|---|---|---|---|---|---|---|---|
| Lineman | 3 | 6 | 3 | 6+ | 8 | — | |
| Blitzer | 2 | 7 | 3 | 6+ | 8 | Block | |
| Catcher | 1 | 8 | 2 | 6+ | 7 | Catch, Dodge | |
| Thrower | 1 | 6 | 3 | 6+ | 8 | Sure Hands, Pass | |
| Ogre (later) | 1 | 5 | 5 | 8+ | 9 | Bone-head, Mighty Blow, Thick Skull | |

### Dark Elves

Agile like the Elves (AG 4+ throughout) but tougher (TO 8 on most), with nasty specialists. Expect them to be strong: watch them in playtests.

| Position | Max | MA | ST | AG | TO | Skills | Your call |
|---|---|---|---|---|---|---|---|
| Lineman | 3 | 6 | 3 | 4+ | 8 | — | |
| Blitzer | 2 | 7 | 3 | 4+ | 8 | Block | |
| Runner | 1 | 7 | 3 | 4+ | 7 | Dump-Off | |
| Assassin | 1 | 6 | 3 | 4+ | 7 | Shadowing, Stab (later) | |
| Witch Elf | 1 | 7 | 3 | 4+ | 7 | Frenzy, Dodge, Jump Up | |

### Undead

Slow and clumsy linemen who are hard to keep down, with Ghouls to carry the ball. Regeneration matters less in a single match than in a league; its OrcBall version is in the skills table.

| Position | Max | MA | ST | AG | TO | Skills | Your call |
|---|---|---|---|---|---|---|---|
| Skeleton | 3 | 5 | 3 | 8+ | 7 | Regeneration, Thick Skull | |
| Zombie | 2 | 4 | 3 | 8+ | 8 | Regeneration | |
| Ghoul | 2 | 7 | 3 | 6+ | 7 | Dodge | |
| Wight | 1 | 6 | 3 | 6+ | 8 | Block, Regeneration | |
| Mummy (later) | 1 | 3 | 5 | 9+ | 9 | Mighty Blow, Regeneration | |

### Dwarves

Slow, tough and hard to get past. The Blockers' Tackle skill makes Dodging away from them harder, which matters more in v11, where every step out of a tackle zone is a Dodge.

| Position | Max | MA | ST | AG | TO | Skills | Your call |
|---|---|---|---|---|---|---|---|
| Blocker | 3 | 4 | 3 | 8+ | 9 | Block, Tackle, Thick Skull | |
| Blitzer | 1 | 5 | 3 | 6+ | 9 | Block, Thick Skull | |
| Runner | 1 | 6 | 3 | 6+ | 8 | Sure Hands, Thick Skull | |
| Troll Slayer | 2 | 5 | 3 | 8+ | 8 | Block, Dauntless, Frenzy, Thick Skull | |

The Deathroller (a secret weapon) is left out.

### Skaven

Fast and fragile. They win by running around the opposition, not through it.

| Position | Max | MA | ST | AG | TO | Skills | Your call |
|---|---|---|---|---|---|---|---|
| Lineman | 3 | 7 | 3 | 6+ | 7 | — | |
| Thrower | 1 | 7 | 3 | 6+ | 7 | Sure Hands, Pass | |
| Gutter Runner | 2 | 9 | 2 | 4+ | 7 | Dodge | |
| Stormvermin | 1 | 7 | 3 | 6+ | 8 | Block | |
| Rat Ogre (later) | 1 | 6 | 5 | 6+ | 8 | Frenzy, Loner, Mighty Blow, Prehensile Tail, Wild Animal | |

### Goblins

Small, quick to Dodge and easy to hurt, backed by Trolls. The Looney, Fanatic, Pogoer and Bombardier (secret weapons) are left out.

| Position | Max | MA | ST | AG | TO | Skills | Your call |
|---|---|---|---|---|---|---|---|
| Goblin | 6 | 6 | 2 | 6+ | 7 | Dodge, Right Stuff, Stunty | |
| Troll (later) | 2 | 4 | 5 | 9+ | 9 | Always Hungry, Loner, Mighty Blow, Really Stupid, Regeneration, Throw Team-Mate | |

## Computer opponents (requirements)

Status: to be filled in by the designer. The questions under each heading are prompts; answer them, cut them, or add your own. The random-play bot in `packages/tools` already plays legal matches by picking random commands. It is a test tool, not an opponent.

### Purpose

- What is the computer opponent for: solo practice, teaching the rules, a sparring partner while testing balance, or all of these?
- Should it also play computer against computer, to run many matches and compare rules versions or rosters (for example, whether the Elves have an edge)?

_Your requirements:_

### Strength and style

- How many difficulty levels, and what makes them differ (search depth, deliberate mistakes, how much risk it takes)?
- Should each roster have its own style (Orcs grind and block, Elves run and pass)?
- How should it handle the safe-versus-gamble choices: Shove or Tackle, Dodge or Strength Disengage, Wait or activate?

_Your requirements:_

### Fairness

- It sees the same board you do and never knows future dice. Anything more to rule out?
- Should it get the same odds previews the UI shows you, and nothing else?

_Your requirements:_

### Playing against it

- Which side does it take: picked on the start screen, Orcs or Elves, home or away?
- How fast should it move? Instant, or one action at a time with a short pause so you can follow it?
- Should it show its reasoning ("Tackles: 60%, ball carrier") in the log?
- Can you undo against it, and how far back?

_Your requirements:_

### Scope

- Which parts of a match does it play: coin toss, setup, kick-off, every decision (pushes, follow-ups, catches, re-rolls, interceptions)?
- Does it need both rules versions (v10 and v11), or only the current one?

_Your requirements:_

### Technical limits

- Must it run fully in the browser and offline, like the rest of the prototype?
- Longest acceptable thinking time per action on a laptop or phone?

_Your requirements:_

### Done when

- What would make you call it good enough? For example: it beats the random bot in nearly every match, a new player finds it a fair game, or a full computer-vs-computer match runs in under a minute.

_Your requirements:_

## Bugs and features

## Decisions

Resolved Oct 21, 2026.

- [x] **Devices:** hot-seat on one screen. Two devices waits for online multiplayer (P2).
- [x] **Starter rosters:** Orcs (strong, slow) vs Elves (agile, fragile), 3–4 positions each.
- [x] **Dice:** digital only for the MVP. Physical dice mode stays P1.
- [x] **Undo:** last action only, and not once dice have been rolled. With a seeded RNG, undoing a roll would let a coach see the result and then choose a different action.
- [x] **Ball scatter:** build the Blood Bowl-style scatter as written and test it. The kick-off table and weather stay out of the MVP. Rework scatter if the zero-roll share or the "did the dice decide it?" answers miss their targets.
- [x] **Playtesting:** the designer plus one friend play the first matches. The first rules revision comes after 10 matches, when the success metric targets get their first review.
