import { allPitchHexes, endZoneOf, fromColRow, type Hex, hexKey, isHalfwayHex, toColRow, wideZoneOf } from '@orcball/engine'
import { useMemo } from 'react'
import { BOARD_HEIGHT, BOARD_WIDTH, HEX_SIZE, HEX_WIDTH, hexCenter, hexPoints } from '../geometry'
import { targetHexes } from '../interaction'
import { tokenLabel } from '../labels'
import { useMatch } from '../store'

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

export function Board({ extraTargets = [] }: { extraTargets?: Hex[] }) {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const options = useMatch((s) => s.options)
  const selected = useMatch((s) => s.selected)
  const tap = useMatch((s) => s.tapHex)

  const targets = useMemo(() => {
    const keys = new Set([...targetHexes(game, options, selected), ...extraTargets].map(hexKey))
    return keys
  }, [game, options, selected, extraTargets])

  const players = Object.values(game.players).filter((p) => p.hex)
  const ball = game.ball.hex ? hexCenter(game.ball.hex) : null

  return (
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
      {PITCH.filter((hex) => targets.has(hexKey(hex))).map((hex) => (
        <polygon key={`t${hexKey(hex)}`} points={hexPoints(hex, 3)} className="target" />
      ))}
      <polyline points={HALFWAY} className="halfway-line" />
      {players.map((p) => {
        const { x, y } = hexCenter(p.hex!)
        return (
          <g
            key={p.id}
            className={`token ${p.team} ${p.status}${p.id === selected ? ' selected' : ''}${p.activatedThisRound ? ' done' : ''}`}
            data-player={p.id}
            onClick={() => tap(p.hex!)}
          >
            <circle cx={x} cy={y} r={HEX_SIZE * 0.72} />
            <text x={x} y={y + 5} textAnchor="middle">
              {tokenLabel(file, p)}
            </text>
            {p.status !== 'standing' && (
              <text x={x} y={y + HEX_SIZE * 0.62} textAnchor="middle" className="status">
                {p.status === 'stunned' ? 'stunned' : 'down'}
              </text>
            )}
          </g>
        )
      })}
      {ball && <circle className="ball" cx={ball.x + (game.ball.carrier ? HEX_SIZE * 0.5 : 0)} cy={ball.y - (game.ball.carrier ? HEX_SIZE * 0.5 : 0)} r={HEX_SIZE * 0.24} />}
    </svg>
  )
}
