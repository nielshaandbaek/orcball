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
  passBand,
  possibleInterceptors,
  reachableHexes,
  toColRow,
  wideZoneOf,
} from '@orcball/engine'
import { useMemo } from 'react'
import { BOARD_HEIGHT, BOARD_WIDTH, HEX_SIZE, HEX_WIDTH, hexCenter, hexPoints } from '../geometry'
import { targetHexes } from '../interaction'
import { tokenLabel } from '../labels'
import { useMatch } from '../store'
import { BoardPrompt } from './BoardPrompt'

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

export function Board() {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const options = useMatch((s) => s.options)
  const selected = useMatch((s) => s.selected)
  const aiming = useMatch((s) => s.aiming)
  const confirm = useMatch((s) => s.confirm)
  const tap = useMatch((s) => s.tapHex)

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

  const players = Object.values(game.players).filter((p) => p.hex)
  const ball = game.ball.hex ? hexCenter(game.ball.hex) : null

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
          const { x, y } = hexCenter(p.hex!)
          const classes = ['token', p.team, p.status]
          const active = p.id === game.activation?.playerId
          if (p.id === selected || active) classes.push('selected')
          if (p.activatedThisRound && !active) classes.push('done')
          if (interceptors.has(p.id)) classes.push('interceptor')
          return (
            <g key={p.id} className={classes.join(' ')} data-player={p.id} onClick={() => tap(p.hex!)}>
              {p.activatedThisRound && !active && <title>Already activated this round</title>}
              <circle cx={x} cy={y} r={HEX_SIZE * 0.72} />
              <text x={x} y={y + 5} textAnchor="middle">
                {tokenLabel(file, p)}
              </text>
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
    </div>
  )
}
