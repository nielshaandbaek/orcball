import type { Skill } from '../config'
import type { Modifier } from '../dice'
import type { Player } from '../state'

// Skills (RULES.md §8). The rule modules ask a player's skills here. A skill
// only does anything for players whose roster gives it, so a new skill
// changes nothing in older rules versions.
//
// - Block and Brace (v12): blocking.ts.
// - Dodge (v16): +1 on every Dodge roll, on top of the Dodge bonus.
// - Catch (v16): +1 on every catch roll (passes, hand-offs, loose balls) and
//   on interceptions.
// - Guard (v16): assists on a block, attacking or defending, even when in
//   other enemy tackle zones (zones.ts).
// - Pass (v17): +1 on every pass roll (not hand-offs), so a fumble is less
//   likely too.
// - Leap (v19): once per Move or Blitz, jump to any hex 1 or 2 away, over
//   whatever is in between, for 2 MA: an unmodified Agility roll, no Dodge
//   (movement.ts).
// - Crushing Blow (v22): +1 on the armour or injury die of a player his
//   block knocks down, wherever it helps (injury.ts).

export function hasSkill(player: Player, skill: Skill): boolean {
  return (player.skills as readonly string[]).includes(skill)
}

/** The skill's +1 as a roll modifier named after it, or nothing if the player hasn't got it. */
export function skillModifier(player: Player, skill: 'Dodge' | 'Catch' | 'Pass'): Modifier[] {
  return hasSkill(player, skill) ? [{ name: skill, value: 1 }] : []
}
