import {
  allPitchHexes,
  distance,
  endZoneOf,
  enemyTackleZones,
  fromColRow,
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
import { useMemo } from 'react'
import { BOARD_HEIGHT, BOARD_WIDTH, HEX_SIZE, HEX_WIDTH, hexCenter, hexPoints, tokenCenter } from '../geometry'
import { targetHexes } from '../interaction'
import { tokenIcon } from '../icons'
import { tokenLabel } from '../labels'
import { usePrefs } from '../prefs'
import { useMatch } from '../store'
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

export function Board() {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const options = useMatch((s) => s.options)
  const selected = useMatch((s) => s.selected)
  const aiming = useMatch((s) => s.aiming)
  const confirm = useMatch((s) => s.confirm)
  const tap = useMatch((s) => s.tapHex)
  const icons = usePrefs((s) => s.icons)

  const targets = useMemo(() => new Set(targetHexes(game, options, selected).map(hexKey)), [game, options, selected])
  const mover = moverOf(game, selected)

  // Reachable hexes for the mover, shaded by what getting there takes.
  const reach = useMemo(() => {
    if (!mover || aiming) return []
    return reachableHexes(game, mover).map((r) => ({
      hex: r.hex,
      kind: r.dodges > 0 ? 'dodge' : r.sprint ? 'sprint' : r.disengages > 0 ? 'disengage' : 'normal',
    }))
  }, [game, mover, aiming])

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
  const players = Object.values(game.players)
    .filter((p) => p.hex)
    .sort((a, b) => tokenCenter(a.hex!).y - tokenCenter(b.hex!).y || tokenCenter(a.hex!).x - tokenCenter(b.hex!).x)
  const ball = game.ball.hex ? tokenCenter(game.ball.hex) : null

  return (
    <div className="board-frame">
      <svg className="board" viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`} role="img" aria-label="Pitch">
        {PITCH.map((hex) => (
          <polygon
            key={hexKey(hex)}
            points={hexPoints(hex)}
            className={zoneClass(hex)}
            data-hex={`${toColRow(hex).col},${toColRow(hex).row}`}
            onClick={() => tap(hex)}
          />
        ))}
        {zones.map((hex) => (
          <polygon key={`z${hexKey(hex)}`} points={hexPoints(hex, 6)} className="zone" />
        ))}
        {reach.map((r) => (
          <polygon key={`r${hexKey(r.hex)}`} points={hexPoints(r.hex, 3)} className={`reach ${r.kind}`} />
        ))}
        {bands.map((b) => (
          <polygon key={`b${hexKey(b.hex)}`} points={hexPoints(b.hex, 3)} className={`band ${b.band.replace(/\s+/g, '-').toLowerCase()}`} />
        ))}
        {PITCH.filter((hex) => targets.has(hexKey(hex))).map((hex) => (
          <polygon key={`t${hexKey(hex)}`} points={hexPoints(hex, 3)} className="target" />
        ))}
        {confirm?.command.type === 'move' && <polygon points={hexPoints(confirm.command.to, 3)} className="target" />}
        {confirm?.command.type === 'pass' && <polygon points={hexPoints(confirm.command.target, 3)} className="target" />}
        <polyline points={HALFWAY} className="halfway-line" />
        {players.map((p) => {
          const { x, y } = tokenCenter(p.hex!)
          const inCrowd = !onPitch(p.hex!)
          const icon = icons ? tokenIcon(file, p) : null
          const classes = ['token', p.team, p.status]
          if (icon) classes.push('with-icon')
          const active = p.id === game.activation?.playerId
          if (p.id === selected || active) classes.push('selected')
          if (p.activatedThisRound && !active) classes.push('done')
          if (interceptors.has(p.id)) classes.push('interceptor')
          if (inCrowd) classes.push('in-crowd')
          return (
            <g key={p.id} className={classes.join(' ')} data-player={p.id} onClick={inCrowd ? undefined : () => tap(p.hex!)}>
              {inCrowd && <title>Pushed into the crowd</title>}
              {p.activatedThisRound && !active && !inCrowd && <title>Already activated this round</title>}
              <circle cx={x} cy={y} r={icon ? HEX_SIZE * 0.85 : HEX_SIZE * 0.72} />
              {icon ? (
                <>
                  <image
                    href={icon}
                    x={x - ICON / 2}
                    y={y - ICON / 2}
                    width={ICON}
                    height={ICON}
                    className="icon"
                    // Down players lie on their side; away sprites are mirrored, to face the end they attack.
                    transform={spriteTransform(p.team === 'away', p.status !== 'standing', x, y) || undefined}
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
                <text x={x} y={y + HEX_SIZE * 0.62} textAnchor="middle" className="status">
                  {p.status === 'stunned' ? 'stunned' : 'down'}
                </text>
              )}
              {p.winded && (
                <text x={x} y={y - HEX_SIZE * 0.45} textAnchor="middle" className="status">
                  winded
                </text>
              )}
            </g>
          )
        })}
        {ball && (
          <circle
            className="ball"
            cx={ball.x + (game.ball.carrier ? HEX_SIZE * 0.5 : 0)}
            cy={ball.y - (game.ball.carrier ? HEX_SIZE * 0.5 : 0)}
            r={HEX_SIZE * 0.24}
          />
        )}
      </svg>
      <BoardPrompt />
      <RoundBanner />
    </div>
  )
}
