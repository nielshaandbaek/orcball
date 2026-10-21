import { describe, expect, it } from 'vitest'
import {
  allPitchHexes,
  areAdjacent,
  distance,
  endZoneOf,
  fromColRow,
  halfOf,
  type Hex,
  hexKey,
  line,
  neighbour,
  neighbours,
  onPitch,
  opposite,
  pushHexes,
  toColRow,
  wideZoneOf,
} from './hex'

// Tests are written in (col, row) so they can be checked against a drawing of
// the pitch. Odd rows are shifted half a hex towards column 18:
//
//   row 3    (1,3) (2,3) (3,3)
//   row 4 (1,4) (2,4) (3,4)
//   row 5    (1,5) (2,5) (3,5)
const h = (col: number, row: number): Hex => fromColRow({ col, row })
const cr = (hexes: Hex[]) => hexes.map((x) => toColRow(x)).map(({ col, row }) => [col, row])

describe('coordinates', () => {
  it('puts axial (0, 0) at column 1, row 1', () => {
    expect(h(1, 1)).toEqual({ q: 0, r: 0 })
  })

  it('round-trips every hex on the pitch', () => {
    for (let row = 1; row <= 9; row++) {
      for (let col = 1; col <= 18; col++) {
        expect(toColRow(fromColRow({ col, row }))).toEqual({ col, row })
      }
    }
  })

  it('has 162 hexes on the pitch, all distinct', () => {
    const hexes = allPitchHexes()
    expect(hexes).toHaveLength(162)
    expect(new Set(hexes.map(hexKey)).size).toBe(162)
    expect(hexes.every(onPitch)).toBe(true)
  })

  it('knows what is off the pitch', () => {
    expect(onPitch(h(0, 1))).toBe(false)
    expect(onPitch(h(19, 5))).toBe(false)
    expect(onPitch(h(1, 0))).toBe(false)
    expect(onPitch(h(18, 10))).toBe(false)
  })
})

describe('zones', () => {
  it('has end zones in columns 1 and 18', () => {
    for (let row = 1; row <= 9; row++) {
      expect(endZoneOf(h(1, row))).toBe('left')
      expect(endZoneOf(h(18, row))).toBe('right')
      expect(endZoneOf(h(2, row))).toBeNull()
      expect(endZoneOf(h(17, row))).toBeNull()
    }
    expect(endZoneOf(h(0, 5))).toBeNull()
  })

  it('splits the halves between columns 9 and 10', () => {
    expect(halfOf(h(1, 1))).toBe('left')
    expect(halfOf(h(9, 4))).toBe('left')
    expect(halfOf(h(9, 5))).toBe('left')
    expect(halfOf(h(10, 4))).toBe('right')
    expect(halfOf(h(10, 5))).toBe('right')
    expect(halfOf(h(18, 9))).toBe('right')
    expect(halfOf(h(19, 5))).toBeNull()
  })

  it('has wide zones in rows 1–2 and 8–9', () => {
    expect(wideZoneOf(h(5, 1))).toBe('top')
    expect(wideZoneOf(h(5, 2))).toBe('top')
    expect(wideZoneOf(h(5, 3))).toBeNull()
    expect(wideZoneOf(h(5, 7))).toBeNull()
    expect(wideZoneOf(h(5, 8))).toBe('bottom')
    expect(wideZoneOf(h(5, 9))).toBe('bottom')
    expect(allPitchHexes().filter((x) => wideZoneOf(x) !== null)).toHaveLength(72)
  })
})

describe('neighbours', () => {
  it('finds the 6 neighbours of a hex in a shifted row, in D6 order', () => {
    // E, SE, SW, W, NW, NE
    expect(cr(neighbours(h(5, 5)))).toEqual([
      [6, 5],
      [6, 6],
      [5, 6],
      [4, 5],
      [5, 4],
      [6, 4],
    ])
  })

  it('finds the 6 neighbours of a hex in an unshifted row', () => {
    expect(cr(neighbours(h(5, 4)))).toEqual([
      [6, 4],
      [5, 5],
      [4, 5],
      [4, 4],
      [4, 3],
      [5, 3],
    ])
  })

  it('handles the corners', () => {
    const onPitchOf = (x: Hex) => cr(neighbours(x).filter(onPitch))
    expect(onPitchOf(h(1, 1))).toEqual([
      [2, 1],
      [2, 2],
      [1, 2],
    ])
    expect(onPitchOf(h(18, 1))).toEqual([
      [18, 2],
      [17, 1],
    ])
    expect(onPitchOf(h(1, 9))).toEqual([
      [2, 9],
      [1, 8],
      [2, 8],
    ])
    expect(onPitchOf(h(18, 9))).toEqual([
      [17, 9],
      [18, 8],
    ])
  })

  it('handles the left edge of an unshifted row', () => {
    expect(cr(neighbours(h(1, 2)).filter(onPitch))).toEqual([
      [2, 2],
      [1, 3],
      [1, 1],
    ])
  })

  it('pairs each direction with the one 3 faces away', () => {
    expect([1, 2, 3, 4, 5, 6].map((d) => opposite(d as 1))).toEqual([4, 5, 6, 1, 2, 3])
    const start = h(9, 5)
    for (const d of [1, 2, 3, 4, 5, 6] as const) {
      expect(neighbour(neighbour(start, d), opposite(d))).toEqual(start)
    }
  })

  it('treats every neighbour as adjacent', () => {
    for (const hex of allPitchHexes()) {
      for (const n of neighbours(hex)) expect(areAdjacent(hex, n)).toBe(true)
    }
  })
})

