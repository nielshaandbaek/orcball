import {
  apply,
  allPitchHexes,
  createMatch,
  distance,
  fromColRow,
  type GameState,
  type Hex,
  legalCommands,
  otherTeam,
  rowLength,
  rulesV12,
  toColRow,
} from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { type AiView, viewOf } from '.'
import { defaultWeights, evaluate, FEATURES, featureDifferences, loadWeights, plainMoveKey, type Weights, WeightsError } from './evaluate'
import { randomPositions } from './test-helpers'

const { orcs, elves } = rulesV12.rosters as Record<'orcs' | 'elves', (typeof rulesV12.rosters)[string]>
const h = (col: number, row: number) => fromColRow({ col, row })

const BLITZER = 'home-blitzer-1'
const ORC = 'home-lineman-1'
const ELF = 'away-lineman-1'
const ELF2 = 'away-lineman-2'

/** Round 1, home to go, with only these players on the pitch. */
function scene(placements: Record<string, { col: number; row: number }>, carrier: string | null = null): AiView {
  const state = createMatch(rulesV12, [orcs, elves], 1)
  for (const [id, { col, row }] of Object.entries(placements)) state.players[id]!.hex = h(col, row)
  Object.assign(state, { pending: null, phase: 'Round', round: 1, kickingTeam: 'away', openingKicker: 'away', firstGo: 'home', turnOwner: 'home' })
  const carried = carrier ? state.players[carrier]!.hex : null
  state.ball = carrier ? { hex: carried, carrier } : { hex: h(9, 5), carrier: null }
  return viewOf(state)
}

const score = (view: AiView) => evaluate(view, 'home').total

describe('evaluate', () => {
  it('scores carrying the ball above not carrying it', () => {
    const at = { [BLITZER]: { col: 9, row: 5 }, [ELF]: { col: 14, row: 3 } }
    expect(score(scene(at, BLITZER))).toBeGreaterThan(score(scene(at, null)))
    expect(score(scene(at, ELF))).toBeLessThan(score(scene(at, null)))
  })

  it('scores a carrier one hex from scoring above one ten hexes away', () => {
    // Home scores in the right end zone, column 18 of a long row.
    const near = scene({ [BLITZER]: { col: 17, row: 5 }, [ELF]: { col: 3, row: 3 } }, BLITZER)
    const far = scene({ [BLITZER]: { col: 8, row: 5 }, [ELF]: { col: 3, row: 3 } }, BLITZER)
    expect(score(near)).toBeGreaterThan(score(far))
  })

  it('scores a marked carrier below an unmarked one', () => {
    const marked = scene({ [BLITZER]: { col: 9, row: 5 }, [ELF]: { col: 10, row: 5 } }, BLITZER)
    const unmarked = scene({ [BLITZER]: { col: 9, row: 5 }, [ELF]: { col: 16, row: 9 } }, BLITZER)
    expect(evaluate(marked, 'home').contributions.carrierMarked).toBeLessThan(0)
    expect(score(marked)).toBeLessThan(score(unmarked))
  })

  it('scores a knocked-down opponent above a standing one', () => {
    const at = { [BLITZER]: { col: 9, row: 5 }, [ELF]: { col: 12, row: 5 } }
    const standing = scene(at)
    const down = scene(at)
    down.players[ELF]!.status = 'prone'
    expect(score(down)).toBeGreaterThan(score(standing))
  })

  it('scores team-mates around the carrier above a lone carrier', () => {
    const lone = scene({ [BLITZER]: { col: 9, row: 5 }, [ORC]: { col: 3, row: 1 }, [ELF]: { col: 14, row: 5 } }, BLITZER)
    const caged = scene({ [BLITZER]: { col: 9, row: 5 }, [ORC]: { col: 10, row: 5 }, [ELF]: { col: 14, row: 5 } }, BLITZER)
    expect(score(caged)).toBeGreaterThan(score(lone))
  })

  it('scores a touchdown above a carrier one step from the end zone', () => {
    // Scoring loses the ball and the carrier's progress, so the touchdown has to be worth more than both.
    const before = scene({ [BLITZER]: { col: 17, row: 5 }, [ELF]: { col: 3, row: 3 } }, BLITZER)
    const after = scene({ [ELF]: { col: 3, row: 3 } })
    after.teams.home.score = 1
    after.ball = { hex: null, carrier: null }
    expect(score(after)).toBeGreaterThan(score(before))
  })

  it('adds up its contributions, and a level position scores 0', () => {
    const view = scene({ [BLITZER]: { col: 9, row: 5 }, [ELF]: { col: 12, row: 5 }, [ELF2]: { col: 12, row: 7 } }, BLITZER)
    const { total, contributions } = evaluate(view, 'home')
    expect(Object.keys(contributions)).toEqual([...FEATURES])
    expect(total).toBeCloseTo(Object.values(contributions).reduce((a, b) => a + b, 0))
    expect(evaluate(viewOf(createMatch(rulesV12, [orcs, orcs], 1)), 'home').total).toBe(0)
  })
})

