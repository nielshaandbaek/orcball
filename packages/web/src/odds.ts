import { type BlockOdds, type Command, type GameState, previewBlock, previewFoul, type RollPreview } from '@orcball/engine'
import { rollSummary } from './components/RollLine'

/**
 * The odds shown before a block or foul is sent (#180): declaring rolls no
 * dice, so the engine's roll preview is empty and the coach would only see
 * them once it's too late to back out. `label` names the button that sends it.
 */
export type Declared = { label: string; lines: string[]; previews: RollPreview[] }

function blockLine(odds: BlockOdds): string {
  const tackle = `Tackle ${Math.round(odds.tackle.chance * 100)}%`
  return `${odds.attack} against ${odds.defence}: ${odds.canShove ? `Shove, or ${tackle}` : `too weak to Shove, ${tackle}`}`
}

export function declaredOdds(game: GameState, command: Command): Declared | null {
  if (command.type === 'block') {
    const odds = previewBlock(game, command.targetId)
    if (!odds) return null
    const lines = [blockLine(odds)]
    const previews = [odds.tackle]
    if (odds.braced) {
      lines.push(`If he Braces, ${blockLine(odds.braced)}`)
      previews.push({ ...odds.braced.tackle, test: 'Tackle if he Braces' })
    }
    return { label: 'Block', lines, previews }
  }
  if (command.type === 'foul') {
    const odds = previewFoul(game, command.targetId)
    if (!odds) return null
    return { label: 'Foul', lines: [rollSummary(odds.armour), `Fouler ejected ${Math.round(odds.ejected * 100)}%`], previews: [odds.armour] }
  }
  return null
}
