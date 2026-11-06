import type { MatchFile, Player, TeamId } from '@orcball/engine'

// Player icons from art/icons, by roster name, side and position id: each
// side has its own colours (home red, away blue). The files are named after
// the position, without the hyphen (blackorc.png for black-orc). A position
// without one falls back to the initials token.

type Side = 'home' | 'away'

/** Every icon in a folder, by file name without the extension. */
function folder(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split('/').at(-1)!.replace(/\.png$/, ''), url]))
}

const ICONS: Record<string, Record<Side, Record<string, string>>> = {
  Orcs: {
    home: folder(import.meta.glob<string>('../../../art/icons/orcs/pixel-v1/256/*.png', { eager: true, import: 'default', query: '?url' })),
    away: folder(import.meta.glob<string>('../../../art/icons/orcs/pixel-v1/blue/256/*.png', { eager: true, import: 'default', query: '?url' })),
  },
  Elves: {
    home: folder(import.meta.glob<string>('../../../art/icons/woodelves/pixel-v1/red/256/*.png', { eager: true, import: 'default', query: '?url' })),
    away: folder(import.meta.glob<string>('../../../art/icons/woodelves/pixel-v1/blue/256/*.png', { eager: true, import: 'default', query: '?url' })),
  },
}

const TEAM_INDEX: Record<TeamId, 0 | 1> = { home: 0, away: 1 }

export function tokenIcon(file: MatchFile, player: Player): string | null {
  const roster = ICONS[file.rosters[TEAM_INDEX[player.team]].name]
  return roster?.[player.team][player.position.replace(/-/g, '')] ?? null
}
