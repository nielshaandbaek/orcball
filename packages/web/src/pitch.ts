import { fromColRow, type Hex, PITCH_ROWS, toColRow, WIDE_ZONE_ROWS } from '@orcball/engine'
import { BOARD_HEIGHT, HEX_SIZE, HEX_WIDTH, hexCenter, PAD } from './geometry'

// Grass on the pitch (#163): seamless tiles from art/pitch/, one per hex,
// picked from the hex's position so the pitch looks varied but the same on
// every render and reload. A tile whose name ends in "-rare" (a dirt patch)
// comes up about 1 hex in RARE_ONE_IN; the others share the rest.

export type GrassTile = { id: string; href: string; rare: boolean }

/** About 1 hex in this many gets a rare tile. */
export const RARE_ONE_IN = 12

/** The tiles, by file name, from an import.meta.glob of art/pitch/*.png. */
export function grassTiles(files: Record<string, string>): GrassTile[] {
  return Object.entries(files)
    .map(([path, href]) => {
      const name = path.split('/').at(-1)!.replace(/\.png$/, '')
      return { id: `grass-${name}`, href, rare: name.endsWith('-rare') }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** A well-mixed number from a hex's column and row: the same hex always gives the same number. */
function mix(hex: Hex): number {
  const { col, row } = toColRow(hex)
  let x = (Math.imul(col, 374_761_393) + Math.imul(row, 668_265_263)) >>> 0
  x = Math.imul(x ^ (x >>> 13), 1_274_126_177) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}

/** The tile for a hex, or null without tiles. */
export function tileFor(tiles: readonly GrassTile[], hex: Hex): GrassTile | null {
  const rare = tiles.filter((t) => t.rare)
  const plain = tiles.filter((t) => !t.rare)
  const x = mix(hex)
  if (rare.length > 0 && (plain.length === 0 || x % RARE_ONE_IN === 0)) return rare[(x >>> 8) % rare.length]!
  return plain.length > 0 ? plain[(x >>> 8) % plain.length]! : null
}

// The pitch's frame and chalk lines (#245). The pitch is drawn as a rectangle:
// tight to the 18-hex rows' outer edges and the outer points of rows 1 and 9,
// the gaps along its edge (the 17-hex rows' half-hex notches, the triangles
// between the top and bottom points) filled with grass from hexes just off the
// pitch, which take no part in play. Every line is straight.

/** The pitch's rectangle on the board: the touchline. */
export const PITCH_RECT = { x: PAD, y: PAD, width: HEX_WIDTH * 18, height: BOARD_HEIGHT - PAD * 2 }

/** The zone a fill hex continues, for its colour: the end zone it's beside, or the wide zone. */
export type FillZone = 'endzone' | 'wide'

/** Where the end-zone lines are: the inner edge of the 17-hex rows' end-zone hexes, half a hex into the 18-hex rows' column 2. */
const END_LINE_LEFT = PAD + HEX_WIDTH * 1.5
const END_LINE_RIGHT = PAD + HEX_WIDTH * 16.5

/**
 * The hexes off the pitch that show inside its rectangle: row 0 and row 10
 * above and below, and column 0 and column 18 of the 17-hex rows. Each with
 * the zone it continues: beside an end zone (up to the end-zone line), or
 * the wide zones.
 */
export function fillHexes(): { hex: Hex; zone: FillZone }[] {
  const hexes: Hex[] = []
  for (const row of [0, PITCH_ROWS + 1]) for (let col = 0; col <= 18; col++) hexes.push(fromColRow({ col, row }))
  for (let row = 2; row < PITCH_ROWS; row += 2) hexes.push(fromColRow({ col: 0, row }), fromColRow({ col: 18, row }))
  return hexes.map((hex) => {
    const { x } = hexCenter(hex)
    return { hex, zone: x < END_LINE_LEFT || x > END_LINE_RIGHT ? 'endzone' : 'wide' }
  })
}

export type ChalkLine = { id: string; x1: number; y1: number; x2: number; y2: number }

/** The y between two rows: the middle of the zigzag of hex edges between row `above` and the next. */
function between(above: number): number {
  return PAD + HEX_SIZE + 1.5 * HEX_SIZE * (above - 1) + 0.75 * HEX_SIZE
}

/** The chalk lines inside the touchline: the halfway line, the two end-zone lines and the two wide-zone lines. */
export function chalkLines(): ChalkLine[] {
  const { x, y, width, height } = PITCH_RECT
  const top = y
  const bottom = y + height
  const halfway = PAD + HEX_WIDTH * 9
  const wideTop = between(WIDE_ZONE_ROWS)
  const wideBottom = between(PITCH_ROWS - WIDE_ZONE_ROWS)
  return [
    { id: 'halfway', x1: halfway, y1: top, x2: halfway, y2: bottom },
    { id: 'end-left', x1: END_LINE_LEFT, y1: top, x2: END_LINE_LEFT, y2: bottom },
    { id: 'end-right', x1: END_LINE_RIGHT, y1: top, x2: END_LINE_RIGHT, y2: bottom },
    { id: 'wide-top', x1: x, y1: wideTop, x2: x + width, y2: wideTop },
    { id: 'wide-bottom', x1: x, y1: wideBottom, x2: x + width, y2: wideBottom },
  ]
}
