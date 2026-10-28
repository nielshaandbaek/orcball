import type { MatchFile, Player, TeamId } from '@orcball/engine'
import elfCatcher from '../../../art/icons/woodelves/wecatcher1.gif'
import elfLineman from '../../../art/icons/woodelves/welineman1.gif'
import elfThrower from '../../../art/icons/woodelves/wethrower1.gif'
import elfWardancer from '../../../art/icons/woodelves/weblitzer1.gif'
import orcBlackOrc from '../../../art/icons/orcs/oblackorc2.gif'
import orcBlitzer from '../../../art/icons/orcs/oblitzer1.gif'
import orcLineman from '../../../art/icons/orcs/olineman2.gif'
import orcThrower from '../../../art/icons/orcs/othrower1.gif'

// Player icons from art/icons, by roster name and position id. A position
// without one falls back to the initials token.

const ICONS: Record<string, Record<string, string>> = {
  Orcs: { 'black-orc': orcBlackOrc, blitzer: orcBlitzer, thrower: orcThrower, lineman: orcLineman },
  Elves: { wardancer: elfWardancer, catcher: elfCatcher, thrower: elfThrower, lineman: elfLineman },
}

const TEAM_INDEX: Record<TeamId, 0 | 1> = { home: 0, away: 1 }

export function tokenIcon(file: MatchFile, player: Player): string | null {
  return ICONS[file.rosters[TEAM_INDEX[player.team]].name]?.[player.position] ?? null
}
