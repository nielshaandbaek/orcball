// Hex grid for the OrcBall pitch.
//
// Pointy-top hexes in 9 rows. Rows run from one end zone to the other, so a
// player can run in a straight line along a row. Odd rows (1, 3, 5, 7, 9) have
// 18 hexes; even rows have 17 and sit half a hex in from each end, so both
// ends of the pitch have the same shape. The halfway line runs between columns
// 9 and 10 of the long rows and through column 9 of the short ones.
//
// The engine works in axial coordinates (q, r). Columns and rows (1-based) are
// for display and setup rules only. Axial (0, 0) is column 1, row 1.

export type Hex = { q: number; r: number }
export type ColRow = { col: number; row: number }

export const PITCH_ROWS = 9
export const LONG_ROW_LENGTH = 18
export const SHORT_ROW_LENGTH = 17

/** Column 9 of a short row sits on the halfway line; column 10 starts the right half in every row. */
export const HALFWAY_COL = 9

/** Rows 1–2 and 8–9 are the wide zones. */
export const WIDE_ZONE_ROWS = 2

/**
 * D6 face → axial direction. Clockwise from east (towards column 18), where
 * south means towards row 9. Opposite directions are 3 apart.
 */
export const DIRECTIONS = {
  1: { q: 1, r: 0 }, // E
  2: { q: 0, r: 1 }, // SE
  3: { q: -1, r: 1 }, // SW
  4: { q: -1, r: 0 }, // W
  5: { q: 0, r: -1 }, // NW
  6: { q: 1, r: -1 }, // NE
} as const satisfies Record<number, Hex>

export type Direction = keyof typeof DIRECTIONS

const DIRECTION_ORDER: readonly Direction[] = [1, 2, 3, 4, 5, 6]

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r
}

/** Stable string key, for use in maps and sets. */
export function hexKey(hex: Hex): string {
  return `${hex.q},${hex.r}`
}

export function toColRow(hex: Hex): ColRow {
  const row0 = hex.r
  // Odd 0-based rows (even 1-based rows) are the shifted ones.
  const col0 = hex.q + (row0 - (row0 & 1)) / 2
  return { col: col0 + 1, row: row0 + 1 }
}

export function fromColRow({ col, row }: ColRow): Hex {
  const row0 = row - 1
  const col0 = col - 1
  return { q: col0 - (row0 - (row0 & 1)) / 2, r: row0 }
}

/** Number of hexes in a row: 18 in odd rows, 17 in even rows. */
export function rowLength(row: number): number {
  return row % 2 === 1 ? LONG_ROW_LENGTH : SHORT_ROW_LENGTH
}

export function onPitch(hex: Hex): boolean {
  const { col, row } = toColRow(hex)
  return row >= 1 && row <= PITCH_ROWS && col >= 1 && col <= rowLength(row)
}

/** Every hex on the pitch, row by row from column 1. */
export function allPitchHexes(): Hex[] {
  const hexes: Hex[] = []
  for (let row = 1; row <= PITCH_ROWS; row++) {
    for (let col = 1; col <= rowLength(row); col++) hexes.push(fromColRow({ col, row }))
  }
  return hexes
}

export type Side = 'left' | 'right'

/** The end zone a hex is in: the first hex of each row is the left one, the last the right. */
export function endZoneOf(hex: Hex): Side | null {
  if (!onPitch(hex)) return null
  const { col, row } = toColRow(hex)
  if (col === 1) return 'left'
  if (col === rowLength(row)) return 'right'
  return null
}

/** Column 9 of rows 2, 4, 6 and 8: on the halfway line, in neither half. */
export function isHalfwayHex(hex: Hex): boolean {
  if (!onPitch(hex)) return false
  const { col, row } = toColRow(hex)
  return rowLength(row) === SHORT_ROW_LENGTH && col === HALFWAY_COL
}

/** The half a hex is in, or null for halfway hexes and hexes off the pitch. */
export function halfOf(hex: Hex): Side | null {
  if (!onPitch(hex) || isHalfwayHex(hex)) return null
  return toColRow(hex).col <= HALFWAY_COL ? 'left' : 'right'
}

export type WideZone = 'top' | 'bottom'

/** Wide zones: rows 1–2 are the top one, rows 8–9 the bottom one. */
export function wideZoneOf(hex: Hex): WideZone | null {
  if (!onPitch(hex)) return null
  const { row } = toColRow(hex)
  if (row <= WIDE_ZONE_ROWS) return 'top'
  if (row > PITCH_ROWS - WIDE_ZONE_ROWS) return 'bottom'
  return null
}

export function neighbour(hex: Hex, direction: Direction): Hex {
  const d = DIRECTIONS[direction]
  return { q: hex.q + d.q, r: hex.r + d.r }
}

/** All 6 neighbours in direction order 1–6, including any off the pitch. */
export function neighbours(hex: Hex): Hex[] {
  return DIRECTION_ORDER.map((d) => neighbour(hex, d))
}

export function opposite(direction: Direction): Direction {
  return (((direction + 2) % 6) + 1) as Direction
}

export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

export function areAdjacent(a: Hex, b: Hex): boolean {
  return distance(a, b) === 1
}

// Applied to both ends of a line so that points exactly on a hex edge always
// round the same way. The three parts sum to zero to stay on the cube plane,
// and they differ so no two cube axes tie during rounding.
const LINE_NUDGE = { q: 1e-6, r: 2e-6 }

/**
 * The hexes a straight line between two hex centres passes through, from `a`
 * to `b` inclusive. Used for pass interceptions.
 *
 * When the line runs exactly along an edge between two hexes, a fixed nudge
 * decides which one it passes through, so the same pair of hexes always gives
 * the same line.
 */
export function line(a: Hex, b: Hex): Hex[] {
  const n = distance(a, b)
  if (n === 0) return [{ ...a }]
  const aq = a.q + LINE_NUDGE.q
  const ar = a.r + LINE_NUDGE.r
  const bq = b.q + LINE_NUDGE.q
  const br = b.r + LINE_NUDGE.r
  const hexes: Hex[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    hexes.push(roundHex(aq + (bq - aq) * t, ar + (br - ar) * t))
  }
  return hexes
}

function roundHex(q: number, r: number): Hex {
  const s = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  const rs = Math.round(s)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const ds = Math.abs(rs - s)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  // Avoid -0 so results compare cleanly with toEqual.
  return { q: rq + 0, r: rr + 0 }
}

/**
 * The 3 hexes a defender can be pushed into: its neighbours that are not
 * adjacent to the attacker. Hexes off the pitch are included, since a push
 * there is a crowd push.
 */
export function pushHexes(attacker: Hex, defender: Hex): Hex[] {
  if (!areAdjacent(attacker, defender)) {
    throw new Error(`pushHexes: attacker ${hexKey(attacker)} is not next to defender ${hexKey(defender)}`)
  }
  return neighbours(defender).filter((n) => distance(n, attacker) === 2)
}
