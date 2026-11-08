import type { Activation, ActionType, GameEvent, MatchFile, Player, TeamId } from '@orcball/engine'

// Player icons (#114) from art/icons/<team>/<colour>/<position>/<state>.png:
// each side has its own colours (home red, away blue), each position its own
// folder, named by its position id (black-orc), and each state or action its
// own file, default.png being the player standing, not yet activated. A
// missing file falls back down the priority list (iconStates) to default.png;
// a position without even that falls back to the initials token.

type Side = 'home' | 'away'

/** The states and actions a player can have an icon for. */
export const ICON_STATES = ['default', 'activated', 'winded', 'prone', 'stunned', 'move', 'shove', 'tackle', 'pass', 'catch'] as const
export type IconState = (typeof ICON_STATES)[number]

/** Icons shown for about a second when the thing happens, then the player goes back to his usual one. */
export type BriefIcon = 'shove' | 'tackle' | 'catch'
export const BRIEF_MS = 1_000

/** Every icon found, by position (the folder) and state (the file name). */
export type IconFiles = Record<string, Partial<Record<IconState, string>>>

export function byPosition(files: Record<string, string>): IconFiles {
  const icons: IconFiles = {}
  for (const [path, url] of Object.entries(files)) {
    const [position, name] = path.split('/').slice(-2) as [string, string]
    const state = name.replace(/\.png$/, '')
    if (!(ICON_STATES as readonly string[]).includes(state)) continue
    ;(icons[position] ??= {})[state as IconState] = url
  }
  return icons
}

// One level below the position folder only, so the sources in <position>/source/ aren't picked up.
const ICONS: Record<string, Record<Side, IconFiles>> = {
  Orcs: {
    home: byPosition(import.meta.glob<string>('../../../art/icons/orcs/red/*/*.png', { eager: true, import: 'default', query: '?url' })),
    away: byPosition(import.meta.glob<string>('../../../art/icons/orcs/blue/*/*.png', { eager: true, import: 'default', query: '?url' })),
  },
  Elves: {
    home: byPosition(import.meta.glob<string>('../../../art/icons/elves/red/*/*.png', { eager: true, import: 'default', query: '?url' })),
    away: byPosition(import.meta.glob<string>('../../../art/icons/elves/blue/*/*.png', { eager: true, import: 'default', query: '?url' })),
  },
}

/** The icon an action shows while the player's activation runs: Blitz and Foul run, Hand-off reuses Pass; Block has none. */
const ACTION_ICON: Partial<Record<ActionType, IconState>> = { move: 'move', blitz: 'move', foul: 'move', pass: 'pass', handOff: 'pass' }

/**
 * The icons that fit a player now, best first: prone or stunned, then a brief
 * Shove, Tackle or Catch, then the action he's in the middle of, then
 * winded, then activated, and default.png last.
 */
export function iconStates(player: Player, activation: Activation | null, brief?: BriefIcon | undefined): IconState[] {
  const states: IconState[] = []
  if (player.status === 'prone' || player.status === 'stunned') states.push(player.status)
  if (brief) states.push(brief)
  const action = activation?.playerId === player.id ? ACTION_ICON[activation.action] : undefined
  if (action) states.push(action)
  if (player.winded) states.push('winded')
  if (player.activatedThisRound) states.push('activated')
  states.push('default')
  return states
}

/** The first of `states` there's a file for. */
export function pickIcon(files: Partial<Record<IconState, string>> | undefined, states: IconState[]): { href: string; state: IconState } | null {
  for (const state of states) {
    const href = files?.[state]
    if (href) return { href, state }
  }
  return null
}

const TEAM_INDEX: Record<TeamId, 0 | 1> = { home: 0, away: 1 }

/** The player's icon and which state it shows, or null for the initials token. */
export function tokenIcon(
  file: MatchFile,
  player: Player,
  { activation = null, brief }: { activation?: Activation | null; brief?: BriefIcon | undefined } = {},
): { href: string; state: IconState } | null {
  const roster = ICONS[file.rosters[TEAM_INDEX[player.team]].name]
  return pickIcon(roster?.[player.team][player.position], iconStates(player, activation, brief))
}

/** Brief icons the events start: the attacker's Shove or Tackle, and a caught ball. */
export function briefIconsOf(events: readonly GameEvent[]): Record<string, BriefIcon> {
  const brief: Record<string, BriefIcon> = {}
  for (const e of events) {
    if (e.type === 'blockChosen') brief[e.attackerId] = e.choice
    if (e.type === 'ballCaught') brief[e.playerId] = 'catch'
  }
  return brief
}
