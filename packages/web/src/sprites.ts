import { currentPositionId, type GameEvent, type MatchFile, type Player, type TeamId } from '@orcball/engine'
import { hexCenter } from './geometry'

// Animated player sprites (#208) from art/sprites/<team>/<red|blue>/<position>.png.
//
// A sheet has four frames to a row and one row per animation, in ANIMS order.
// Frames are square: a sheet's frame size is its width ÷ 4 (96 px, or more for
// a big player). The home team wears red and the away team blue. A team
// without red sheets yet plays in blue at home too. A position with no sheet
// falls back to the initials token.
//
// A player's animation is his standing one (idle, winded, or lying after a
// fall) unless a cue from the last command plays over it: running while he
// moves, blocking, stumbling when pushed, falling when knocked down, and
// victory on a touchdown.

/** The animations, in the order of a sheet's rows. */
export const ANIMS = ['idle', 'running', 'blocking', 'falling', 'victory', 'winded', 'stumbling'] as const
export type Anim = (typeof ANIMS)[number]

export const FRAMES = 4
/** The animation speed, in frames per second. */
export const SPRITE_FPS = 6
export const FRAME_MS = 1000 / SPRITE_FPS
/** An animation played once: its four frames. */
export const ONCE_MS = FRAMES * FRAME_MS
/** Running lasts this long after a step, so a walk (a step every 200 ms) runs throughout and stops soon after. */
export const RUNNING_MS = 450

/** The sheets found, by team folder (orcs), colour and position id. */
export type SheetFiles = Record<string, Partial<Record<'red' | 'blue', Record<string, string>>>>

export function bySheet(files: Record<string, string>): SheetFiles {
  const sheets: SheetFiles = {}
  for (const [path, url] of Object.entries(files)) {
    const [team, colour, name] = path.split('/').slice(-3) as [string, string, string]
    if (colour !== 'red' && colour !== 'blue') continue
    ;((sheets[team] ??= {})[colour] ??= {})[name.replace(/\.png$/, '')] = url
  }
  return sheets
}

const SHEETS = bySheet(import.meta.glob<string>('../../../art/sprites/*/*/*.png', { eager: true, import: 'default', query: '?url' }))

const TEAM_INDEX: Record<TeamId, 0 | 1> = { home: 0, away: 1 }

/** The player's sheet: his team's colour (home red, away blue), else blue; null if his position has none. */
export function sheetFor(file: { rosters: readonly Pick<MatchFile['rosters'][number], 'name'>[] }, player: Player, sheets: SheetFiles = SHEETS): string | null {
  const team = sheets[file.rosters[TEAM_INDEX[player.team]]!.name.toLowerCase()]
  const position = currentPositionId(player.position)
  return team?.[player.team === 'home' ? 'red' : 'blue']?.[position] ?? team?.blue?.[position] ?? null
}

/** A sheet's size in pixels, once loaded; until then the usual 4 × 7 frames of 96 px. */
const sizes = new Map<string, { width: number; height: number }>()
const DEFAULT_SIZE = { width: 96 * FRAMES, height: 96 * ANIMS.length }

export function sheetSize(href: string): { width: number; height: number } {
  if (!sizes.has(href) && typeof Image !== 'undefined') {
    sizes.set(href, DEFAULT_SIZE)
    const image = new Image()
    image.onload = () => sizes.set(href, { width: image.naturalWidth, height: image.naturalHeight })
    image.src = href
  }
  return sizes.get(href) ?? DEFAULT_SIZE
}

/**
 * A one-off animation started by a command: it plays for `ms` from `start`
 * (Date.now()). A run says which way he's heading, so he faces it.
 */
export type Cue = { anim: Anim; start: number; ms: number; facing?: 'left' | 'right' }

/**
 * The cues a command's events start, by player. Later events win, so a
 * player pushed and then knocked down falls, and an attacker who goes down
 * too falls after his block.
 */
export function cuesOf(events: readonly GameEvent[], now: number): Record<string, Cue> {
  const cues: Record<string, Cue> = {}
  const cue = (playerId: string, anim: Anim, ms = ONCE_MS) => (cues[playerId] = { anim, start: now, ms })
  for (const e of events) {
    if (e.type === 'moved') {
      // Left or right across the pitch, from the hex he left to the one he got to.
      const dx = hexCenter(e.path.at(-1)!).x - hexCenter(e.path[0]!).x
      cues[e.playerId] = { anim: 'running', start: now, ms: RUNNING_MS, ...(dx !== 0 ? { facing: dx < 0 ? 'left' : 'right' } : {}) }
    } else if (e.type === 'disengaged' || e.type === 'followedUp') cue(e.playerId, 'running', RUNNING_MS)
    else if (e.type === 'blockChosen') cue(e.attackerId, 'blocking')
    else if (e.type === 'pushed') cue(e.playerId, 'stumbling')
    else if (e.type === 'knockedDown') cue(e.playerId, 'falling')
    else if (e.type === 'touchdown') cue(e.playerId, 'victory')
  }
  return cues
}

/** A looping animation's frame at `now`, shifted by `phase` milliseconds. */
const loopFrame = (now: number, phase: number) => Math.floor((now + phase) / FRAME_MS) % FRAMES

/**
 * Where in its loop a player's idle (and winded, running) starts: a fixed
 * shift of up to one loop, from his id, so a team doesn't breathe in unison
 * and a player keeps his own rhythm from one render to the next.
 */
export function phaseOf(playerId: string): number {
  let h = 2_166_136_261
  for (let i = 0; i < playerId.length; i++) h = Math.imul(h ^ playerId.charCodeAt(i), 16_777_619)
  return (h >>> 0) % Math.round(ONCE_MS)
}

/** The animations played once; the others loop. */
const ONCE: ReadonlySet<Anim> = new Set(['blocking', 'falling', 'victory', 'stumbling'])

/**
 * What a player's sprite shows now: the animation, its row and the frame.
 * The looping animations run on the time, shifted by the player's `phase`
 * (see phaseOf), so players don't all move in step.
 * With reduced motion nothing loops: the first frame, or the last of a fall.
 */
export function spriteFrame(
  player: Pick<Player, 'status' | 'winded'>,
  cue: Cue | undefined,
  now: number,
  phase: number,
  { reducedMotion = false, rows = ANIMS.length }: { reducedMotion?: boolean; rows?: number } = {},
): { anim: Anim; row: number; frame: number } {
  const row = (anim: Anim) => {
    const index = ANIMS.indexOf(anim)
    // A sheet without the row shows idle in its place.
    return index < rows ? index : 0
  }
  const elapsed = cue ? now - cue.start : Infinity
  if (cue && elapsed >= 0 && elapsed < cue.ms) {
    const frame = ONCE.has(cue.anim) ? Math.min(Math.floor(elapsed / FRAME_MS), FRAMES - 1) : reducedMotion ? 0 : loopFrame(now, phase)
    // With reduced motion a fall shows him lying at once, and the others their first frame.
    const still = cue.anim === 'falling' ? FRAMES - 1 : 0
    return { anim: cue.anim, row: row(cue.anim), frame: reducedMotion ? still : frame }
  }
  // Down: lying, the fall's last frame.
  if (player.status !== 'standing') return { anim: 'falling', row: row('falling'), frame: FRAMES - 1 }
  const anim: Anim = player.winded ? 'winded' : 'idle'
  return { anim, row: row(anim), frame: reducedMotion ? 0 : loopFrame(now, phase) }
}
