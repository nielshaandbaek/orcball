import { type Activation, createMatch, type Player, rulesV14, rulesV18 } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { briefIconsOf, byPosition, iconStates, pickIcon, tokenIcon } from './icons'

describe('tokenIcon', () => {
  it('has a sprite for every Orc and Elf position, different for home and away', () => {
    const { orcs, elves } = rulesV14.rosters
    for (const rosters of [
      [orcs!, elves!],
      [elves!, orcs!],
    ] as const) {
      const state = createMatch(rulesV14, [rosters[0], rosters[1]], 1)
      const file = { rosters } as unknown as Parameters<typeof tokenIcon>[0]
      for (const p of Object.values(state.players)) expect(tokenIcon(file, p)?.href, p.id).toMatch(/default\.png$/)
    }
    // The same position on the other side gets the other colours.
    const mirror = createMatch(rulesV14, [orcs!, orcs!], 1)
    const file = { rosters: [orcs, orcs] } as unknown as Parameters<typeof tokenIcon>[0]
    expect(tokenIcon(file, mirror.players['home-blitzer-1']!)?.href).not.toBe(tokenIcon(file, mirror.players['away-blitzer-1']!)?.href)
  })

  // v14 has the old position ids (black-orc, wardancer), v18 the new (#141); both find the same folders.
  it.each([rulesV14, rulesV18])('has all ten states for every position, in both colours of both teams (#139, #164, $id)', (config) => {
    const { orcs, elves } = config.rosters
    for (const rosters of [
      [orcs!, elves!],
      [elves!, orcs!],
    ] as const) {
      const state = createMatch(config, [rosters[0], rosters[1]], 1)
      const file = { rosters } as unknown as Parameters<typeof tokenIcon>[0]
      for (const p of Object.values(state.players)) {
        const shown = (player: Player, activation: Activation | null = null) => tokenIcon(file, player, { activation })?.state
        expect(shown(p), p.id).toBe('default')
        expect(shown({ ...p, activatedThisRound: true }), p.id).toBe('activated')
        expect(shown({ ...p, status: 'prone' }), p.id).toBe('prone')
        expect(shown({ ...p, status: 'stunned' }), p.id).toBe('stunned')
        expect(shown(p, { playerId: p.id, action: 'move' } as Activation), p.id).toBe('move')
        // The rest of the ten states, drawn for every position since #164.
        expect(shown({ ...p, winded: true }), p.id).toBe('winded')
        expect(shown(p, { playerId: p.id, action: 'pass' } as Activation), p.id).toBe('pass')
        for (const brief of ['shove', 'tackle', 'catch'] as const) expect(tokenIcon(file, p, { brief })?.state, `${p.id} ${brief}`).toBe(brief)
      }
    }
  })
})

describe('byPosition', () => {
  it('files icons by position folder and state, ignoring other files', () => {
    expect(
      byPosition({
        'art/icons/orcs/red/blitzer/default.png': 'b0',
        'art/icons/orcs/red/blitzer/prone.png': 'b1',
        'art/icons/orcs/red/lineman/move.png': 'l1',
        'art/icons/orcs/red/lineman/idle-front.png': 'unused',
      }),
    ).toEqual({ blitzer: { default: 'b0', prone: 'b1' }, lineman: { move: 'l1' } })
  })
})

describe('iconStates', () => {
  const player = (over: Partial<Player> = {}) => ({ id: 'home-blitzer-1', status: 'standing', winded: false, activatedThisRound: false, ...over }) as Player
  const running = (action: Activation['action']) => ({ playerId: 'home-blitzer-1', action }) as Activation

  it('is just default for a fresh player', () => {
    expect(iconStates(player(), null)).toEqual(['default'])
  })

  it('puts down first, then a brief icon, the action, winded, activated and default', () => {
    expect(iconStates(player({ status: 'prone', winded: true, activatedThisRound: true }), running('blitz'), 'tackle')).toEqual([
      'prone',
      'tackle',
      'move',
      'winded',
      'activated',
      'default',
    ])
    expect(iconStates(player({ status: 'stunned' }), null)).toEqual(['stunned', 'default'])
  })

  it('shows Move for Move, Blitz and Foul, Pass for Pass and Hand-off, nothing for Block', () => {
    for (const action of ['move', 'blitz', 'foul'] as const) expect(iconStates(player(), running(action))[0]).toBe('move')
    for (const action of ['pass', 'handOff'] as const) expect(iconStates(player(), running(action))[0]).toBe('pass')
    expect(iconStates(player(), running('block'))).toEqual(['default'])
  })

  it("ignores another player's activation", () => {
    expect(iconStates(player(), { playerId: 'home-lineman-1', action: 'move' } as Activation)).toEqual(['default'])
  })
})

describe('pickIcon', () => {
  it('takes the first state there is a file for, falling back to default', () => {
    const files = { default: 'd', activated: 'a', prone: 'p' }
    expect(pickIcon(files, ['prone', 'default'])).toEqual({ href: 'p', state: 'prone' })
    expect(pickIcon(files, ['tackle', 'move', 'winded', 'activated', 'default'])).toEqual({ href: 'a', state: 'activated' })
    expect(pickIcon(files, ['catch', 'default'])).toEqual({ href: 'd', state: 'default' })
  })

  it('is null with no file at all', () => {
    expect(pickIcon(undefined, ['default'])).toBeNull()
    expect(pickIcon({ prone: 'p' }, ['default'])).toBeNull()
  })
})

describe('briefIconsOf', () => {
  it('gives the attacker his Shove or Tackle, and the catcher his Catch', () => {
    expect(
      briefIconsOf([
        { type: 'blockChosen', attackerId: 'home-blitzer-1', choice: 'tackle' },
        { type: 'knockedDown', playerId: 'away-catcher-1' },
        { type: 'ballCaught', playerId: 'away-thrower-1' },
      ]),
    ).toEqual({ 'home-blitzer-1': 'tackle', 'away-thrower-1': 'catch' })
  })
})