// The attacking features (#86), each for the home carrier at (9,5); home scores at the right end.
describe('attacking features', () => {
  const features = (view: AiView) => featureDifferences(view, 'home')
  const carrier = { [BLITZER]: { col: 9, row: 5 } }

  it('counts opponents in the carrier’s lane: ahead of him and within 4 hexes', () => {
    expect(features(scene({ ...carrier, [ELF]: { col: 12, row: 5 } }, BLITZER)).carrierLane).toBe(1)
    expect(features(scene({ ...carrier, [ELF]: { col: 6, row: 5 } }, BLITZER)).carrierLane).toBe(0) // behind him
    expect(features(scene({ ...carrier, [ELF]: { col: 15, row: 5 } }, BLITZER)).carrierLane).toBe(0) // 6 hexes ahead
    const down = scene({ ...carrier, [ELF]: { col: 12, row: 5 } }, BLITZER)
    down.players[ELF]!.status = 'prone' // no tackle zone
    expect(features(down).carrierLane).toBe(0)
  })

  it('counts team-mates in the way of an opponent who can still reach the carrier', () => {
    const threat = { ...carrier, [ELF]: { col: 14, row: 5 } }
    expect(features(scene({ ...threat, [ORC]: { col: 11, row: 5 } }, BLITZER)).carrierScreen).toBe(1)
    expect(features(scene({ ...threat, [ORC]: { col: 7, row: 5 } }, BLITZER)).carrierScreen).toBe(0) // behind the carrier
    const spent = scene({ ...threat, [ORC]: { col: 11, row: 5 } }, BLITZER)
    spent.players[ELF]!.activatedThisRound = true // no longer a threat
    expect(features(spent).carrierScreen).toBe(0)
  })

  it('counts free team-mates a quick pass away in the opponent’s half', () => {
    expect(features(scene({ ...carrier, [ORC]: { col: 11, row: 5 }, [ELF]: { col: 16, row: 9 } }, BLITZER)).receivers).toBe(1)
    expect(features(scene({ ...carrier, [ORC]: { col: 11, row: 5 }, [ELF]: { col: 12, row: 5 } }, BLITZER)).receivers).toBe(0) // marked
    expect(features(scene({ ...carrier, [ORC]: { col: 7, row: 5 }, [ELF]: { col: 16, row: 9 } }, BLITZER)).receivers).toBe(0) // own half
    expect(features(scene({ ...carrier, [ORC]: { col: 14, row: 5 }, [ELF]: { col: 16, row: 9 } }, BLITZER)).receivers).toBe(0) // too far
  })

  it('counts the same for the opposing carrier, against the team', () => {
    // The Elf carrier at (9,5) scores at the left end: an Orc at (6,5) is in his lane.
    const view = scene({ [ELF]: { col: 9, row: 5 }, [ORC]: { col: 6, row: 5 } }, ELF)
    expect(features(view).carrierLane).toBe(-1)
  })
})

/** Weights with every feature counting, each differently, so no two features can cancel by chance. */
const allCount: Weights = { ...defaultWeights, ...Object.fromEntries(FEATURES.map((f, i) => [f, 1 + i * 0.37])) }

