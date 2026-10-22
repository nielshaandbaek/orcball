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
  isHalfwayHex,
  line,
  neighbour,
  neighbours,
  onPitch,
  opposite,
  pushHexes,
  rowLength,
  toColRow,
  wideZoneOf,
} from './hex'

// Tests are written in (col, row) so they can be checked against a drawing of
// the pitch. Odd rows have 18 hexes; even rows have 17 and sit half a hex in:
//
//   row 3  (1,3) (2,3) (3,3) … (17,3) (18,3)
//   row 4     (1,4) (2,4) (3,4) … (17,4)
//   row 5  (1,5) (2,5) (3,5) … (17,5) (18,5)
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

  it('alternates rows of 18 and 17 hexes', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(rowLength)).toEqual([18, 17, 18, 17, 18, 17, 18, 17, 18])
  })

  it('has 158 hexes on the pitch, all distinct', () => {
    const hexes = allPitchHexes()
    expect(hexes).toHaveLength(158)
    expect(new Set(hexes.map(hexKey)).size).toBe(158)
    expect(hexes.every(onPitch)).toBe(true)
  })

  it('knows what is off the pitch', () => {
    expect(onPitch(h(0, 1))).toBe(false)
    expect(onPitch(h(19, 5))).toBe(false)
    expect(onPitch(h(18, 4))).toBe(false)
    expect(onPitch(h(17, 4))).toBe(true)
    expect(onPitch(h(1, 0))).toBe(false)
    expect(onPitch(h(18, 10))).toBe(false)
  })

  it('is the same shape at both ends', () => {
    // Mirroring a hex left to right keeps its row and flips its column.
    const mirror = (x: Hex) => {
      const { col, row } = toColRow(x)
      return h(rowLength(row) + 1 - col, row)
    }
    for (const a of allPitchHexes()) {
      for (const b of neighbours(a).filter(onPitch)) {
        expect(areAdjacent(mirror(a), mirror(b))).toBe(true)
      }
    }
  })
})

describe('zones', () => {
  it('has end zones in the first and last hex of every row', () => {
    for (let row = 1; row <= 9; row++) {
      const last = rowLength(row)
      expect(endZoneOf(h(1, row))).toBe('left')
      expect(endZoneOf(h(last, row))).toBe('right')
      expect(endZoneOf(h(2, row))).toBeNull()
      expect(endZoneOf(h(last - 1, row))).toBeNull()
    }
    expect(endZoneOf(h(17, 5))).toBeNull()
    expect(endZoneOf(h(18, 4))).toBeNull()
    expect(endZoneOf(h(0, 5))).toBeNull()
  })

  it('has 4 halfway hexes, in column 9 of the short rows', () => {
    const halfway = allPitchHexes().filter(isHalfwayHex)
    expect(cr(halfway)).toEqual([
      [9, 2],
      [9, 4],
      [9, 6],
      [9, 8],
    ])
    for (const x of halfway) expect(halfOf(x)).toBeNull()
    expect(isHalfwayHex(h(9, 5))).toBe(false)
  })

  it('splits the halves at the halfway line', () => {
    expect(halfOf(h(1, 1))).toBe('left')
    expect(halfOf(h(9, 5))).toBe('left')
    expect(halfOf(h(10, 5))).toBe('right')
    expect(halfOf(h(8, 4))).toBe('left')
    expect(halfOf(h(10, 4))).toBe('right')
    expect(halfOf(h(17, 4))).toBe('right')
    expect(halfOf(h(18, 9))).toBe('right')
    expect(halfOf(h(19, 5))).toBeNull()
    // 77 hexes on each side: 5 rows of 9 plus 4 rows of 8.
    expect(allPitchHexes().filter((x) => halfOf(x) === 'left')).toHaveLength(77)
    expect(allPitchHexes().filter((x) => halfOf(x) === 'right')).toHaveLength(77)
  })

  it('has wide zones in rows 1–2 and 8–9', () => {
    expect(wideZoneOf(h(5, 1))).toBe('top')
    expect(wideZoneOf(h(5, 2))).toBe('top')
    expect(wideZoneOf(h(5, 3))).toBeNull()
    expect(wideZoneOf(h(5, 7))).toBeNull()
    expect(wideZoneOf(h(5, 8))).toBe('bottom')
    expect(wideZoneOf(h(5, 9))).toBe('bottom')
    // 18 + 17 hexes in each.
    expect(allPitchHexes().filter((x) => wideZoneOf(x) !== null)).toHaveLength(70)
  })
})

