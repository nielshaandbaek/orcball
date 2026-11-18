import { createMatch, fromColRow, type GameEvent, rulesV10, rulesV24 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { ANIMS, bySheet, cuesOf, FRAME_MS, ONCE_MS, phaseOf, RUNNING_MS, sheetFor, spriteFrame } from './sprites'

const standing = { status: 'standing', winded: false } as const
/** A moment that's the start of a loop: 60 frames in. */
const NOW = 60 * FRAME_MS

describe('sheetFor: a player draws from art/sprites/<team>/<colour>/<position>.png', () => {
  const sheets = bySheet({
    '../../../art/sprites/orcs/blue/brute.png': 'orc-brute-blue',
    '../../../art/sprites/orcs/blue/lineman.png': 'orc-lineman-blue',
    '../../../art/sprites/orcs/red/lineman.png': 'orc-lineman-red',
    '../../../art/sprites/orcs/source/lineman.png': 'not a colour',
  })
  const { orcs, humans } = rulesV24.rosters as Record<'orcs' | 'humans', (typeof rulesV24.rosters)[string]>
  const file = { rosters: [orcs!, orcs!] as const }
  const player = (id: string) => createMatch(rulesV24, [orcs!, orcs!], 1).players[id]!

  it('home in red, away in blue', () => {
    expect(sheetFor(file, player('home-lineman-1'), sheets)).toBe('orc-lineman-red')
    expect(sheetFor(file, player('away-lineman-1'), sheets)).toBe('orc-lineman-blue')
  })

  it('home in blue while the team has no red sheet for him', () => {
    expect(sheetFor(file, player('home-brute-1'), sheets)).toBe('orc-brute-blue')
  })

  it('none for a position or team without a sheet: the initials token', () => {
    expect(sheetFor(file, player('home-blitzer-1'), sheets)).toBeNull()
    expect(sheetFor({ rosters: [humans!, humans!] }, player('home-lineman-1'), sheets)).toBeNull()
  })

  it('finds a renamed position under its new id (black-orc is brute)', () => {
    const rosters = [rulesV10.rosters.orcs!, rulesV10.rosters.elves!] as const
    const blackOrc = createMatch(rulesV10, [...rosters], 1).players['home-black-orc-1']!
    expect(blackOrc.position).toBe('black-orc')
    expect(sheetFor({ rosters: [...rosters] }, blackOrc, sheets)).toBe('orc-brute-blue')
  })

  it('has every team in blue in the app', () => {
    const real = bySheet(import.meta.glob<string>('../../../art/sprites/*/*/*.png', { eager: true, import: 'default', query: '?url' }))
    expect(Object.keys(real).sort()).toEqual(['elves', 'humans', 'orcs'])
    expect(Object.keys(real.orcs!.blue!).sort()).toEqual(['blitzer', 'brute', 'lineman', 'thrower'])
    expect(Object.keys(real.elves!.blue!).sort()).toEqual(['catcher', 'dancer', 'lineman', 'thrower'])
    expect(Object.keys(real.humans!.blue!).sort()).toEqual(['blitzer', 'catcher', 'lineman', 'thrower'])
  })
})

describe('cuesOf: what a command starts', () => {
  const h = { q: 0, r: 0 }
  const cues = (events: GameEvent[]) => Object.fromEntries(Object.entries(cuesOf(events, NOW)).map(([id, c]) => [id, c.anim]))

  it('running for a step, a Disengage or a follow-up, for a little longer than a step', () => {
    expect(cues([{ type: 'moved', playerId: 'a', path: [h] }, { type: 'disengaged', playerId: 'b', to: h }, { type: 'followedUp', playerId: 'c', to: h }])).toEqual({ a: 'running', b: 'running', c: 'running' })
    expect(cuesOf([{ type: 'moved', playerId: 'a', path: [h] }], NOW).a).toEqual({ anim: 'running', start: NOW, ms: RUNNING_MS })
  })

  it('a step says which way he runs: left or right across the pitch', () => {
    const at = (col: number, row: number) => fromColRow({ col, row })
    const facing = (from: [number, number], to: [number, number]) => cuesOf([{ type: 'moved', playerId: 'a', path: [at(...from), at(...to)] }], NOW).a!.facing
    expect(facing([9, 5], [10, 5])).toBe('right')
    expect(facing([9, 5], [8, 5])).toBe('left')
    // Up or down a row, he still goes half a hex one way or the other.
    expect(facing([9, 5], [9, 4])).toBe('right')
    expect(facing([9, 5], [8, 6])).toBe('left')
    // A Leap: two hexes at once.
    expect(facing([10, 5], [8, 5])).toBe('left')
  })

  it('a Shove: the attacker blocks, the defender stumbles', () => {
    expect(
      cues([
        { type: 'blockChosen', attackerId: 'att', choice: 'shove' },
        { type: 'pushed', playerId: 'def', from: h, to: h },
      ]),
    ).toEqual({ att: 'blocking', def: 'stumbling' })
  })

  it('a Tackle that knocks him down: he falls, though he was pushed first', () => {
    expect(
      cues([
        { type: 'blockChosen', attackerId: 'att', choice: 'tackle' },
        { type: 'pushed', playerId: 'def', from: h, to: h },
        { type: 'knockedDown', playerId: 'def' },
      ]),
    ).toEqual({ att: 'blocking', def: 'falling' })
  })

  it('a Tackle that misses: only the attacker blocks, the defender keeps standing', () => {
    expect(cues([{ type: 'blockChosen', attackerId: 'att', choice: 'tackle' }])).toEqual({ att: 'blocking' })
  })

  it('victory for the scorer, once', () => {
    expect(cuesOf([{ type: 'touchdown', playerId: 's', team: 'home' }], NOW).s).toEqual({ anim: 'victory', start: NOW, ms: ONCE_MS })
  })
})

describe('spriteFrame: the animation, row and frame now', () => {
  const row = (anim: (typeof ANIMS)[number]) => ANIMS.indexOf(anim)

  it('idle, looping in time, shifted by his phase; winded in its place while winded', () => {
    expect(spriteFrame(standing, undefined, NOW, 0)).toEqual({ anim: 'idle', row: 0, frame: 0 })
    expect(spriteFrame(standing, undefined, NOW + FRAME_MS, 0)).toEqual({ anim: 'idle', row: 0, frame: 1 })
    expect(spriteFrame(standing, undefined, NOW, 2 * FRAME_MS)).toEqual({ anim: 'idle', row: 0, frame: 2 })
    expect(spriteFrame({ status: 'standing', winded: true }, undefined, NOW, 3 * FRAME_MS)).toEqual({ anim: 'winded', row: row('winded'), frame: 3 })
  })

  it('players are out of step: each has his own phase, the same every time', () => {
    const ids = ['home-lineman-1', 'home-lineman-2', 'home-blitzer-1', 'away-lineman-1', 'away-dancer-1', 'away-catcher-2', 'home-brute-1']
    const phases = ids.map(phaseOf)
    for (const phase of phases) expect(phase).toBeGreaterThanOrEqual(0)
    for (const phase of phases) expect(phase).toBeLessThan(ONCE_MS)
    expect(ids.map(phaseOf)).toEqual(phases)
    // At one moment they don't all show the same idle frame.
    expect(new Set(phases.map((p) => spriteFrame(standing, undefined, NOW, p).frame)).size).toBeGreaterThan(1)
  })

  it('lying, the fall held on its last frame, while prone or stunned', () => {
    for (const status of ['prone', 'stunned'] as const) expect(spriteFrame({ status, winded: false }, undefined, NOW, 5)).toEqual({ anim: 'falling', row: row('falling'), frame: 3 })
  })

  it('a cue plays once, frame by frame from its start, then he goes back', () => {
    const cue = { anim: 'blocking' as const, start: NOW, ms: ONCE_MS }
    expect([0, 1, 2, 3].map((i) => spriteFrame(standing, cue, NOW + i * FRAME_MS + 1, 99).frame)).toEqual([0, 1, 2, 3])
    expect(spriteFrame(standing, cue, NOW + FRAME_MS, 99).anim).toBe('blocking')
    expect(spriteFrame(standing, cue, NOW + ONCE_MS + 1, 0)).toEqual({ anim: 'idle', row: 0, frame: 0 })
  })

  it('running loops while its cue lasts', () => {
    const cue = { anim: 'running' as const, start: NOW, ms: RUNNING_MS }
    expect(spriteFrame(standing, cue, NOW + 100, FRAME_MS)).toEqual({ anim: 'running', row: row('running'), frame: 1 })
  })

  it('a fall ends lying: the cue, then the held last frame', () => {
    const cue = { anim: 'falling' as const, start: NOW, ms: ONCE_MS }
    expect(spriteFrame({ status: 'prone', winded: false }, cue, NOW + 1, 0)).toMatchObject({ anim: 'falling', frame: 0 })
    expect(spriteFrame({ status: 'prone', winded: false }, cue, NOW + ONCE_MS + 1, 0)).toMatchObject({ anim: 'falling', frame: 3 })
  })

  it('a sheet without the row shows idle in its place', () => {
    const cue = { anim: 'stumbling' as const, start: NOW, ms: ONCE_MS }
    expect(spriteFrame(standing, cue, NOW + 1, 0, { rows: 6 })).toMatchObject({ anim: 'stumbling', row: 0 })
  })

  it('with reduced motion nothing loops: the first frame, or lying at once', () => {
    expect(spriteFrame(standing, undefined, NOW, 3, { reducedMotion: true }).frame).toBe(0)
    expect(spriteFrame(standing, { anim: 'running', start: NOW, ms: RUNNING_MS }, NOW + 100, 3, { reducedMotion: true }).frame).toBe(0)
    expect(spriteFrame({ status: 'prone', winded: false }, { anim: 'falling', start: NOW, ms: ONCE_MS }, NOW + 1, 3, { reducedMotion: true }).frame).toBe(3)
  })
})
