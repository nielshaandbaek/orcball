// Random numbers for the engine. Everything here is pure: each call takes an
// RNG state and returns the result plus the next state. States are plain data,
// so they can live in GameState and survive a JSON round trip.
//
// Two kinds of state:
// - seeded: sfc32, a small fast generator with good statistical quality.
// - forced: a queue of die faces, for rule tests that need specific rolls.
// Dice code accepts either, so a forced RNG can stand in anywhere.

export type SeededRng = { kind: 'seeded'; a: number; b: number; c: number; d: number }
export type ForcedRng = { kind: 'forced'; faces: readonly number[] }
export type RngState = SeededRng | ForcedRng

/** A seeded RNG. The seed is taken as an unsigned 32-bit integer. */
export function seededRng(seed: number): SeededRng {
  // splitmix32 spreads the seed over the four state words.
  let x = seed >>> 0
  const next = () => {
    x = (x + 0x9e3779b9) >>> 0
    let z = x
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
    return (z ^ (z >>> 16)) >>> 0
  }
  let rng: SeededRng = { kind: 'seeded', a: next(), b: next(), c: next(), d: next() }
  // Warm up so that nearby seeds don't start with related outputs.
  for (let i = 0; i < 12; i++) rng = nextUint32(rng).rng
  return rng
}

/** A test RNG that returns these die faces in order, then throws. */
export function forcedRng(faces: readonly number[]): ForcedRng {
  return { kind: 'forced', faces: [...faces] }
}

function nextUint32(rng: SeededRng): { value: number; rng: SeededRng } {
  let { a, b, c, d } = rng
  const t = (((a + b) | 0) + d) | 0
  d = (d + 1) | 0
  a = b ^ (b >>> 9)
  b = (c + (c << 3)) | 0
  c = (c << 21) | (c >>> 11)
  c = (c + t) | 0
  return { value: t >>> 0, rng: { kind: 'seeded', a, b, c, d } }
}

/** Roll one die with the given number of sides: 1 to `sides`. */
export function rollDie(rng: RngState, sides: number): { value: number; rng: RngState } {
  if (!Number.isInteger(sides) || sides < 2) throw new Error(`rollDie: invalid die D${sides}`)

  if (rng.kind === 'forced') {
    const [value, ...rest] = rng.faces
    if (value === undefined) throw new Error(`rollDie: forced RNG has no faces left for a D${sides}`)
    if (!Number.isInteger(value) || value < 1 || value > sides) {
      throw new Error(`rollDie: forced face ${value} is not a valid D${sides} result`)
    }
    return { value, rng: { kind: 'forced', faces: rest } }
  }

  // Rejection sampling keeps every face equally likely.
  const limit = Math.floor(2 ** 32 / sides) * sides
  let state = rng
  for (;;) {
    const next = nextUint32(state)
    state = next.rng
    if (next.value < limit) return { value: (next.value % sides) + 1, rng: state }
  }
}
