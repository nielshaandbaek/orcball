import { apply, type GameState, legalCommands, rulesV16, seededRng } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { actingTeam, chooseCommand, viewOf } from '.'
import { moveKey } from './deep'
import { generatePlans } from './plans'
import { Search } from './search'
import { randomPositions, scene } from './test-helpers'

const BLITZER = 'home-blitzer-1'
const ORC = 'home-lineman-1'
const ELF = 'away-lineman-1'

describe('moveKey', () => {
  // The deeper search tries one move per key below the top, so this has to hold exactly.
  it('gives the same key only to moves that score the same one go deep', { timeout: 30_000 }, () => {
    const positions = [1, 2].flatMap((seed) => randomPositions(seed, 40)).filter((v) => !v.pending && (v.phase === 'Round' || v.phase === 'Activation'))
    expect(positions.length).toBeGreaterThan(20)
    let shared = 0
    for (const view of positions) {
      const search = new Search(view.turnOwner)
      const byKey = new Map<string, number>()
      for (const plan of generatePlans(view)) {
        if (!plan.move) continue
        const key = moveKey(view, plan)
        if (key === null) continue
        const value = search.planValue(view, plan)
        const first = byKey.get(key)
        if (first === undefined) byKey.set(key, value)
        else {
          shared++
          expect(value, `${plan.label} (${key})`).toBeCloseTo(first, 9)
        }
      }
    }
    // Most moves share a key with another: that's what makes the replies affordable.
    expect(shared).toBeGreaterThan(1000)
  })
})

describe('Intermediate and Expert', () => {
  it('play legal commands for both sides', { timeout: 120_000 }, () => {
    let state: GameState = randomStart()
    for (let n = 0; n < 150 && state.phase !== 'FullTime'; n++) {
      const view = viewOf(state)
      const level = actingTeam(view) === 'home' ? 'intermediate' : 'expert'
      const { command } = chooseCommand(view, actingTeam(view), { level, budgetMs: 300, seed: n })
      expect(legalCommands(state)).toContainEqual(command)
      state = apply(state, command).state
    }
  })

  it('keep to the time budget', () => {
    const state = randomStart()
    for (const level of ['intermediate', 'expert'] as const) {
      const view = viewOf(state)
      const start = Date.now()
      chooseCommand(view, actingTeam(view), { level, budgetMs: 100, seed: 1 })
      // One candidate's score can run over a little; nothing waits for a whole search.
      expect(Date.now() - start).toBeLessThan(1_000)
    }
  })

  it('carry on with a plan that goes as expected without searching again', () => {
    // The Blitzer runs for the end zone: plain steps, no rolls.
    const state = scene({ [BLITZER]: { col: 10, row: 5 }, [ORC]: { col: 3, row: 9 }, [ELF]: { col: 2, row: 1 } }, { carrier: BLITZER })
    const options = { level: 'intermediate' as const, budgetMs: 10_000, seed: 1 }
    const first = chooseCommand(viewOf(state), 'home', options)
    let current = apply(state, first.command).state
    const second = chooseCommand(viewOf(current), 'home', options)
    expect(second.plan).toBe(first.plan)
    current = apply(current, second.command).state
    const start = Date.now()
    const third = chooseCommand(viewOf(current), 'home', options)
    expect(third.plan).toBe(first.plan)
    expect(Date.now() - start).toBeLessThan(50)
  })
})

/** A position in play: the first go of a seeded random match's second round. */
function randomStart(): GameState {
  // Play stops at the first such position, rather than playing out the whole match.
  const view = randomPositions(3, 1, (v) => v.phase === 'Round' && v.round === 2 && !v.pending && !v.activation).at(-1)
  if (!view || view.round !== 2) throw new Error('no position in round 2')
  return { ...view, rng: seededRng(1) }
}

describe('Intermediate knocks Elves down (#119)', () => {
  const CATCHER = 'away-catcher-1'
  /** Rules v16: the Orc Blitzer (ST 3, Block) next to the Elf Catcher (ST 2) with the ball, a few players round them. */
  const carrierScene = () =>
    scene(
      {
        [BLITZER]: { col: 9, row: 5 },
        [ORC]: { col: 7, row: 7 },
        'home-lineman-2': { col: 6, row: 3 },
        [CATCHER]: { col: 10, row: 5 },
        [ELF]: { col: 12, row: 7 },
        'away-wardancer-1': { col: 13, row: 3 },
      },
      { carrier: CATCHER, config: rulesV16 },
    )

  it('Tackles rather than Shoves when the Tackle is likely and the knock-down is worth more: the Elf carrier', () => {
    let state = carrierScene()
    for (const command of [
      { type: 'activate', playerId: BLITZER, action: 'block' },
      { type: 'block', targetId: CATCHER },
    ] as const)
      state = apply(state, command).state
    expect(state.pending?.kind).toBe('blocking.shoveOrTackle')
    const { command } = chooseCommand(viewOf(state), 'home', { level: 'intermediate', budgetMs: 5_000, seed: 1 })
    expect(command).toEqual({ type: 'decide', choice: 'tackle' })
  })

  it('blocks the opposing ball carrier when it can, rather than making a quiet move', { timeout: 30_000 }, () => {
    const { plan } = chooseCommand(viewOf(carrierScene()), 'home', { level: 'intermediate', budgetMs: 10_000, seed: 1 })
    expect(plan).toMatch(/(blocks|Blitzes) away-catcher-1/)
  })
})
