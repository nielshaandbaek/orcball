import { currentPositionId, type GameEvent, type GameState, type Hex, type MatchFile, type Player, type TeamId } from '@orcball/engine'
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

/**
 * The id of the pattern that shows one frame of a sheet (#286): one fixed
 * pattern per frame, shared by every player on that sheet.
 */
export function frameId(href: string, row: number, frame: number): string {
  return `sprite-${href.replace(/[^A-Za-z0-9]/g, '-')}-${row}-${frame}`
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
 * (Date.now()). A run says which way he's heading and a block which way the
 * player blocked is, so he faces it.
 */
export type Cue = {
  anim: Anim
  start: number
  ms: number
  facing?: 'left' | 'right'
  /**
   * A fall straight after the stumble: the defender of a successful Tackle,
   * pushed back and going down. With `hold` he stays lying after it,
   * though the engine only knocks him down once the follow-up is decided.
   */
  then?: 'falling'
  hold?: boolean
}

/** How long a held fall waits for the knock-down at most, in case it never comes. */
export const HOLD_MS = 60_000

/** Left or right across the pitch, from one hex to another; none if straight up or down. */
function facingFrom(from: Hex | null | undefined, to: Hex | null | undefined): { facing?: 'left' | 'right' } {
  if (!from || !to) return {}
  const dx = hexCenter(to).x - hexCenter(from).x
  return dx === 0 ? {} : { facing: dx < 0 ? 'left' : 'right' }
}

/**
 * The cues a command's events start, by player. Later events win, so a
 * player pushed and then knocked down falls, and an attacker who goes down
 * too falls after his block. `before` is the position the command was sent
 * in: where the attacker and the player he blocks stand, so he faces him.
 */
export function cuesOf(events: readonly GameEvent[], now: number, before?: Pick<GameState, 'players' | 'pending'>): Record<string, Cue> {
  const cues: Record<string, Cue> = {}
  const cue = (playerId: string, anim: Anim, ms = ONCE_MS) => (cues[playerId] = { anim, start: now, ms })
  const downId = tackledDown(events, before)
  for (const e of events) {
    if (e.type === 'moved') {
      // From the hex he left to the one he got to.
      cues[e.playerId] = { anim: 'running', start: now, ms: RUNNING_MS, ...facingFrom(e.path[0], e.path.at(-1)) }
    } else if (e.type === 'disengaged' || e.type === 'followedUp') cue(e.playerId, 'running', RUNNING_MS)
    else if (e.type === 'blockChosen') {
      // The block being decided names the player blocked.
      const defenderId = (before?.pending?.data as { defenderId?: unknown } | null | undefined)?.defenderId
      const defender = typeof defenderId === 'string' ? before?.players[defenderId]?.hex : null
      cues[e.attackerId] = { anim: 'blocking', start: now, ms: ONCE_MS, ...facingFrom(before?.players[e.attackerId]?.hex, defender) }
    }
    else if (e.type === 'pushed') {
      // A successful Tackle's defender stumbles back and falls at once, before the follow-up is asked.
      if (e.playerId === downId && e.to !== null) cues[e.playerId] = { anim: 'stumbling', start: now, ms: ONCE_MS * 2, then: 'falling', hold: true }
      else cue(e.playerId, 'stumbling')
    } else if (e.type === 'knockedDown') {
      // Already falling after his stumble: the knock-down needn't fall again.
      const own = cues[e.playerId]
      if (own?.then === 'falling') cues[e.playerId] = { ...own, hold: false }
      else cue(e.playerId, 'falling')
    }
    else if (e.type === 'touchdown') cue(e.playerId, 'victory')
  }
  return cues
}

/**
 * The player a successful Tackle knocks down once the push is over: the
 * defender of the block, when the push being chosen is a Tackle's, or the
 * command rolled a successful Tackle (a push with only one hex to go to).
 */
function tackledDown(events: readonly GameEvent[], before?: Pick<GameState, 'pending'>): string | null {
  const data = before?.pending?.data as { tackle?: unknown; block?: { defenderId?: unknown }; defenderId?: unknown } | null | undefined
  const defenderId = data?.block?.defenderId ?? data?.defenderId
  if (typeof defenderId !== 'string') return null
  const pushing = before?.pending?.kind === 'blocking.push' && data?.tackle === true
  const tackled = events.some((e) => e.type === 'rolled' && e.test === 'Tackle' && e.success)
  return pushing || tackled ? defenderId : null
}

/**
 * The cues still playing, with those the events start (a player's new cue
 * replaces his old one). A held fall stays until his knock-down, which then
 * doesn't fall again.
 */
export function withCues(cues: Record<string, Cue>, events: readonly GameEvent[], now: number, before?: Pick<GameState, 'players' | 'pending'>): Record<string, Cue> {
  const live = Object.fromEntries(Object.entries(cues).filter(([, c]) => c.start + c.ms > now || (c.hold && c.start + HOLD_MS > now)))
  const started = cuesOf(events, now, before)
  for (const [id, c] of Object.entries(started)) {
    const held = live[id]
    if (held?.hold && c.anim === 'falling' && c.then === undefined) {
      // His knock-down: the fall already played, or is playing; let it finish, no longer held.
      started[id] = { ...held, hold: false }
    }
  }
  return { ...live, ...started }
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
    // A stumble and then a fall: the fall starts when the stumble is over.
    const second = cue.then !== undefined && elapsed >= ONCE_MS
    const anim = second ? cue.then! : cue.anim
    const into = second ? elapsed - ONCE_MS : elapsed
    const frame = ONCE.has(anim) ? Math.min(Math.floor(into / FRAME_MS), FRAMES - 1) : reducedMotion ? 0 : loopFrame(now, phase)
    // With reduced motion a fall shows him lying at once, and the others their first frame.
    const still = anim === 'falling' || cue.then === 'falling' ? FRAMES - 1 : 0
    const shown: Anim = reducedMotion && cue.then === 'falling' ? 'falling' : anim
    return { anim: shown, row: row(shown), frame: reducedMotion ? still : frame }
  }
  // A held fall: lying until the engine knocks him down.
  if (cue?.hold && elapsed >= 0) return { anim: 'falling', row: row('falling'), frame: FRAMES - 1 }
  // Down: lying, the fall's last frame.
  if (player.status !== 'standing') return { anim: 'falling', row: row('falling'), frame: FRAMES - 1 }
  const anim: Anim = player.winded ? 'winded' : 'idle'
  return { anim, row: row(anim), frame: reducedMotion ? 0 : loopFrame(now, phase) }
}
