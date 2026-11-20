import { describe, expect, it } from 'vitest'
import { createMatch, engine, fromColRow, type GameState, rulesV10 } from '@orcball/engine'
import { moverOf, shownRoute, spriteTransform } from './Board'

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
  const view = { preview: h(8, 5), route: null, walking: false, confirming: false, aiming: false, computerActing: false, stepping: true }

  it('shows the way to the previewed hex for the coach’s own player', () => {
    expect(shownRoute(moving(), view)?.hexes.at(-1)).toEqual(h(8, 5))
  })

  it('shows nothing until the action lets him move, such as on a Block', () => {
    expect(shownRoute(moving(), { ...view, stepping: false })).toBeNull()
  })

  it('shows nothing for a player the computer is moving, even with the mouse over a hex he can reach', () => {
    expect(shownRoute(moving(), { ...view, computerActing: true })).toBeNull()
  })
})

describe('moverOf', () => {
  const { orcs, elves } = rulesV10.rosters as Record<'orcs' | 'elves', (typeof rulesV10.rosters)[string]>
  const h = (col: number, row: number) => fromColRow({ col, row })

  /** Round 1, the Orcs' go: an Orc Blitzer at (5,5) and an Elf Catcher at (12,5). */
  function round(): GameState {
    const state = createMatch(rulesV10, [orcs, elves], 1)
    state.players['home-blitzer-1']!.hex = h(5, 5)
    state.players['away-catcher-1']!.hex = h(12, 5)
    return { ...state, phase: 'Round' as const, round: 1, turnOwner: 'home' as const, pending: null, ball: { hex: h(2, 2), carrier: null } }
  }

  it('shows how far a selected player of the team whose go it is can move, until he has activated', () => {
    const state = round()
    expect(moverOf(state, 'home-blitzer-1')).toBe('home-blitzer-1')
    state.players['home-blitzer-1']!.activatedThisRound = true
    expect(moverOf(state, 'home-blitzer-1')).toBeNull()
  })

  it('shows how far a selected opponent can move, activated this round or not', () => {
    const state = round()
    expect(moverOf(state, 'away-catcher-1')).toBe('away-catcher-1')
    state.players['away-catcher-1']!.activatedThisRound = true
    expect(moverOf(state, 'away-catcher-1')).toBe('away-catcher-1')
  })

  it('shows only the active player during an activation, and nobody while a decision is pending', () => {
    const active = engine.apply(round(), { type: 'activate', playerId: 'home-blitzer-1', action: 'move' }).state
    expect(moverOf(active, 'away-catcher-1')).toBe('home-blitzer-1')
    expect(moverOf({ ...round(), pending: { kind: 'x', team: 'home', prompt: '', choices: [], data: null } }, 'away-catcher-1')).toBeNull()
  })
})
