import {
  allPitchHexes,
  distance,
  endZoneOf,
  enemyTackleZones,
  fromColRow,
  type GameEvent,
  type GameState,
  type Hex,
  hexKey,
  isHalfwayHex,
  onPitch,
  passBand,
  possibleInterceptors,
  reachableHexes,
  toColRow,
  wideZoneOf,
} from '@orcball/engine'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BOARD_HEIGHT, BOARD_WIDTH, HEX_SIZE, HEX_WIDTH, hexCenter, hexPoints, tokenCenter } from '../geometry'
import { canStep, type Route, routeFrom, routeTo, targetHexes } from '../interaction'
import ballSprite from '../../../../art/icons/ball/default.png'
import { EVENT_ICON_MS, type EventIconAt } from '../effects'
import { BRIEF_MS, type BriefIcon, briefIconsOf, type IconState, tokenIcon } from '../icons'
import { tokenLabel } from '../labels'
import { usePrefs } from '../prefs'
import { computerToAct, useMatch } from '../store'
import { Captions } from './Captions'
import { CentreBanner } from './CentreBanner'
import { BoardPrompt } from './BoardPrompt'
import { RoundBanner } from './RoundBanner'

const PITCH = allPitchHexes()

function zoneClass(hex: Hex): string {
  if (endZoneOf(hex)) return 'hex endzone'
  if (isHalfwayHex(hex)) return 'hex halfway'
  if (wideZoneOf(hex)) return 'hex wide'
  return 'hex'
}

/** The halfway line: between columns 9 and 10 of the long rows, through column 9 of the short ones. */
function halfwayLine(): string {
  const points: string[] = []
  for (let row = 1; row <= 9; row++) {
    const { x, y } = hexCenter(fromColRow({ col: 9, row }))
    const lineX = row % 2 === 1 ? x + HEX_WIDTH / 2 : x
    points.push(`${lineX},${y - HEX_SIZE * 0.75}`, `${lineX},${y + HEX_SIZE * 0.75}`)
  }
  return points.join(' ')
}
const HALFWAY = halfwayLine()

/** The player whose movement to show: the active one, or a selected player of the team whose go it is. */
function moverOf(game: GameState, selected: string | null): string | null {
  if (game.pending) return null
  if (game.activation) return game.activation.playerId
  if (game.phase !== 'Round' || !selected) return null
  const player = game.players[selected]
  return player && player.team === game.turnOwner && !player.activatedThisRound ? selected : null
}

/** Size of the ball sprite on the board. */
const BALL = HEX_SIZE * 1.0

/** Size of a player sprite on the board: the figure fills the hex, and may overlap its edge a little. */
const ICON = HEX_SIZE * 2

/**
 * A sprite's SVG transform about its centre: lying on its side when down,
 * and for the away team mirrored (after the turn, so a down player is the
 * mirror image of a home one).
 */
export function spriteTransform(mirrored: boolean, down: boolean, x: number, y: number): string {
  const parts: string[] = []
  if (mirrored) parts.push(`translate(${2 * x} 0) scale(-1 1)`)
  if (down) parts.push(`rotate(-90 ${x} ${y})`)
  return parts.join(' ')
}

/** Icons that already show the player down (#114): drawn as they are, not turned on their side. */
const DRAWN_DOWN: ReadonlySet<IconState> = new Set(['prone', 'stunned'])

/** The brief Shove, Tackle and Catch icons (#114): each player's shows for BRIEF_MS after it happens. */
function useBriefIcons(events: readonly GameEvent[]): Record<string, BriefIcon> {
  const [brief, setBrief] = useState<Record<string, BriefIcon>>({})
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    for (const [id, icon] of Object.entries(briefIconsOf(events))) {
      setBrief((b) => ({ ...b, [id]: icon }))
      clearTimeout(timers.current.get(id))
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id)
          setBrief(({ [id]: _, ...rest }) => rest)
        }, BRIEF_MS),
      )
    }
  }, [events])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])
  return brief
}

/** The event icons, by name: art/icons/events/pow.png is 'pow'. */
const EVENT_ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../../../../art/icons/events/*.png', { eager: true, import: 'default', query: '?url' })).map(([path, url]) => [
    path.split('/').at(-1)!.replace(/\.png$/, ''),
    url,
  ]),
)

/** Size of an event icon over a player. */
const EVENT_ICON = HEX_SIZE * 1.2

