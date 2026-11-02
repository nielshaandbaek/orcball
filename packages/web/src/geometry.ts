import { type Hex, PITCH_ROWS, toColRow } from '@orcball/engine'

// Pixel layout of the pitch for the SVG board. Pointy-top hexes; even rows
// have 17 hexes and sit half a hex in, as in the engine.

export const HEX_SIZE = 30
export const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE
const PAD = 12

export const BOARD_WIDTH = HEX_WIDTH * 18 + PAD * 2
export const BOARD_HEIGHT = 1.5 * HEX_SIZE * (PITCH_ROWS - 1) + 2 * HEX_SIZE + PAD * 2

export function hexCenter(hex: Hex): { x: number; y: number } {
  const { col, row } = toColRow(hex)
  const shift = row % 2 === 0 ? 0.5 : 0
  return {
    x: PAD + HEX_WIDTH / 2 + HEX_WIDTH * (col - 1 + shift),
    y: PAD + HEX_SIZE + 1.5 * HEX_SIZE * (row - 1),
  }
}

/**
 * Where a token is drawn: its hex's centre, kept on the board. A player
 * pushed into the crowd waits on a hex just off the pitch until his injury
 * roll; clamped to the board's edge, about half his token shows.
 */
export function tokenCenter(hex: Hex): { x: number; y: number } {
  const { x, y } = hexCenter(hex)
  return { x: Math.min(Math.max(x, 0), BOARD_WIDTH), y: Math.min(Math.max(y, 0), BOARD_HEIGHT) }
}

export function hexPoints(hex: Hex, inset = 0.5): string {
  const { x, y } = hexCenter(hex)
  const r = HEX_SIZE - inset
  const points: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90)
    points.push(`${(x + r * Math.cos(angle)).toFixed(1)},${(y + r * Math.sin(angle)).toFixed(1)}`)
  }
  return points.join(' ')
}
