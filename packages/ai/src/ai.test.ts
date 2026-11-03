import { apply, type Command, createMatch, fromColRow, type GameState, rulesV12, seededRng } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { actingTeam, chooseCommand, faceFor, simulate, simulateOutcome, viewOf } from '.'

const { orcs, elves } = rulesV12.rosters as Record<'orcs' | 'elves', (typeof rulesV12.rosters)[string]>
const h = (col: number, row: number) => fromColRow({ col, row })

const BLITZER = 'home-blitzer-1' // AG 6+
const ELF = 'away-lineman-1'

/** Round 1, home to go, with only these players on the pitch. */
function scene(placements: Record<string, { col: number; row: number }>): GameState {
  const state = createMatch(rulesV12, [orcs, elves], 1)
  for (const [id, { col, row }] of Object.entries(placements)) state.players[id]!.hex = h(col, row)
  Object.assign(state, { pending: null, phase: 'Round', round: 1, kickingTeam: 'away', openingKicker: 'away', firstGo: 'home', turnOwner: 'home' })
  return state
}

describe('AiView', () => {
  it('has no RNG', () => {
    const view = viewOf(createMatch(rulesV12, [orcs, elves], 1))
    expect('rng' in view).toBe(false)
    expect(JSON.stringify(view)).not.toMatch(/"seeded"/)
  })
})

describe('chooseCommand', () => {
  const view = viewOf(createMatch(rulesV12, [orcs, elves], 1))
  const options = { level: 'novice' as const, budgetMs: 100, seed: 42 }

  it('gives the same command for the same view, level and seed', () => {
    const me = actingTeam(view)
    expect(chooseCommand(view, me, options)).toEqual(chooseCommand(view, me, options))
  })

  it("refuses to move for the team that isn't acting", () => {
    const other = actingTeam(view) === 'home' ? 'away' : 'home'
    expect(() => chooseCommand(view, other, options)).toThrow(/not away's|not home's/)
  })

  it('plays both sides of a whole match with legal commands', { timeout: 180_000 }, () => {
    let state = createMatch(rulesV12, [orcs, elves], 7)
    let commands = 0
    while (state.phase !== 'FullTime') {
      const view = viewOf(state)
      const { command } = chooseCommand(view, actingTeam(view), { ...options, seed: commands })
      state = apply(state, command).state
      expect(++commands).toBeLessThan(20_000)
    }
    expect(state.winner).not.toBeNull()
  })
})

describe('simulating outcomes', () => {
  // The Blitzer starts next to the Elf at (7,5) and dodges away to (5,5).
  const marked = viewOf(apply(scene({ [BLITZER]: { col: 6, row: 5 }, [ELF]: { col: 7, row: 5 } }), { type: 'activate', playerId: BLITZER, action: 'move' }).state)
  const dodge: Command = { type: 'move', to: h(5, 5), dodge: true }

  it('applies a Dodge with a forced success', () => {
    const after = simulateOutcome(marked, dodge, 'success', 1)!
    expect(after.view.players[BLITZER]).toMatchObject({ hex: h(5, 5), status: 'standing' })
  })

  it('applies a Dodge with a forced failure, and rolls what follows from its own dice', () => {
    const failed = simulateOutcome(marked, dodge, 'failure', 1)!
    expect(failed.events).toContainEqual(expect.objectContaining({ type: 'rolled', test: 'Dodge', natural: 4, success: false }))
    // He has Momentum, so he's offered a re-roll first; turning it down, he falls and the armour dice are the computer's.
    expect(failed.view.pending?.kind).toBe('movement.dodge')
    const fallen = simulate(failed.view, { type: 'decide', choice: 'accept' }, { seed: 1 })
    expect(fallen.view.players[BLITZER]!.status).not.toBe('standing')
    expect('rng' in fallen.view).toBe(false)
  })

  it('picks faces: a failure other than a natural 1 when there is one', () => {
    const preview = { test: 'Dodge', target: 6, modifiers: [{ name: 'Dodge bonus', value: 1 }], chance: 0.6 }
    expect(faceFor(preview, 'success')).toBe(5)
    expect(faceFor(preview, 'failure')).toBe(4)
    expect(faceFor(preview, 'natural1')).toBe(1)
    expect(faceFor({ ...preview, target: 2 }, 'failure')).toBeNull()
  })

  it('takes given faces in order', () => {
    const a = simulate(marked, dodge, { faces: [10], seed: 1 })
    const b = simulate(marked, dodge, { faces: [10], seed: 2 })
    expect(a.view.players[BLITZER]!.hex).toEqual(b.view.players[BLITZER]!.hex)
    expect(seededRng(1)).not.toEqual(seededRng(2))
  })
})