describe('plainMoveKey', () => {
  it('gives two moves the same key only when they score the same', () => {
    const carried = scene(
      {
        [BLITZER]: { col: 9, row: 5 },
        [ORC]: { col: 8, row: 3 },
        'home-lineman-2': { col: 7, row: 7 },
        [ELF]: { col: 13, row: 5 },
        [ELF2]: { col: 12, row: 7 },
        'away-catcher-1': { col: 15, row: 3 },
      },
      BLITZER,
    )
    const elfCarries = scene({ [BLITZER]: { col: 8, row: 5 }, [ORC]: { col: 6, row: 4 }, [ELF]: { col: 10, row: 5 }, [ELF2]: { col: 13, row: 4 } }, ELF)
    const views = [carried, elfCarries, ...[1, 2].flatMap((seed) => randomPositions(seed, 60)).filter((v) => v.phase === 'Round')]
    let compared = 0
    for (const view of views) {
      for (const mover of Object.values(view.players)) {
        if (!mover.hex || mover.id === view.ball.carrier) continue
        const byKey = new Map<string, number>()
        for (const to of allPitchHexes()) {
          if (distance(to, mover.hex) > 3 || Object.values(view.players).some((p) => p.hex && p.hex.q === to.q && p.hex.r === to.r)) continue
          const key = plainMoveKey(view, mover.id, to, false)
          if (key === null) continue
          const moved: AiView = { ...view, players: { ...view.players, [mover.id]: { ...mover, hex: to, activatedThisRound: true } } }
          const value = evaluate(moved, 'home', allCount).total
          const seen = byKey.get(key)
          if (seen === undefined) byKey.set(key, value)
          else {
            expect(value).toBeCloseTo(seen, 9)
            compared++
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(100)
  })
})

/** Hexes as seen from the other end: column c of a row becomes column (length + 1 − c). */
function mirrorHex(hex: Hex): Hex {
  const { col, row } = toColRow(hex)
  return fromColRow({ col: rowLength(row) + 1 - col, row })
}

/** The same position with the teams' roles swapped: home's players become away's at the other end. */
function mirror(view: AiView): AiView {
  const players = Object.fromEntries(
    Object.values(view.players).map((p) => [p.id, { ...p, team: otherTeam(p.team), hex: p.hex && mirrorHex(p.hex) }]),
  )
  return {
    ...view,
    players,
    teams: { home: view.teams.away, away: view.teams.home },
    turnOwner: otherTeam(view.turnOwner),
    ball: { ...view.ball, hex: view.ball.hex && mirrorHex(view.ball.hex) },
    doubleActivation: view.doubleActivation && { ...view.doubleActivation, team: otherTeam(view.doubleActivation.team) },
  }
}

/** Every `every`-th position of a match of seeded random legal commands: varied, quick, and the same on any machine. */
describe('evaluation symmetry', () => {
  it('mirrors hexes without changing distances', () => {
    const hexes = allPitchHexes()
    for (const a of hexes.slice(0, 40)) {
      for (const b of hexes) expect(distance(mirrorHex(a), mirrorHex(b))).toBe(distance(a, b))
    }
  })

  const positions = [1, 2, 3].flatMap((seed) => randomPositions(seed, 25))

  it('scores a position for away as minus its score for home', () => {
    expect(positions.length).toBeGreaterThan(50)
    for (const view of positions) expect(evaluate(view, 'away').total).toBeCloseTo(-evaluate(view, 'home').total, 9)
  })

  it('scores the mirrored position for away as the position for home', () => {
    for (const view of positions) {
      expect(evaluate(mirror(view), 'away').contributions).toEqual(evaluate(view, 'home').contributions)
    }
  })

  it('counts every feature, the new ones too, as minus the other team’s, and the same mirrored', () => {
    for (const view of positions) {
      const home = featureDifferences(view, 'home')
      const away = featureDifferences(view, 'away')
      for (const f of FEATURES) expect(away[f] + home[f]).toBe(0)
      expect(featureDifferences(mirror(view), 'away')).toEqual(home)
    }
    // Random play carries the ball seldom, so the carrier's features are checked on purpose too.
    const carried = scene({ [BLITZER]: { col: 9, row: 5 }, [ORC]: { col: 11, row: 5 }, [ELF]: { col: 13, row: 5 }, [ELF2]: { col: 15, row: 6 } }, BLITZER)
    expect(featureDifferences(mirror(carried), 'away')).toEqual(featureDifferences(carried, 'home'))
    expect(featureDifferences(carried, 'home').carrierLane).toBe(1)
  })
})

describe('weights', () => {
  it('loads the default weights', () => {
    expect(defaultWeights.id).toBe('default')
  })

  it('fails loudly on a bad weights file, naming the field', () => {
    const { ball: _ball, ...missing } = defaultWeights
    expect(() => loadWeights(missing)).toThrow(WeightsError)
    expect(() => loadWeights(missing)).toThrow(/ball/)
    expect(() => loadWeights({ ...defaultWeights, score: 'ten' })).toThrow(/score/)
    expect(() => loadWeights({ ...defaultWeights, carrierSpeed: 1 })).toThrow(/carrierSpeed/)
  })
})
