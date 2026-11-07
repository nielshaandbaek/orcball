# OrcBall — Rules (v12)

Based on the Blood Bowl Competition Rules core game, being cut down and reworked. **v1:** hex grid, smaller pitch, 7 players a side. **v2:** rounds with alternating activations, 4 rounds per half, failures end the activation instead of the turn. **v3:** all tests on a D10; AV becomes Toughness, AG becomes a target number. **v4:** every modifier source is worth ±1, so they stack in clean 10% steps and base odds are tougher. **v5:** coaches can Wait; two Waits in a row end the round. **v6:** block dice replaced by Shove (guaranteed push) or Tackle (D10 knockdown). **v7:** armour and injury rolled together on two coloured dice; injury table cut to Stunned / Out / Casualty. **v8:** roll only under pressure: zone of control, Sprint, free unmarked pick-ups and catches, double activation on failure, Momentum tokens. **v9:** no minimum on the Line of Scrimmage. **v10:** rows alternate 18 and 17 hexes so both ends of the pitch match; the 4 hexes on the halfway line are out of bounds for setup and kick-offs; a pass line that runs along a hex edge crosses the hexes on both sides; a coin toss decides who kicks off first; the details the prototype needed (push order, interception before the throw, unused double activations lapsing at the end of the round, and others) are written into their sections. **v11 (on trial; v10 can still be picked in the prototype):** tackle zones no longer stop a player; every step out of one is a Dodge instead; a marked player as strong as each marker may Strength Disengage 1 hex with no roll; a Shove needs at least equal strength; a missed Tackle is no longer a failure, only the attacker being knocked down on a natural 1 is; a kick-off scatters the lower of 2D6 hexes, for fewer touchbacks; the attacker follows up before the ball comes loose; a player a loose ball lands on may let it bounce instead of catching. **v12 (v11 and v10 can still be picked):** on a missed Tackle the defending coach chooses both down or nothing happens; the first skills: Block (+1 on an unassisted Tackle) and Brace (+1 to a defender's total, for his activation); every Dodge gets +1; only a standing player can take a Block action. **v13 (v12, v11 and v10 can still be picked):** the Block skill counts on every Tackle, assisted or not. **v14 (v13 and earlier can still be picked):** the Elves field one Wardancer and three Linemen, instead of two of each. **v15 (on trial; v14 and earlier can still be picked):** Sprint gives +1 MA instead of +2; every Elf position has 1 MA less; a natural 10 on a pass always succeeds, never a fumble. League play, inducements, special play cards, star players, team rosters and the full skill list are left out on purpose.

---

## 1. The Basics

- **Pitch:** hex grid, **9 rows wide**. Rows 1, 3, 5, 7 and 9 are **18 hexes** long; rows 2, 4, 6 and 8 are **17 hexes** long and sit half a hex in from each end. That makes both ends of the pitch the same shape. Rows run end zone to end zone, so a player can run in a straight line toward the end zone.
  - **End Zones:** the first and last hex of every row.
  - **Halfway line:** between hexes 9 and 10 of the 18-hex rows. In the 17-hex rows it runs through hex 9.
  - **Halfway hexes:** hex 9 of rows 2, 4, 6 and 8. They belong to neither half. No player may be set up on one, and a kick-off that lands on one is a touchback. In play they are normal hexes.
  - **Wide zones:** the 2 outer rows on each side.
- **Adjacency:** every hex has **6 neighbours**. There are no diagonals; all directions are equal.
- **Goal:** Carry the ball into the opponent's End Zone = 1 touchdown (TD). Most TDs at the end wins.
- **Length:** 2 halves × **4 rounds**. In a round, every player on both teams activates once.
- **Players:** Up to **7** on the pitch. Each has four stats:
  - **MA** – Movement Allowance (hexes per Action)
  - **ST** – Strength (blocking)
  - **AG** – Agility, written as a target number (e.g. **6+**). Used for dodge, pick up, pass, catch. Lower is better.
  - **TO** – Toughness, the number an opponent must roll to break through (e.g. **8**). Higher is better.

### Dice

- **Every test is a D10:** roll, add modifiers, succeed if the total is **≥ the target**.
- **Natural 1 always fails, natural 10 always succeeds,** whatever the modifiers. So every test sits between 10% and 90%.
- Each point of modifier is worth exactly **10%**.
- **Still on a D6:** scatter, bounce and throw-in direction (one face per hex side), plus kick-off distance (D6), throw-in distance (2D6) and the Kick-Off table (2D6). Block dice are gone (see Blocking).

### Converting Blood Bowl stats

| Blood Bowl | OrcBall | Odds (BB → OrcBall) |
|---|---|---|
| AG 1 / 2 / 3 / 4 / 5 | AG 9+ / 8+ / 6+ / 4+ / 3+ | 17/33/50/67/83% → 20/30/50/70/80% |
| AV 7 / 8 / 9 / 10 | TO 7 / 8 / 9 / 10 | 42/28/17/8% → 40/30/20/10% |

**Modifiers:** each source (a tackle zone, an accurate pass, a range band, an assist) is worth **±1**. They stack. Range bands and interception just count several steps.

## 2. Setup & Kick-Off

Before the match, toss a coin. The winner chooses to kick off or receive in the first half; the other team kicks off the second half.

- **Ends:** the home team defends the left half and scores in the right end zone; the away team the other way round. Teams don't swap ends at half time.

1. Kicking team sets up first, then receiving team. Each sets up in its own half, never on a halfway hex.
2. Max 1 player per wide zone. No players are required on the Line of Scrimmage. A team sets up 1 to 7 players.
3. Kicker places the ball anywhere in the receiver's half; it scatters **D6 direction** (one per hex face) × **the lower of 2D6** hexes (v11; in v10 it was 1D6).
4. Ball lands on a player → catch roll. Empty hex → bounces once.
5. Ball lands off the pitch or on a halfway hex → **touchback**: receiver gives it to any of their players. A ball that lands in the kicker's half isn't a touchback yet: it lands and bounces as usual, and is a touchback if it goes out of bounds or comes to rest in the kicker's half or on a halfway hex.
6. (Extra rules) Roll 2D6 on the **Kick-Off table** for a random event (blitz, weather change, extra Momentum, pitch invasion, etc.).

## 3. Rounds & Activations

- The game is played in **rounds**. In a round, coaches **alternate activations**: one of my players, one of yours, and so on.
- **Who goes first:** the receiving team starts round 1 of each drive. After that, first activation alternates each round.
- Each player activates **once per round**.
- **Wait:** on your go, instead of activating a player you may Wait. It doesn't use up a player, and you can Wait again on later goes.
- **The round ends when:**
  - both coaches Wait back to back, or
  - every player on the pitch has activated.
  Players who haven't activated simply don't act this round.
- A coach with no unactivated players left counts as Waiting on every go. So the other coach keeps activating until they choose to Wait, which ends the round.
- **Action types:**
  - **Move** – up to MA hexes.
  - **Block** – hit one adjacent standing opponent. No moving. Only a standing player can Block (v12); a player who is down can Blitz instead, standing up first.
  - **Blitz** – move + one block (block costs 1 hex). After a successful Shove or Tackle, or a missed Tackle that isn't a natural 1 (v11), he may keep moving with his remaining MA, whether or not he follows up (stepping out of a TZ is a Dodge as usual). A Shove that moves nobody, whether too weak or with nowhere to push, ends the Blitz. **Once per round per team.**
  - **Pass** – move, then throw. **Once per round per team.**
  - **Hand-off** – move, then hand the ball to an adjacent teammate. **Once per round per team.**
  - **Foul** – move, then kick a prone/stunned opponent. **Once per round per team.**
- Blitz and Pass must be different players. (This follows from each player activating once per round.)
- A player who catches a pass or hand-off and hasn't activated yet can still activate later in the round as normal.

### Activation ends immediately if the active player:

1. Is Knocked Down (fails a Dodge or rolls a natural 1 on a Tackle).
2. Misses a Tackle (v10 only; in v11 a miss isn't a failure, and a Blitzer may keep moving).
3. Throws or hands off a ball that isn't caught by his team before it stops.
4. Fails a pick-up.
5. Fumbles a pass or has it intercepted.
6. Scores a touchdown.
7. Is ejected for fouling.

The rest of your team can still activate this round.

### Double activation

If your activation ends because of a **failed roll, a fumble or an interception**, the opponent gets a **double activation** on their next go: they activate up to two players, one after the other.

- **Waiting** at the start of the go forfeits the double and counts as a Wait. Waiting after the first of the two ends the go but doesn't count as a Wait, since the team did activate someone.
- **A failure during your own double** ends the go, forfeiting the second activation, and the opponent gets a double.
- **When the round ends**, an unused double is lost. It doesn't carry over to the next round.
- **Not failures:** an ejection for fouling, a player letting a loose ball bounce instead of catching it (a Blitz carries on), an accurate pass to an empty hex, and a missed Tackle that isn't a natural 1 (v11; in v10 it was a failure). They end the activation without giving the opponent a double.

### Touchdowns

A touchdown ends the drive and the round immediately. Then both teams set up and the scoring team kicks off. The next round is a new round of the same half (the count keeps going).

## 4. Movement

- Move 1 hex per point of MA, in any of the 6 directions. Can't enter occupied hexes.
- **Tackle zones:** a standing player exerts a TZ on all 6 adjacent hexes. Prone/stunned players have none. A player in an enemy TZ is **marked**.
- **Entering** an enemy TZ is free: no roll, and the player may keep moving.
- **Dodge (the gamble):** every step out of a hex in an enemy TZ is a Dodge. Roll AG **+1** (v12; so AG 6+ dodges on 5+), **−1 per enemy TZ on the hex he steps into**.
  - Success: he keeps moving.
  - Fail: Knocked Down in the hex he stepped into, activation ends.
- **Strength Disengage (the safe way out):** a marked player who hasn't moved yet this activation may instead step **1 hex** to a hex in no enemy TZ, with no roll. His ST + assists must be **at least** the ST + assists of **each** player marking him (assists as for blocks). That step is his whole move; the rest of his action (pass, hand-off, foul) still follows.
- **v10, for comparison:** entering an enemy TZ ended the move unless the player Dodged into it (−1 per enemy TZ beyond the first), and leaving a TZ cost +1 MA with no roll.
- **Sprint:** a player may move up to **+1 MA** (v14 and earlier: +2), no roll. He becomes **Winded** (place a marker): until his next activation he has **no tackle zone and can't assist**. A blitzer can Sprint to reach the block.
- **Standing up:** costs half his MA (rounded up). No roll.

## 5. Blocking

- **Strength totals:** each side adds ST + assists, and +1 for a defender who Braces (v12).
- **Brace (skill, v12):** when a player with Brace is blocked and hasn't activated yet this round, his coach may Brace before the attacker chooses Shove or Tackle: +1 to his total, and he then counts as activated this round.
- **Assists:** each teammate adjacent to the enemy in the block, standing, and *not* in any other enemy TZ adds +1. Attacker declares assists first, then defender. Assisting is free and unlimited.
- The attacker then chooses **Shove** or **Tackle**:

### Shove (no roll)

- Only allowed when the attacker's total is **≥** the defender's (in v10 a weaker Shove could be chosen and did nothing).
- Defender is pushed 1 hex. Attacker may follow up.
- **Into the crowd:** a Shove can only push a player off the pitch if the attacker's total is **at least 2 higher**.

### Tackle (D10)

- Roll **6+**, **+1 per point** the attacker's total beats the defender's, **−1 per point** it falls short.
- **Success:** defender is pushed 1 hex and Knocked Down (armour & injury roll). Attacker may follow up.
- **Miss:** the defending coach chooses (v12):
  - **Both down:** both players are Knocked Down where they stand (armour & injury rolls; whoever has the ball drops it). It's a failure for the attacker: his activation ends and the opponent gets a double activation.
  - **Nothing happens:** the defender stays put. It isn't a failure, so the opponent gets no double activation; a Blitzer may keep moving with his remaining MA, and a Block action is over.
  - In v11 a miss was always "nothing happens"; in v10 it was a failure that ended the activation.
- **Natural 1:** the attacker is Knocked Down instead. Block doesn't prevent this (v12).
- **Block (skill, v12):** +1 to its side's Tackle roll (for the attacker) or −1 (for a defender with Block), but only when that side has no assists. It does nothing for a Shove.
  - **v13:** Block counts whatever the assists, so it stacks with them.

| Strength difference | −2 | −1 | 0 | +1 | +2 | +3 |
|---|---|---|---|---|---|---|
| Tackle succeeds | 30% | 40% | 50% | 60% | 70% | 80% |

### Blocking skills (examples, not yet in the game)

- **Dodge:** −1 to Tackles against him.
- **Mighty Blow:** +1 to the red or white die (attacker's choice) after a successful Tackle.

- **Push-back:** of the defender's 6 neighbours, the 3 not touching the attacker are the push hexes; attacker picks one. Order of choice: an empty push hex if there is one; otherwise off the pitch into the crowd (white die only, see Injuries) if a push hex is off the pitch; otherwise chain-push a player in a push hex.
- **Shove without the crowd margin:** if the only way to push is into the crowd and the Shove isn't 2 higher, and there's nobody to chain-push, nobody moves.
- **Loose ball:** a player pushed onto the ball makes it bounce.
- **Follow up:** attacker may step into the vacated hex for free, ignoring TZs. He decides straight after the push, before the knock-down, the armour roll and any loose ball are dealt with (v11; in v10 the follow-up came last).

## 6. Knock Downs & Injuries

- Knocked Down = placed prone. Drops the ball (bounces).
- **Armour & injury roll:** the opponent rolls two D10s together: a **red armour die** and a **white injury die**.
  - Red **≥ TO** → armour broken, read the white die. Otherwise the white die is ignored and the player is just prone.
  - Natural 1 / 10 on the red die always fails / breaks.
- **Injury (white die):**
  - 1–7 **Stunned** – face down. His next activation is spent turning face up (prone). He can stand up on the one after that. If a round ends before he activates, he stays face down.
  - 8–9 **Out** – off the pitch for the rest of the drive. Comes back automatically at the next kick-off.
  - 10 **Casualty** – out for the match.
- Modifiers from skills say which die they apply to. A natural 1 on the white die is always Stunned, a natural 10 always a Casualty.
- **Pushed into the crowd:** roll only the white die (armour counts as broken). A Stunned result sends him to the reserves; he comes back at the next kick-off.
- **Stunned player's activation:** it can only be a Move (to turn face up), so it never uses the team's Blitz or Foul.

| Toughness | Just prone | Stunned | Out | Casualty |
|---|---|---|---|---|
| TO 7 | 60% | 28% | 8% | 4% |
| TO 8 | 70% | 21% | 6% | 3% |
| TO 9 | 80% | 14% | 4% | 2% |

- No substitutions mid-drive; reserves come on only after a TD or at half time.

## 7. Ball Handling

- **Pick up:** happens as the player enters the ball's hex and costs **1 extra MA**. It still works if entering that hex ends his move. A player without the MA for the extra hex can't enter the ball's hex.
  - **Unmarked:** automatic.
  - **Marked:** roll AG, **−1 per enemy TZ**. Fail = bounce, activation ends.
- **Pass:** range is counted in hexes from thrower to target (no ruler needed):
  - Quick (1–3) **0**, Short (4–6) **−1**, Long (7–9) **−2**, Long Bomb (10–12) **−3**; **−1 per enemy TZ on thrower**.
  - Success = lands on target. Fail = scatters 3 times.
  - Natural 1 (or modified ≤1) = **fumble** (10% base, was 17%): ball bounces from thrower, activation ends. A natural 10 always succeeds and is never a fumble (v15; before, a natural 10 modified to 1 or less was a fumble).
- **Interception:** comes **before the throw roll**. One opponent standing in a hex crossed by a straight line between thrower and target centres may try; with several, the defending coach picks one. Where the line runs exactly along the edge between two hexes, both count as crossed. Agility roll at **−3**, −1 per enemy TZ. Success = he has the ball, the pass is never thrown, thrower's activation ends. Failure = the throw goes ahead.
- **Catch:**
  - **Accurate pass or hand-off to an unmarked player:** automatic.
  - **Marked receiver:** roll AG, **−1 per enemy TZ**.
  - **Scatter, bounce, kick or throw-in:** the coach of the player it lands on chooses: try to catch (roll AG, **−1 per enemy TZ**), or let it bounce on from there. Letting it bounce is never a failure (v11; in v10 the player always tried).
  - Fail = bounce. A dropped catch is a failure only for the active team: it ends the activation and the opponent gets a double activation. An opponent who drops it just lets it bounce.
- **Hand-off:** no throw roll; catch as above.
- **Bounce:** ball moves 1 hex in a random D6 direction. Lands on a standing player → catch or let it bounce, as above; lands on a prone or stunned player → bounces on; repeats until caught or settles.
- **Scatter and throw-in:** a ball that ends on an empty hex bounces once, as on a kick-off.
- **Throw-in:** ball off the pitch → from the last hex it was in, roll D6 for direction (re-roll any direction pointing off the pitch), then it travels 2D6 hexes.

## 8. Fouls

- Move adjacent to a prone/stunned opponent and kick: red armour die **+1 per assist** (same assist rules as blocks, defensive assists subtract).
- With no doubles on a D10: a **natural 1 or 10** on the red die → fouler ejected (20%). A natural 10 still breaks armour first.

## 9. Momentum & Re-rolls

- **Momentum tokens:** each team gets **2 per half** (unused ones don't carry over). Max one per round. Spend one to either:
  - **re-roll** one of your player's rolls (not armour/injury/scatter), or
  - take a **double activation** on your go.
- **Player re-rolls:** none. Skills give +1 on a roll or a new ability instead (see §10).
- Hard limit: no dice roll can be re-rolled more than once.

## 10. Skills (overview only)

Grouped in General, Agility, Strength, Passing, Physical and Extraordinary categories. OrcBall skills never give re-rolls: each gives +1 on one kind of roll or a new ability. The draft list is in `PRD.md` ("Skills (draft)").

In the game so far (v12):

| Skill | Effect | Who has it |
|---|---|---|
| Block | +1 on his side's Tackle roll when his side has no assists. Not for a Shove; no protection against a natural 1. | Orc Blitzers, Elf Wardancers |
| Brace | When blocked before he has activated this round: +1 to his total, then he counts as activated. | Orc Linemen, Elf Linemen |

## 11. Ending the Match

- After round 4, half time. Teams reset, Out players return, other team kicks off.
- After a TD, both teams set up again, the scoring team kicks.
- Most TDs after the second half wins. Draws can go to overtime in tournaments.

---

## Design Notes — Where the Randomness and Time Go

Our tuning work will focus on these.

**Biggest sources of randomness**

1. ~~**Turnovers:** One failed roll ends your whole turn.~~ Fixed in v2: a failure only ends that player's activation.
2. ~~**Block dice:** 5 faces, 1–3 dice.~~ Fixed in v6: pushes are guaranteed, only knockdowns are rolled.
3. **Ball scatter:** kick-off (D6 × D6), missed passes (3 scatters), bounces, throw-ins (2D6).
4. ~~**Armour + injury:** two separate rolls per knockdown.~~ Fixed in v7: one throw of two coloured D10s.
5. **Kick-off table & weather:** pure luck events.
6. ~~**Agility checks everywhere.**~~ Fixed in v8: unmarked moves, pick-ups and catches need no roll. Dice remain for Dodge, marked actions, passes, interceptions and Tackles.

**Biggest time sinks**

1. ~~32 total turns, each with up to 11 player activations.~~ Now 8 rounds × up to 14 activations.
2. ~~Long sequences of dice per player.~~ Fixed in v8: most activations now have zero rolls.
3. Momentum decisions and skill lookups.
4. Bookkeeping: reserves. KO return rolls are gone in v7, and stunned flips are part of the player's activation.
5. ~~The full 26 × 15 pitch with 22 models.~~ Fixed in v1: 18 × 9 hexes, 14 models.

**What the hex switch changes**

- **Cages get cheaper.** 3 guards on alternating hexes around the carrier mean every open neighbour is in 2 friendly TZs. A full ring takes 6. So 7 players can cage *and* defend.
- **No diagonal shortcut.** Every direction costs the same, so MA and pass range read straight off the board.
- **D6 fits naturally:** scatter, bounce and throw-in all use a plain D6, so the D8 is gone.
- **Fewer TZs per player (6 vs 8).** Screens are leakier, which favours agile teams a bit. (v8's zone of control makes screens much harder to get through.)
- **Pitch math:** an MA 6 runner covers a full 18-hex row in 3 activations, so 8 turns per half was too many. Now 4 rounds per half.

**What alternating activations change**

- **Risk got cheaper.** Without turnovers, a failed dodge costs one player, not your whole turn. (Addressed in v8: fewer rolls, and failures give the opponent a double activation.)
- **Order is now the main tactic.** Who you activate *when* matters as much as what they do. Saving a blitzer to react late in the round is strong.
- **Pass-then-run is harder.** The opponent gets a move between the catch and the catcher's activation, so they can block or mark him first.
- **Waiting adds tempo.** You can hold back a key player to see what the opponent commits, but if both coaches stall, the round closes and unused activations are lost. Rounds may also run shorter, which helps the time budget.
- **Initiative matters.** First activation each round is valuable. Alternating it is the simple fix; giving it to the team without the ball is an option if defence feels too weak.
- **Time check:** 8 rounds × 14 activations = 112 activations, about 10 seconds each for 20 minutes. Tight. If playtests run long, drop to 3 rounds per half.

**What the D10 changes**

- **Finer tuning.** Every modifier step is 10%, so skills, positions and tactics can nudge odds without big swings.
- **Nothing is certain.** The 1/10 rule caps every test at 10–90%. (v8 removes the roll from unpressured actions, so those are now certain.)
- **Flatter armour.** A single D10 has no bell curve, so each Toughness point is a steady 10%. 2D6 made the middle values swingy and the extremes rare.
- **Fumbles drop** from 17% to 10% of all passes, which already cuts randomness a bit.

**What ±1 modifiers change** (AG 6+ player)

| Roll | v3 | v4 |
|---|---|---|
| Clean dodge / pick-up | 70% | 60% |
| Dodge into 1 TZ | 50% | 50% |
| Dodge into 2 TZs | 30% | 40% |
| Accurate catch | 70% | 60% |
| Quick / Short / Long / Bomb pass | 70 / 50 / 30 / 10% | 50 / 40 / 30 / 20% |
| Interception | 10% | 20% |

- **Easy actions got riskier,** which was the goal.
- **Marking matters less.** One TZ now costs 10%, not 20%, so a heavily marked player is better off than before. (Addressed in v8: tackle zones are now hard effects through zone of control.)
- **Passing flattened out.** The gap between a quick pass and a bomb shrank from 60% to 30%. Long throws are now more attractive.

**What Shove/Tackle changes**

- **Position is reliable, damage is the gamble.** You can plan pushes like chess moves, and only roll when you go for the knockdown.
- **Every block is a choice:** take the guaranteed hex, or gamble for the knockdown and risk leaving the defender where he is.
- **Assists matter more.** One assist can turn a Shove from impossible to automatic.
- **Strength scales gently** (+10% per point vs BB's big jump to 2 dice). If strong teams feel weak, ST could count double for Tackles.
- **Crowd pushes** need +2 for a Shove so a sideline isn't a free injury. A successful Tackle can still push into the crowd as normal.

**What the v7 injury roll changes**

- **One throw per knockdown** instead of two, and no KO return rolls at kick-offs.
- **Fewer casualties:** 10% of broken armour (was 20%). With only 7 players a side, losing someone for the match should be rare and dramatic.
- **Stunned vs Out:** Stunned costs a player a round or two; Out costs him the drive. Both are clear, no rolling to come back.

**What v8 changes: roll only under pressure**

- **Most activations have zero rolls.** Moving, picking up and catching in the open are automatic. Dice come in for Tackles, passes, Dodges and anything done while marked.
- **Tackle zones are hard effects.** Entering one stops you, leaving one costs MA. Marking is now the main defensive tool.
- **Safe vs gamble everywhere:** Shove or Tackle, stop or Dodge, walk or Sprint. The safe version costs tempo, the gamble costs dice.
- **Failure hurts again:** a failed roll hands the opponent a double activation.
- **Momentum is a resource,** not insurance: fix a roll, or set up a two-player combo.
- **Setup is free (v9).** With no Line of Scrimmage minimum, the kicking team can sit back in a deep zone defence, or press high to smother the receiver. Combined with zone of control, a deep defence could be very hard to crack, so watch this alongside the point below.
- **Symmetric pitch (v10).** With 18 hexes in every row, the shifted rows stuck out at one end only, so the two end zones had different shapes (corner hexes with 2 neighbours at one end, 3 at the other). Alternating 18 and 17 hexes fixes that, at the cost of 4 halfway hexes the rules have to place. The pitch now has 158 hexes.
- **Risk to watch:** defence may now be too strong. If walls are hard to break, scoring could stall. First thing to playtest.

**Parked ideas**

- (none right now)

**Levers that look promising for a 20-minute "chess-like" game**

- Fixed ball deviation instead of random scatter.
- Remove the kick-off table and weather, or make them chosen rather than rolled.
- Add tactical options instead of dice: a limited pool of action/tactic cards, positional bonuses, zone control, etc.