describe('distance', () => {
  it('counts hexes along a row', () => {
    expect(distance(h(1, 5), h(18, 5))).toBe(17)
    expect(distance(h(1, 4), h(18, 4))).toBe(17)
  })

  it('counts hexes across rows', () => {
    expect(distance(h(1, 1), h(1, 9))).toBe(8)
    // 4 steps NE gets to (3, 1), then 15 steps east.
    expect(distance(h(1, 5), h(18, 1))).toBe(19)
    expect(distance(h(5, 5), h(5, 5))).toBe(0)
  })

  it('is symmetric', () => {
    expect(distance(h(3, 2), h(14, 8))).toBe(distance(h(14, 8), h(3, 2)))
  })
})

describe('line', () => {
  it('runs straight along a row', () => {
    expect(cr(line(h(1, 5), h(6, 5)))).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
      [6, 5],
    ])
  })

  it('follows a hex direction exactly', () => {
    expect(cr(line(h(1, 5), h(3, 1)))).toEqual([
      [1, 5],
      [2, 4],
      [2, 3],
      [3, 2],
      [3, 1],
    ])
  })

  it('breaks edge ties the same way every time', () => {
    // Straight up from (1, 5) to (1, 3) runs exactly along the edge between
    // (1, 4) and (2, 4). The nudge sends it through (2, 4).
    expect(cr(line(h(1, 5), h(1, 3)))).toEqual([
      [1, 5],
      [2, 4],
      [1, 3],
    ])
    expect(cr(line(h(1, 5), h(1, 3)))).toEqual(cr(line(h(1, 5), h(1, 3))))
  })

  it('gives the same hexes in both directions', () => {
    expect(line(h(1, 3), h(1, 5)).reverse()).toEqual(line(h(1, 5), h(1, 3)))
  })

  it('is one hex long between a hex and itself', () => {
    expect(cr(line(h(4, 4), h(4, 4)))).toEqual([[4, 4]])
  })

  it('is a connected path of the right length for every pair of hexes', () => {
    const hexes = allPitchHexes()
    for (const a of hexes) {
      for (const b of hexes) {
        const path = line(a, b)
        expect(path).toHaveLength(distance(a, b) + 1)
        expect(path[0]).toEqual(a)
        expect(path.at(-1)).toEqual(b)
        for (let i = 1; i < path.length; i++) {
          if (!areAdjacent(path[i - 1]!, path[i]!)) {
            throw new Error(`line ${hexKey(a)} → ${hexKey(b)} jumps at step ${i}`)
          }
        }
        expect(path.reverse()).toEqual(line(b, a))
      }
    }
  })
})

describe('push hexes', () => {
  it('gives the 3 hexes on the far side of the defender', () => {
    // Attacker west of the defender: push east, north-east or south-east.
    expect(cr(pushHexes(h(5, 5), h(6, 5)))).toEqual([
      [7, 5],
      [7, 6],
      [7, 4],
    ])
  })

  it('never includes a hex next to the attacker', () => {
    const attacker = h(8, 4)
    for (const defender of neighbours(attacker)) {
      const push = pushHexes(attacker, defender)
      expect(push).toHaveLength(3)
      for (const p of push) expect(distance(p, attacker)).toBe(2)
    }
  })

  it('includes hexes off the pitch for crowd pushes', () => {
    // Defender on the right touchline in a shifted row: all 3 are off.
    expect(pushHexes(h(17, 5), h(18, 5)).filter(onPitch)).toEqual([])
    // Defender in row 1, attacked from the south-east: only west is on.
    expect(cr(pushHexes(h(11, 2), h(10, 1)).filter(onPitch))).toEqual([[9, 1]])
  })

  it('refuses an attacker that is not next to the defender', () => {
    expect(() => pushHexes(h(1, 1), h(3, 1))).toThrow(/not next to/)
  })
})