/** The event icons showing: each for EVENT_ICON_MS after the command that set it off. */
function useEventIcons(found: readonly EventIconAt[]): Record<string, EventIconAt> {
  const [showing, setShowing] = useState<Record<string, EventIconAt>>({})
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    for (const at of found) {
      const { playerId } = at
      setShowing((s) => ({ ...s, [playerId]: at }))
      clearTimeout(timers.current.get(playerId))
      timers.current.set(
        playerId,
        setTimeout(() => {
          timers.current.delete(playerId)
          setShowing(({ [playerId]: _, ...rest }) => rest)
        }, EVENT_ICON_MS),
      )
    }
  }, [found])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])
  return showing
}

/**
 * A soft shadow under a standing player's sprite: a flat oval at his feet.
 * Drawn by the board, not in the sprite, so it stays on the ground when the
 * sprite is mirrored. A player who is down has none (#160).
 */
function SpriteShadow({ x, y }: { x: number; y: number }) {
  return <ellipse cx={x} cy={y + ICON * 0.42} rx={ICON * 0.27} ry={ICON * 0.07} className="shadow" />
}

/** Where the labels over a sprite go ("winded", "down", "stunned"): above his head, clear of the sprite (#160). */
const LABEL_ABOVE = HEX_SIZE * 0.45

/**
 * The path to show (#113): the rest of the one being walked or waiting on a
 * roll, else the way to the hex being previewed. Only for the active player
 * on the move, not while aiming a pass or answering a decision, and never
 * for a player the computer is moving.
 */
export function shownRoute(
  game: GameState,
  {
    preview,
    route,
    walking,
    confirming,
    aiming,
    computerActing,
    stepping,
  }: {
    preview: Hex | null
    route: Route | null
    walking: boolean
    confirming: boolean
    aiming: boolean
    computerActing: boolean
    stepping: boolean
  },
): Route | null {
  if (!game.activation || game.pending || aiming || computerActing) return null
  const at = game.players[game.activation.playerId]?.hex
  if (!at) return null
  if (walking || confirming) return route ? routeFrom(route, at) : null
  // Only once the action lets him move: not on a Block, nor after a Blitz has spent its MA.
  return preview && stepping ? routeTo(game, preview) : null
}

/** The class of a step's marker: plain, or the Dodge and Sprint it needs, coloured like the reach shading. */
function stepClass(step: { dodge: boolean; sprint: boolean }, last: boolean): string {
  return ['path-step', step.dodge && 'dodge', step.sprint && 'sprint', last && 'last'].filter(Boolean).join(' ')
}

