import { allPitchHexes, endZoneOf, fromColRow, hexKey, onPitch, toColRow } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { HEX_SIZE, HEX_WIDTH, hexCenter } from './geometry'
import { chalkLines, fillHexes, grassTiles, PITCH_RECT, RARE_ONE_IN, tileFor } from './pitch'

const files = {
  '../../../../art/pitch/grass-blades-02.png': 'b',
  '../../../../art/pitch/grass-blades-01.png': 'a',
  '../../../../art/pitch/grass-blades-03.png': 'c',
  '../../../../art/pitch/grass-blades-04.png': 'd',
  '../../../../art/pitch/grass-blades-05-rare.png': 'dirt',
}
const tiles = grassTiles(files)
const pitch = allPitchHexes()

describe('grass on the pitch (#163)', () => {
  it('reads the tiles by name, the dirt one marked rare', () => {
    expect(tiles.map((t) => [t.id, t.rare])).toEqual([
      ['grass-grass-blades-01', false],
      ['grass-grass-blades-02', false],
      ['grass-grass-blades-03', false],
      ['grass-grass-blades-04', false],
      ['grass-grass-blades-05-rare', true],
    ])
  })

  it('picks the same tile for a hex every time', () => {
    expect(pitch.map((h) => tileFor(tiles, h)?.id)).toEqual(pitch.map((h) => tileFor(tiles, h)?.id))
  })

  it('uses every plain tile, and the rare one about 1 hex in 12', () => {
    const counts = new Map<string, number>()
    for (const h of pitch) counts.set(tileFor(tiles, h)!.href, (counts.get(tileFor(tiles, h)!.href) ?? 0) + 1)
    for (const href of ['a', 'b', 'c', 'd']) expect(counts.get(href), href).toBeGreaterThan(pitch.length / 8)
    const rare = counts.get('dirt') ?? 0
    expect(rare).toBeGreaterThan(pitch.length / RARE_ONE_IN / 3)
    expect(rare).toBeLessThan((pitch.length / RARE_ONE_IN) * 2)
  })

  it('has no tile without tiles', () => {
    expect(tileFor([], pitch[0]!)).toBeNull()
  })
})

describe('the pitch\'s frame and lines (#245)', () => {
  const corners = (hex: ReturnType<typeof fromColRow>) => {
    const { x, y } = hexCenter(hex)
    return Array.from({ length: 6 }, (_, i) => ({ x: x + HEX_SIZE * Math.cos((Math.PI / 180) * (60 * i - 90)), y: y + HEX_SIZE * Math.sin((Math.PI / 180) * (60 * i - 90)) }))
  }
  const { x, y, width, height } = PITCH_RECT

  it('is a rectangle tight to the 18-hex rows\' outer edges and the outer points of rows 1 and 9', () => {
    const all = pitch.flatMap(corners)
    expect(Math.min(...all.map((c) => c.x))).toBeCloseTo(x)
    expect(Math.max(...all.map((c) => c.x))).toBeCloseTo(x + width)
    expect(Math.min(...all.map((c) => c.y))).toBeCloseTo(y)
    expect(Math.max(...all.map((c) => c.y))).toBeCloseTo(y + height)
  })

  it('fills the gaps along the edge with hexes off the pitch, each continuing its zone', () => {
    const fills = fillHexes()
    expect(fills.every((f) => !onPitch(f.hex))).toBe(true)
    expect(new Set(fills.map((f) => hexKey(f.hex))).size).toBe(fills.length)
    // Rows 0 and 10 whole (19 each), and both ends of the four 17-hex rows.
    expect(fills).toHaveLength(19 * 2 + 4 * 2)
    // Every point just inside the rectangle's edge is in a pitch hex or a fill hex.
    const hexes = [...pitch, ...fills.map((f) => f.hex)]
    const inside = (px: number, py: number) => hexes.some((hex) => {
      const c = hexCenter(hex)
      const dx = Math.abs(px - c.x)
      const dy = Math.abs(py - c.y)
      return dx <= HEX_WIDTH / 2 + 1e-6 && dy <= HEX_SIZE - (dx / (HEX_WIDTH / 2)) * (HEX_SIZE / 2) + 1e-6
    })
    for (let i = 0; i <= 200; i++) {
      const t = i / 200
      for (const [px, py] of [[x + 0.5 + t * (width - 1), y + 0.5], [x + 0.5 + t * (width - 1), y + height - 0.5], [x + 0.5, y + 0.5 + t * (height - 1)], [x + width - 0.5, y + 0.5 + t * (height - 1)]] as const) {
        expect(inside(px, py), `${px.toFixed(1)},${py.toFixed(1)}`).toBe(true)
      }
    }
    // Beside an end zone the fill is end zone; along the sides, wide zone.
    const zone = (col: number, row: number) => fills.find((f) => hexKey(f.hex) === hexKey(fromColRow({ col, row })))!.zone
    expect(zone(0, 4)).toBe('endzone')
    expect(zone(18, 6)).toBe('endzone')
    expect(zone(1, 0)).toBe('endzone')
    expect(zone(5, 0)).toBe('wide')
    expect(zone(9, 10)).toBe('wide')
  })

  it('has fill hexes tiles can be picked for', () => {
    for (const f of fillHexes()) expect(tileFor(tiles, f.hex)).not.toBeNull()
  })

  it('draws straight lines: halfway, the two end-zone lines on the 17-hex rows\' inner end-zone edge, and the two wide-zone lines', () => {
    const lines = Object.fromEntries(chalkLines().map((l) => [l.id, l]))
    expect(Object.keys(lines).sort()).toEqual(['end-left', 'end-right', 'halfway', 'wide-bottom', 'wide-top'])
    // Halfway: between columns 9 and 10 of a long row, through the centre of a short row's column 9.
    expect(lines.halfway!.x1).toBeCloseTo((hexCenter(fromColRow({ col: 9, row: 1 })).x + hexCenter(fromColRow({ col: 10, row: 1 })).x) / 2)
    expect(lines.halfway!.x1).toBeCloseTo(hexCenter(fromColRow({ col: 9, row: 2 })).x)
    // End zones: the right edge of a short row's column 1, every end-zone hex behind it.
    expect(lines['end-left']!.x1).toBeCloseTo(hexCenter(fromColRow({ col: 1, row: 2 })).x + HEX_WIDTH / 2)
    expect(lines['end-right']!.x1).toBeCloseTo(hexCenter(fromColRow({ col: 17, row: 2 })).x - HEX_WIDTH / 2)
    for (const hex of pitch.filter((h) => endZoneOf(h))) {
      const cx = hexCenter(hex).x
      if (endZoneOf(hex) === 'left') expect(cx + HEX_WIDTH / 2).toBeLessThanOrEqual(lines['end-left']!.x1 + 1e-6)
      else expect(cx - HEX_WIDTH / 2).toBeGreaterThanOrEqual(lines['end-right']!.x1 - 1e-6)
    }
    // Wide zones: halfway between rows 2 and 3 (and 7 and 8), across the whole pitch.
    const mid = (a: number, b: number) => (hexCenter(fromColRow({ col: 3, row: a })).y + hexCenter(fromColRow({ col: 3, row: b })).y) / 2
    expect(lines['wide-top']!.y1).toBeCloseTo(mid(2, 3))
    expect(lines['wide-bottom']!.y1).toBeCloseTo(mid(7, 8))
    expect(lines['wide-top']!.x2 - lines['wide-top']!.x1).toBeCloseTo(width)
    expect(toColRow(fromColRow({ col: 0, row: 0 }))).toEqual({ col: 0, row: 0 })
  })
})
