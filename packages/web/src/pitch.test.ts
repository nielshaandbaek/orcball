import { allPitchHexes } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { grassTiles, RARE_ONE_IN, tileFor } from './pitch'

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