export function Board() {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const brief = useBriefIcons(useMatch((s) => s.lastEvents))
  const eventIcons = useEventIcons(useMatch((s) => s.lastEventIcons))
  const options = useMatch((s) => s.options)
  const selected = useMatch((s) => s.selected)
  const aiming = useMatch((s) => s.aiming)
  const leaping = useMatch((s) => s.leaping)
  const confirm = useMatch((s) => s.confirm)
  const tap = useMatch((s) => s.tapHex)
  const icons = usePrefs((s) => s.icons)
  const walking = useMatch((s) => s.walking)
  const preview = useMatch((s) => s.preview)
  const route = useMatch((s) => s.route)
  const hover = useMatch((s) => s.hover)
  const computer = useMatch((s) => s.computer)
  // Whether the last press on the board was a touch (or pen): then a first tap only shows the path.
  const touch = useRef(false)

  const targets = useMemo(() => new Set(targetHexes(game, options, selected).map(hexKey)), [game, options, selected])
  const mover = moverOf(game, selected)

  // Reachable hexes for the mover, shaded by what getting there takes.
  const reach = useMemo(() => {
    // Before activating, how far he could go; once activated, only while his action lets him move.
    if (!mover || aiming || leaping || (game.activation && !canStep(options))) return []
    return reachableHexes(game, mover).map((r) => ({
      hex: r.hex,
      kind: r.dodges > 0 ? 'dodge' : r.sprint ? 'sprint' : r.disengages > 0 ? 'disengage' : 'normal',
    }))
  }, [game, mover, aiming, leaping, options])

  // Where he can leap to, while the Leap button is on (v19).
  const leaps = useMemo(() => (leaping ? options.flatMap((o) => (o.available && o.command.type === 'leap' ? [o.command.to] : [])) : []), [leaping, options])

  // Hexes in an enemy tackle zone, for the mover's team.
  const zones = useMemo(() => {
    if (!mover) return []
    const team = game.players[mover]!.team
    return PITCH.filter((hex) => enemyTackleZones(game, hex, team) > 0)
  }, [game, mover])

  // Pass range bands while aiming.
  const bands = useMemo(() => {
    if (!aiming || !game.activation) return []
    const thrower = game.players[game.activation.playerId]!
    return options.flatMap((o) =>
      o.command.type === 'pass' ? [{ hex: o.command.target, band: passBand(game, distance(thrower.hex!, o.command.target))!.name }] : [],
    )
  }, [game, options, aiming])

  // Who could intercept the pass waiting for confirmation.
  const interceptors = useMemo(() => {
    if (confirm?.command.type !== 'pass' || !game.activation) return new Set<string>()
    const thrower = game.players[game.activation.playerId]!
    return new Set(possibleInterceptors(game, thrower, confirm.command.target).map((p) => p.id))
  }, [game, confirm])

  // Drawn from the top of the board down, so a sprite that overlaps the one above it stands in front of it.
  const path = useMemo(
    () =>
      shownRoute(game, {
        preview,
        route,
        walking,
        confirming: confirm?.command.type === 'move',
        aiming: aiming || leaping,
        computerActing: computerToAct(game, computer),
        stepping: canStep(options),
      }),
    [game, preview, route, walking, confirm, aiming, leaping, computer, options],
  )

  const players = Object.values(game.players)
    .filter((p) => p.hex)
    .sort((a, b) => tokenCenter(a.hex!).y - tokenCenter(b.hex!).y || tokenCenter(a.hex!).x - tokenCenter(b.hex!).x)
  const ball = game.ball.hex ? tokenCenter(game.ball.hex) : null

  return (
    <div className={walking ? 'board-frame walking' : 'board-frame'}>
      <svg
        className="board"
        viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
        role="img"
        aria-label="Pitch"
        onPointerDownCapture={(e) => {
          touch.current = e.pointerType !== 'mouse'
        }}
        onPointerLeave={(e) => e.pointerType === 'mouse' && hover(null)}
      >
        <defs>
          {/*
            The ball's outline (#115): a dark edge, a thin pale ring, a dark edge outside that, and a
            little glow. An SVG filter, not CSS drop-shadow: Safari doesn't apply CSS filters to
            elements inside an SVG. Sizes are in board units; the ball's own size and place don't change.
          */}
          <filter id="ball-glow" x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
            <feMorphology in="SourceAlpha" operator="dilate" radius="0.6" result="edgeIn" />
            <feMorphology in="SourceAlpha" operator="dilate" radius="1.8" result="ring" />
            <feMorphology in="SourceAlpha" operator="dilate" radius="2.4" result="edgeOut" />
            <feGaussianBlur in="edgeOut" stdDeviation="2.5" result="halo" />
            <feFlood floodColor="#fff3a8" />
            <feComposite in2="halo" operator="in" result="glow" />
            <feFlood floodColor="#1a1405" />
            <feComposite in2="edgeOut" operator="in" result="darkOut" />
            <feFlood floodColor="#fffbe0" />
            <feComposite in2="ring" operator="in" result="pale" />
            <feFlood floodColor="#1a1405" />
            <feComposite in2="edgeIn" operator="in" result="darkIn" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="darkOut" />
              <feMergeNode in="pale" />
              <feMergeNode in="darkIn" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {PITCH.map((hex) => (
          <polygon
            key={hexKey(hex)}
            points={hexPoints(hex)}
            className={zoneClass(hex)}
            data-hex={`${toColRow(hex).col},${toColRow(hex).row}`}
            onClick={() => tap(hex, touch.current)}
            onPointerEnter={(e) => e.pointerType === 'mouse' && hover(hex)}
          />
        ))}
        {zones.map((hex) => (
          <polygon key={`z${hexKey(hex)}`} points={hexPoints(hex, 6)} className="zone" />
        ))}
        {reach.map((r) => (
          <polygon key={`r${hexKey(r.hex)}`} points={hexPoints(r.hex, 3)} className={`reach ${r.kind}`} />
        ))}
        {leaps.map((hex) => (
          <polygon key={`l${hexKey(hex)}`} points={hexPoints(hex, 3)} className="reach leap" data-leap={`${toColRow(hex).col},${toColRow(hex).row}`} />
        ))}
        {bands.map((b) => (
          <polygon key={`b${hexKey(b.hex)}`} points={hexPoints(b.hex, 3)} className={`band ${b.band.replace(/\s+/g, '-').toLowerCase()}`} />
        ))}
        {PITCH.filter((hex) => targets.has(hexKey(hex))).map((hex) => (
          <polygon key={`t${hexKey(hex)}`} points={hexPoints(hex, 3)} className="target" />
        ))}
        {(confirm?.command.type === 'move' || confirm?.command.type === 'leap') && <polygon points={hexPoints(confirm.command.to, 3)} className="target" />}
        {confirm?.command.type === 'pass' && <polygon points={hexPoints(confirm.command.target, 3)} className="target" />}
        <polyline points={HALFWAY} className="halfway-line" />
        {path && (
          <g className="path" data-path={path.hexes.map((hex) => `${toColRow(hex).col},${toColRow(hex).row}`).join(' ')}>
            <polyline points={path.hexes.map((hex) => `${hexCenter(hex).x},${hexCenter(hex).y}`).join(' ')} className="path-line" />
            {path.hexes.slice(1).map((hex, i) => (
              <circle
                key={hexKey(hex)}
                cx={hexCenter(hex).x}
                cy={hexCenter(hex).y}
                r={i === path.steps.length - 1 ? 7 : 5}
                className={stepClass(path.steps[i]!, i === path.steps.length - 1)}
              />
            ))}
          </g>
        )}
        {players.map((p) => {
          const { x, y } = tokenCenter(p.hex!)
          const inCrowd = !onPitch(p.hex!)
          const icon = icons ? tokenIcon(file, p, { activation: game.activation, brief: brief[p.id] }) : null
          const drawnDown = icon !== null && DRAWN_DOWN.has(icon.state)
          const classes = ['token', p.team, p.status]
          if (icon) classes.push('with-icon')
          if (drawnDown) classes.push('icon-down')
          const active = p.id === game.activation?.playerId
          if (p.id === selected || active) classes.push('selected')
          if (p.activatedThisRound && !active) classes.push('done')
          if (interceptors.has(p.id)) classes.push('interceptor')
          if (inCrowd) classes.push('in-crowd')
          return (
            <g key={p.id} className={classes.join(' ')} data-player={p.id} onClick={inCrowd ? undefined : () => tap(p.hex!, touch.current)}>
              {inCrowd && <title>Pushed into the crowd</title>}
              {p.activatedThisRound && !active && !inCrowd && <title>Already activated this round</title>}
              <circle cx={x} cy={y} r={icon ? HEX_SIZE * 0.85 : HEX_SIZE * 0.72} />
              {icon ? (
                <>
                  {p.status === 'standing' && <SpriteShadow x={x} y={y} />}
                  <image
                    href={icon.href}
                    data-icon={icon.state}
                    x={x - ICON / 2}
                    y={y - ICON / 2}
                    width={ICON}
                    height={ICON}
                    className="icon"
                    // Down players lie on their side, unless their icon already shows them down; away sprites
                    // are mirrored, to face the end they attack.
                    transform={spriteTransform(p.team === 'away', p.status !== 'standing' && !drawnDown, x, y) || undefined}
                  />
                  <text x={x + HEX_SIZE * 0.5} y={y + HEX_SIZE * 0.62} textAnchor="middle" className="number">
                    {p.id.split('-').at(-1)}
                  </text>
                </>
              ) : (
                <text x={x} y={y + 5} textAnchor="middle">
                  {tokenLabel(file, p)}
                </text>
              )}
              {p.status !== 'standing' && (
                // Over a sprite, above his head where it doesn't cover him (#160); under the initials otherwise.
                <text x={x} y={icon ? y - LABEL_ABOVE : y + HEX_SIZE * 0.62} textAnchor="middle" className="status" data-status={p.status}>
                  {p.status === 'stunned' ? 'stunned' : 'down'}
                </text>
              )}
              {/* Not while he's down: no tackle zone then anyway, and the place is taken (#160). */}
              {p.winded && p.status === 'standing' && (
                <text x={x} y={y - LABEL_ABOVE} textAnchor="middle" className="status">
                  winded
                </text>
              )}
            </g>
          )
        })}
        {ball && (
          // In the middle of its hex, in front of the carrier if there is one.
          <image
            href={ballSprite}
            className="ball"
            filter="url(#ball-glow)"
            x={ball.x - BALL / 2}
            y={ball.y - BALL / 2}
            width={BALL}
            height={BALL}
          />
        )}
        {Object.values(eventIcons).map(({ playerId, icon, hex }) => {
          const href = EVENT_ICONS[icon]
          if (!href) return null
          // Over the player's head, in front of everything.
          const { x, y } = tokenCenter(hex)
          return (
            <image
              key={playerId}
              href={href}
              className="event-icon"
              data-event-icon={icon}
              data-for={playerId}
              x={x - EVENT_ICON / 2}
              y={y - HEX_SIZE * 0.55 - EVENT_ICON / 2}
              width={EVENT_ICON}
              height={EVENT_ICON}
            />
          )
        })}
      </svg>
      <Captions />
      <BoardPrompt />
      <RoundBanner />
      <CentreBanner />
    </div>
  )
}
