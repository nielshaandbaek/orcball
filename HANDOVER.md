# OrcBall — Handover for Claude

Oct 19, 2026 · @Niels

OrcBall is the user's own board game based on Blood Bowl, redesigned for \~20-minute, chess-like, low-randomness play. Rules are at v9 and the next phase is a software prototype for playtesting. Read this first, then the latest rules file, before changing anything.

## Where things live

The latest rules are in `orcball_rules_v9.md`, which the user keeps; it is not in the Project files, so ask for it if it isn't attached.

| Item | Where | Status |
| --- | --- | --- |
| Rules v9 | `orcball_rules_v9.md` (user's copy; Claude's outputs folder resets between chats) | Current |
| PRD | [OrcBall Prototype — PRD](https://claude.ai/code/artifact/1bbfd6ee-78a3-4052-8afc-6a54f8b0c311) | First draft, one open comment on hot-seat vs two devices |
| Architecture | [OrcBall Prototype — Architecture](https://claude.ai/code/artifact/6f116600-ccfe-4944-9608-e1d887e818ae) | First draft |
| Source rulebook | `/mnt/project/CRP1.pdf` (Blood Bowl Competition Rules, 54 pages) | Reference only |
| Published rules page | [OrcBall Rules v2](https://claude.ai/artifact/Ezf5JLnnBcKd1Kt33rvEtY) | Outdated, ignore |

Each rules change so far became a new numbered file (v0–v9) built from the previous one, with a version line at the top and design notes at the bottom.

## How to work with this user

The user is the designer and decides; Claude proposes, explains the trade-offs, and writes the agreed change into the rules.

- **Tone:** casual, short, direct. Asked for this at the start.
- **Rhythm:** one rules area at a time. Propose one recommended option (plus an alternative if useful), wait for a yes, then write the next version.
- **Small tweaks:** when the user states a change clearly (e.g. "no players required on the Line of Scrimmage"), just make it and note side effects.
- **Flag consequences:** the user liked it when side effects were spelled out with odds (e.g. TZ penalty halving made marked dodges easier). Keep doing that.
- **Parked ideas:** when the user says "keep it in mind", record it under Parked ideas in the rules file's design notes.
- **Files:** rules stay as versioned Markdown files; the PRD and architecture are Claude Docs.

## Rules v9 in brief

The core idea: positioning is reliable and dice only come in under pressure or when a coach chooses to gamble.

- **Board:** 18 × 9 pointy-top hexes, rows run end zone to end zone. End zones = first and last hex of each row. Wide zones = 2 outer rows each side, max 1 player each. No Line of Scrimmage minimum.
- **Teams:** 7 on the pitch. Stats MA, ST, AG (target, e.g. 6+), TO (Toughness, attacker needs ≥ TO).
- **Time:** 2 halves × 4 rounds. Alternating activations, each player once per round. A coach may Wait; two Waits in a row end the round. Receiver starts each drive, then first go alternates.
- **Dice:** every test is D10 + modifiers ≥ target. Natural 1 fails, natural 10 succeeds. Each modifier source is ±1 and they stack. Direction and distance dice stay D6.
- **Movement:** entering an enemy TZ stops you; leaving costs +1 MA (Disengage). Dodge = roll AG (−1 per extra TZ) to slip through. Sprint = +2 MA, no roll, but Winded (no TZ, no assists) until next activation. Standing up costs half MA.
- **Blocking:** ST + assists each side. Shove = no roll, push if ≥ (crowd push needs +2). Tackle = 6+, ±1 per point of difference; success knocks down, fail does nothing and ends the activation, natural 1 knocks the attacker down.
- **Injury:** red armour D10 + white injury D10 thrown together. White: 1–7 Stunned, 8–9 Out for the drive, 10 Casualty.
- **Ball:** unmarked pick-ups and accurate catches are automatic; marked ones roll AG −1 per TZ. Pass bands Quick 0 / Short −1 / Long −2 / Bomb −3. Interception −3.
- **Failure:** a failed roll, fumble or interception gives the opponent a double activation.
- **Momentum:** 2 tokens per half, max one per round, for a re-roll or a double activation.

## Decision log

Nine versions in one session; every change came from the user's direction or a proposal they accepted.

| Version | Change | Why |
| --- | --- | --- |
| v9 | No minimum players on the Line of Scrimmage | User's call |
| v8 | Zone of control, Dodge as gamble, Sprint, free unmarked pick-ups and catches, double activation on failure, Momentum tokens | "Roll only under pressure": fewer dice, failure still hurts |
| v7 | Two-colour armour + injury dice; Stunned / Out / Casualty | One throw per knockdown, fewer casualties for 7-a-side |
| v6 | Shove (guaranteed push) or Tackle (D10 knockdown) | Position reliable, damage the gamble; no block dice |
| v5 | Wait; two Waits end the round | Tempo and bluffing |
| v4 | All modifiers ±1 | Stackable, riskier easy actions |
| v3 | D10 tests, AV → TO, AG as target | Finer odds |
| v2 | Rounds, alternating activations, 4 per half, failure ends the activation only | Faster, no turnovers |
| v1 | Hex grid, 18 × 9, 7 players | Smaller, more readable board |
| v0 | Condensed Blood Bowl core rules | Baseline |

**Rejected or not taken:** 5-a-side on 15 × 9; fully dice-free blocking; margin-based single-die injury (too many casualties); strict > for Toughness (user chose ≥ for consistency).

## Watch items and open questions

The biggest risk is that defence is now too strong; most other open items wait on playtest data.

- **Defence too strong:** zone of control plus no Line of Scrimmage minimum could make deep defences unbreakable. Watch the 0–0 rate.
- **Stalling:** the team with the ball may Wait to run out the half. Only the round limit stops it so far.
- **Time budget:** 8 rounds × 14 activations needs about 10 s per activation. Fallback: 3 rounds per half.
- **Strength scaling:** +1 ST is only +10% on a Tackle. If strong teams feel weak, count ST double for Tackles.
- **Initiative:** first go alternates each round; giving it to the team without the ball is an alternative.
- **Not yet reworked:** ball scatter (kick-off, missed passes, bounces, throw-ins) and the Kick-Off table are still Blood Bowl-style.
- **Not yet designed:** rosters, positions and the skill list (only Block, Dodge, Mighty Blow sketched).
- **Prototype questions:** open lists sit at the end of the PRD and architecture docs (hot-seat vs two devices, rosters, undo depth, who builds it).

## Next steps

The user is happy with the rules and has moved on to the prototype; start there unless they say otherwise.

- [ ] Ask the user to attach `orcball_rules_v9.md` (or add it to the Project files) before any rules or code work.
- [ ] Get the user's review of the PRD and architecture docs, including the hot-seat comment.
- [ ] Settle the open prototype questions, especially the two starter rosters.
- [ ] Start phase 1: the headless rules engine with tests (see the architecture doc).
- [ ] Later: rework ball scatter and the Kick-Off table, and design the skill list.
