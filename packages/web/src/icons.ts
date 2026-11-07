import type { MatchFile, Player, TeamId } from '@orcball/engine'

// Player icons from art/icons/<team>/<colour>/<position>/default.png: each
// side has its own colours (home red, away blue), and each position its own
// folder, named by its position id (black-orc). A position without one falls
// back to the initials token.

type Side = 'home' | 'away'

/** Every icon found, by position: the folder the file is in. */
function folder(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split('/').at(-2)!, url]))
}

const ICONS: Record<string, Record<Side, Record<string, string>>> = {
  Orcs: {
    home: folder(import.meta.glob<string>('../../../art/icons/orcs/red/*/default.png', { eager: true, import: 'default', query: '?url' })),
    away: folder(import.meta.glob<string>('../../../art/icons/orcs/blue/*/default.png', { eager: true, import: 'default', query: '?url' })),
  },
  Elves: {
    home: folder(import.meta.glob<string>('../../../art/icons/elves/red/*/default.png', { eager: true, import: 'default', query: '?url' })),
    away: folder(import.meta.glob<string>('../../../art/icons/elves/blue/*/default.png', { eager: true, import: 'default', query: '?url' })),
  },
}

const TEAM_INDEX: Record<TeamId, 0 | 1> = { home: 0, away: 1 }

export function tokenIcon(file: MatchFile, player: Player): string | null {
  const roster = ICONS[file.rosters[TEAM_INDEX[player.team]].name]
  return roster?.[player.team][player.position] ?? null
}
