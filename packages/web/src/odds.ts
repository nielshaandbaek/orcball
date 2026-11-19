import { type BlockOdds, type Command, type GameState, previewBlock, previewFoul, type RollPreview } from '@orcball/engine'

/**
 * The odds shown before a block or foul is sent (#180): declaring rolls no
 * dice, so the engine's roll preview is empty and the coach would only see
 * them once it's too late to back out. `label` names the button that sends it.
 */
export type Declared = { label: string; lines: string[]; previews: RollPreview[]; choices?: DeclaredChoice[]; button?: string }

/**
 * For a block, Shove and Tackle are offered with the odds, so one prompt
 * declares the block and chooses (#189). The choice is sent once the engine
 * asks for it, after the defender's Brace if he has one.
 */
export type DeclaredChoice = { id: 'shove' | 'tackle'; label: string; disabled?: boolean }

const percent = (odds: BlockOdds) => `${Math.round(odds.tackle.chance * 100)}%`

/** What the Shove button says: 100%, no push, or N/A when he's too weak (#189). */
function shoveText(odds: BlockOdds): string {
  // Before v11 a Shove too weak to push is still offered, and does nothing.
  return odds.canShove && odds.shove === 'N/A' ? 'nothing happens' : odds.shove
}

/** The Strength totals; the odds are on the buttons (#189). */
function blockLine(odds: BlockOdds): string {
  return `Block: ST ${odds.attack} against ${odds.defence}`
}

/** What a Brace would leave him with, as the buttons would read (#189). */
function bracedLine(odds: BlockOdds): string {
  return `With Brace: Shove (${shoveText(odds)}), Tackle (${percent(odds)})`
}

export function declaredOdds(game: GameState, command: Command): Declared | null {
  if (command.type === 'block') {
    const odds = previewBlock(game, command.targetId)
    if (!odds) return null
    const lines = [blockLine(odds)]
    const previews = [odds.tackle]
    if (odds.braced) {
      lines.push(bracedLine(odds.braced))
      previews.push({ ...odds.braced.tackle, test: 'Tackle if he Braces' })
    }
    // Frenzy (#213): the choice made here covers his second block too.
    const attacker = game.activation ? game.players[game.activation.playerId] : null
    if (attacker?.skills.includes('Frenzy')) lines.push('Frenzy: blocks again if he stays up')
    const tackle: DeclaredChoice = { id: 'tackle', label: `Tackle (${percent(odds)})` }
    // Too weak, the Shove is shown greyed out as N/A, so the buttons always read the same way.
    const shove: DeclaredChoice = { id: 'shove', label: `Shove (${shoveText(odds)})`, ...(odds.canShove ? {} : { disabled: true }) }
    const choices: DeclaredChoice[] = [shove, tackle]
    return { label: 'Block', lines, previews, choices }
  }
  if (command.type === 'foul') {
    const odds = previewFoul(game, command.targetId)
    if (!odds) return null
    // Kept short: the chance of breaking the armour on the button, the fouler's risk on the line (the rest in the button's tooltip).
    const pct = (p: number) => `${Math.round(p * 100)}%`
    return { label: 'Foul', lines: [`Foul: Ejected (${pct(odds.ejected)})`], previews: [odds.armour], button: `Foul (${pct(odds.armour.chance)})` }
  }
  return null
}