describe('neighbours', () => {
  it('finds the 6 neighbours of a hex in a long row, in D6 order', () => {
    // E, SE, SW, W, NW, NE
    expect(cr(neighbours(h(5, 5)))).toEqual([
      [6, 5],
      [5, 6],
      [4, 6],
      [4, 5],
      [4, 4],
      [5, 4],
    ])
  })

  it('finds the 6 neighbours of a hex in a short row', () => {
    expect(cr(neighbours(h(5, 4)))).toEqual([
      [6, 4],
      [6, 5],
      [5, 5],
      [4, 4],
      [5, 3],
      [6, 3],
    ])
  })

  it('gives all four corners 2 neighbours on the pitch', () => {
    const onPitchOf = (x: Hex) => cr(neighbours(x).filter(onPitch))
    expect(onPitchOf(h(1, 1))).toEqual([
      [2, 1],
      [1, 2],
    ])
    expect(onPitchOf(h(18, 1))).toEqual([
      [17, 2],
      [17, 1],
    ])
    expect(onPitchOf(h(1, 9))).toEqual([
      [2, 9],
      [1, 8],
    ])
    expect(onPitchOf(h(18, 9))).toEqual([
      [17, 9],
      [17, 8],
    ])
  })

  it('gives the ends of a short row 5 neighbours on the pitch', () => {
    expect(cr(neighbours(h(1, 2)).filter(onPitch))).toEqual([
      [2, 2],
      [2, 3],
      [1, 3],
      [1, 1],
      [2, 1],
    ])
    expect(cr(neighbours(h(17, 2)).filter(onPitch))).toEqual([
      [18, 3],
      [17, 3],
      [16, 2],
      [17, 1],
      [18, 1],
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
    expect(distance(h(1, 4), h(17, 4))).toBe(16)
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
      [1, 4],
      [2, 3],
      [2, 2],
      [3, 1],
    ])
  })

  it('breaks edge ties the same way every time', () => {
    // Straight up from (5, 5) to (5, 3) runs exactly along the edge between
    // (4, 4) and (5, 4). The nudge sends it through (5, 4), the east one.
    expect(cr(line(h(5, 5), h(5, 3)))).toEqual([
      [5, 5],
      [5, 4],
      [5, 3],
    ])
    expect(cr(line(h(5, 5), h(5, 3)))).toEqual(cr(line(h(5, 5), h(5, 3))))
  })

  it('gives the same hexes in both directions', () => {
    expect(line(h(5, 3), h(5, 5)).reverse()).toEqual(line(h(5, 5), h(5, 3)))
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
    // Attacker west of the defender: push east, south-east or north-east.
    expect(cr(pushHexes(h(5, 5), h(6, 5)))).toEqual([
      [7, 5],
      [6, 6],
      [6, 4],
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
    // Defender at the end of a long row, attacked from the west: all 3 are off.
    expect(pushHexes(h(17, 5), h(18, 5)).filter(onPitch)).toEqual([])
    // Defender in row 1, attacked from the south-east: only west is on.
    expect(cr(pushHexes(h(10, 2), h(10, 1)).filter(onPitch))).toEqual([[9, 1]])
  })

  it('refuses an attacker that is not next to the defender', () => {
    expect(() => pushHexes(h(1, 1), h(3, 1))).toThrow(/not next to/)
  })
})
