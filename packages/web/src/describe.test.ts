import { createMatch, fromColRow, newMatchFile, rulesV10, rulesV20 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { describeEvent } from './describe'

const { orcs, elves } = rulesV10.rosters as Record<'orcs' | 'elves', (typeof rulesV10.rosters)[string]>
const state = createMatch(rulesV10, [orcs, elves], 1)
const file = newMatchFile(rulesV10, [orcs, elves], 1)
const say = (event: Parameters<typeof describeEvent>[0]) => describeEvent(event, state, file)

describe('the log in plain words', () => {
  it('names players by team, position and number', () => {
    expect(say({ type: 'blockDeclared', attackerId: 'home-black-orc-1', defenderId: 'away-catcher-2', attack: 5, defence: 2 })).toBe(
      'Orcs Black Orc 1 blocks Elves Catcher 2: 5 against 2',
    )
  })

  it('spells out rolls with their target and modifiers', () => {
    expect(
      say({
        type: 'rolled',
        test: 'Tackle',
        target: 6,
        modifiers: [{ name: 'Strength difference', value: 1 }],
        natural: 8,
        success: true,
      }),
    ).toBe('Tackle 6+ +1: rolled 8, success')
    expect(say({ type: 'rolled', test: 'Dodge', target: 4, modifiers: [], natural: 2, success: false })).toBe('Dodge 4+: rolled 2, failed')
  })

  it('reports armour and injuries', () => {
    expect(say({ type: 'armourRolled', playerId: 'away-catcher-1', red: 7, white: 9, modifiers: [], broken: true })).toBe(
      'Armour: red 7, broken, white 9',
    )
    // Crushing Blow (v22), on the red die or the white.
    const crushing = [{ name: 'Crushing Blow', value: 1 }]
    expect(say({ type: 'armourRolled', playerId: 'away-catcher-1', red: 6, white: 3, modifiers: crushing, broken: true })).toBe(
      'Armour: red 6 +1, broken, white 3 (Crushing Blow)',
    )
    expect(say({ type: 'armourRolled', playerId: 'away-catcher-1', red: 8, white: 7, modifiers: [], broken: true, injuryModifiers: crushing })).toBe(
      'Armour: red 8, broken, white 7 +1 (Crushing Blow)',
    )
    // Stunty (#270), on its own and with Crushing Blow, and in the crowd.
    const stunty = [{ name: 'Stunty', value: 1 }]
    expect(say({ type: 'armourRolled', playerId: 'away-catcher-1', red: 8, white: 7, modifiers: [], broken: true, injuryModifiers: stunty })).toBe(
      'Armour: red 8, broken, white 7 +1 (Stunty)',
    )
    expect(say({ type: 'armourRolled', playerId: 'away-catcher-1', red: 8, white: 6, modifiers: [], broken: true, injuryModifiers: [...crushing, ...stunty] })).toBe(
      'Armour: red 8, broken, white 6 +2 (Crushing Blow, Stunty)',
    )
    expect(say({ type: 'injuryRolled', playerId: 'away-catcher-1', white: 7, modifiers: stunty })).toBe('Crowd: white 7 +1 (Stunty)')
    expect(say({ type: 'injuryRolled', playerId: 'away-catcher-1', white: 7 })).toBe('Crowd: white 7')
    expect(say({ type: 'injured', playerId: 'away-catcher-1', result: 'out' })).toBe('Elves Catcher 1 is Out for the drive')
    // Frenzy's second block (v26, #213).
    expect(say({ type: 'frenzy', playerId: 'away-catcher-1', defenderId: 'home-blitzer-1' })).toBe('Frenzy: Elves Catcher 1 blocks Orcs Blitzer 1 again')
    // Strip Ball (#198).
    expect(say({ type: 'ballStripped', playerId: 'away-catcher-1', attackerId: 'home-blitzer-1' })).toBe('Strip Ball: Elves Catcher 1 drops the ball')
    // Dump-Off (#225).
    expect(say({ type: 'dumpedOff', playerId: 'away-catcher-1', toId: 'away-lineman-1' })).toBe('Dump-Off: Elves Catcher 1 makes a quick pass to Elves Lineman 1')
    // Thick Skull (v26, #212) says when it saved him.
    expect(say({ type: 'injured', playerId: 'away-catcher-1', result: 'stunned', thickSkull: true })).toBe('Elves Catcher 1 is Stunned (Thick Skull: Stunned instead of Out)')
    expect(say({ type: 'toReserves', playerId: 'away-catcher-1', thickSkull: true })).toBe('Elves Catcher 1 goes to the reserves (Thick Skull: not Out)')
    // Regeneration (#231).
    expect(say({ type: 'injured', playerId: 'away-catcher-1', result: 'out', regenerated: true })).toBe('Elves Catcher 1 is Out for the drive (Regeneration: not a Casualty)')
    expect(say({ type: 'playerReturned', playerId: 'away-catcher-1', hex: fromColRow({ col: 18, row: 5 }) })).toBe('Elves Catcher 1 comes back on from the reserves')
  })

  it('celebrates touchdowns and gives the full-time score', () => {
    expect(say({ type: 'touchdown', playerId: 'home-blitzer-1', team: 'home' })).toBe('TOUCHDOWN for Orcs! (Orcs Blitzer 1)')
    expect(say({ type: 'matchEnded', score: { home: 1, away: 0 }, winner: 'home' })).toBe('Full time: Orcs 1 – 0 Elves')
  })

  it('leaves out the noisy events', () => {
    expect(say({ type: 'moved', playerId: 'home-blitzer-1', path: [fromColRow({ col: 1, row: 1 })] })).toBeNull()
    expect(say({ type: 'activationEnded', playerId: 'home-blitzer-1', failed: false })).toBeNull()
  })

  // #161: the ball's moves are in the log.
  it('says where the ball bounces, a line a bounce, and where a scatter or throw-in ends', () => {
    const h = (col: number, row: number) => fromColRow({ col, row })
    expect(say({ type: 'ballMoved', from: h(7, 5), to: h(8, 5), how: 'bounce' })).toBe('The ball bounces to (8, 5)')
    // A bounce followed by another bounce is still its own line.
    expect(describeEvent({ type: 'ballMoved', from: h(8, 5), to: h(7, 5), how: 'bounce' }, state, file, { type: 'ballMoved', from: h(7, 5), to: h(8, 5), how: 'bounce' })).toBe(
      'The ball bounces to (7, 5)',
    )
    // A throw-in hex by hex: only its last hex makes a line.
    const first = { type: 'ballMoved', from: h(1, 3), to: h(2, 3), how: 'throwIn' } as const
    const last = { type: 'ballMoved', from: h(2, 3), to: h(3, 3), how: 'throwIn' } as const
    expect(describeEvent(first, state, file, last)).toBeNull()
    expect(describeEvent(last, state, file)).toBe('The ball is thrown in to (3, 3)')
    expect(say({ type: 'ballMoved', from: h(10, 5), to: h(11, 5), how: 'scatter' })).toBe('The ball scatters to (11, 5)')
    expect(say({ type: 'ballMoved', from: h(12, 5), to: h(13, 5), how: 'kick' })).toBe('The ball drifts to (13, 5)')
  })

  // #135: a match of one run of rounds has no half time.
  it('says Half time between halves only', () => {
    expect(say({ type: 'halfEnded', half: 1 })).toBe('Half time')
    expect(say({ type: 'halfEnded', half: 2 })).toBeNull()
    const one = createMatch(rulesV20, [rulesV20.rosters.orcs!, rulesV20.rosters.elves!], 1)
    const oneFile = newMatchFile(rulesV20, [rulesV20.rosters.orcs!, rulesV20.rosters.elves!], 1)
    expect(describeEvent({ type: 'halfEnded', half: 1 }, one, oneFile)).toBeNull()
  })
})
