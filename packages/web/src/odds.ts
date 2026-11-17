import { type BlockOdds, type Command, type GameState, previewBlock, previewFoul, type RollPreview } from '@orcball/engine'
import { rollSummary } from './components/RollLine'

/**
 * The odds shown before a block or foul is sent (#180): declaring rolls no
 * dice, so the engine's roll preview is empty and the coach would only see
 * them once it's too late to back out. `label` names the button that sends it.
 */
export type Declared = { label: string; lines: string[]; previews: RollPreview[]; choices?: DeclaredChoice[] }

/**
 * For a block, Shove and Tackle are offered with the odds, so one prompt
 * declares the block and chooses (#189). The choice is sent once the engine
 * asks for it, after the defender's Brace if he has one.
 */
export type DeclaredChoice = { id: 'shove' | 'tackle'; label: string }

/** The totals; the Shove and Tackle odds are on the buttons (#189). */
function blockLine(odds: BlockOdds): string {
  return `${odds.attack} against ${odds.defence}${odds.canShove ? '' : ': too weak to Shove'}`
}

/** What a Brace would change: there are no buttons for it, so the Tackle's odds too. */
function bracedLine(odds: BlockOdds): string {
  const tackle = `Tackle ${Math.round(odds.tackle.chance * 100)}%`
  return `If he Braces, ${odds.attack} against ${odds.defence}: ${odds.canShove ? tackle : `too weak to Shove, ${tackle}`}`
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
    const tackle: DeclaredChoice = { id: 'tackle', label: `Tackle (${Math.round(odds.tackle.chance * 100)}%)` }
    // As the engine labels the Shove: it always pushes, unless there's nowhere to push him.
    const shove: DeclaredChoice = { id: 'shove', label: odds.shoveMoves ? 'Shove (100%)' : 'Shove (no push)' }
    const choices: DeclaredChoice[] = odds.canShove ? [shove, tackle] : [tackle]
    return { label: 'Block', lines, previews, choices }
  }
  if (command.type === 'foul') {
    const odds = previewFoul(game, command.targetId)
    if (!odds) return null
    return { label: 'Foul', lines: [rollSummary(odds.armour), `Fouler ejected ${Math.round(odds.ejected * 100)}%`], previews: [odds.armour] }
  }
  return null
}
