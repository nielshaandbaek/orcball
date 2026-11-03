import {
  apply,
  allPitchHexes,
  createMatch,
  distance,
  fromColRow,
  type GameState,
  type Hex,
  otherTeam,
  rowLength,
  rulesV12,
  toColRow,
} from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { actingTeam, chooseCommand, type AiView, viewOf } from '.'
import { defaultWeights, evaluate, FEATURES, loadWeights, WeightsError } from './evaluate'

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

/** Every position of a random match, every `every` commands. */
function randomPositions(seed: number, every: number): AiView[] {
  let state: GameState = createMatch(rulesV12, [orcs, elves], seed)
  const views: AiView[] = []
  for (let n = 0; state.phase !== 'FullTime'; n++) {
    const view = viewOf(state)
    if (n % every === 0) views.push(view)
    state = apply(state, chooseCommand(view, actingTeam(view), { level: 'novice', budgetMs: 100, seed: n }).command).state
  }
  return views
}

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
