import { describe, expect, it } from 'vitest'
import { createMatch, engine, fromColRow, type GameState, rulesV10 } from '@orcball/engine'
import { shownRoute, spriteTransform } from './Board'

describe('spriteTransform', () => {
  it('leaves a standing home sprite as it is', () => {
    expect(spriteTransform(false, false, 50, 80)).toBe('')
  })

  it('mirrors an away sprite about its centre, and turns a down one on its side', () => {
    expect(spriteTransform(true, false, 50, 80)).toBe('translate(100 0) scale(-1 1)')
    expect(spriteTransform(false, true, 50, 80)).toBe('rotate(-90 50 80)')
    expect(spriteTransform(true, true, 50, 80)).toBe('translate(100 0) scale(-1 1) rotate(-90 50 80)')
  })
})

describe('shownRoute (#113)', () => {
  const { orcs, elves } = rulesV10.rosters as Record<'orcs' | 'elves', (typeof rulesV10.rosters)[string]>
  const h = (col: number, row: number) => fromColRow({ col, row })

  /** Round 1: an Orc Blitzer at (5,5) activated to Move. */
  function moving(): GameState {
    const state = createMatch(rulesV10, [orcs, elves], 1)
    state.players['home-blitzer-1']!.hex = h(5, 5)
    const round = { ...state, phase: 'Round' as const, round: 1, turnOwner: 'home' as const, pending: null, ball: { hex: h(2, 2), carrier: null } }
    return engine.apply(round, { type: 'activate', playerId: 'home-blitzer-1', action: 'move' }).state
  }
  const view = { preview: h(8, 5), route: null, walking: false, confirming: false, aiming: false, computerActing: false }

  it('shows the way to the previewed hex for the coach’s own player', () => {
    expect(shownRoute(moving(), view)?.hexes.at(-1)).toEqual(h(8, 5))
  })

  it('shows nothing for a player the computer is moving, even with the mouse over a hex he can reach', () => {
    expect(shownRoute(moving(), { ...view, computerActing: true })).toBeNull()
  })
})
