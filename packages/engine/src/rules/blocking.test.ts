import { describe, expect, it } from 'vitest'
import { rulesV16, rulesV26 } from '../config'
import { createEngine } from '../engine'
import { fromColRow, type Hex, hexKey } from '../hex'
import type { Command, GameEvent, GameState } from '../state'
import { RULE_MODULES } from '.'
import { previewBlock } from './blocking'
import { run, scene } from './test-helpers'

const engine = createEngine(RULE_MODULES)
const h = (col: number, row: number): Hex => fromColRow({ col, row })

// Board sketch (odd rows 18 hexes, even rows 17 sitting half a hex in):
//
//   row 4      (5,4) (6,4) (7,4)
//   row 5   (5,5) (6,5) (7,5) (8,5)
//   row 6      (5,6) (6,6) (7,6)
//
// A Black Orc (ST 4) at (5,5) blocks an Elf (ST 3, TO 7) at (6,5). The push
// hexes are (7,5), (6,6) and (6,4): the far side of the Elf.
const ORC = 'home-black-orc-1'
const BLITZER = 'home-blitzer-1'
const ORC_HELP = 'home-lineman-1'
const ELF = 'away-lineman-1'
const ELF2 = 'away-lineman-2'
const CATCHER = 'away-catcher-1'
const CATCHER2 = 'away-catcher-2'
const FAR_ELF = 'away-thrower-1'

type Placements = Parameters<typeof scene>[0]

function blockScene(placements: Placements, faces: number[] = [], action: 'block' | 'blitz' = 'block', attacker = ORC): GameState {
  const state = scene({ [FAR_ELF]: { col: 16, row: 8 }, ...placements }, faces)
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  return run(engine, state, { type: 'activate', playerId: attacker, action }).state
}
const basic = (faces: number[] = [], extra: Placements = {}) =>
  blockScene({ [ORC]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, ...extra }, faces)

const block = (targetId = ELF): Command => ({ type: 'block', targetId })
const decide = (choice: string): Command => ({ type: 'decide', choice })
const pushTo = (col: number, row: number) => decide(hexKey(h(col, row)))
const events = (list: GameEvent[], type: GameEvent['type']) => list.filter((e) => e.type === type)

describe('declaring a block', () => {
  it('is offered against adjacent standing opponents only', () => {
    const state = blockScene({
      [ORC]: { col: 5, row: 5 },
      [ELF]: { col: 6, row: 5 },
      [ELF2]: { col: 4, row: 5, status: 'prone' },
      [CATCHER]: { col: 8, row: 5 },
      [ORC_HELP]: { col: 5, row: 4 },
    })
    expect(engine.legalCommands(state).filter((c) => c.type === 'block')).toEqual([block(ELF)])
  })

  it("isn't offered on a Move action", () => {
    const state = blockScene({ [ORC]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } }, [], 'block')
    const moving = scene({ [ORC]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 } })
    const active = run(engine, moving, { type: 'activate', playerId: ORC, action: 'move' }).state
    expect(engine.legalCommands(active).some((c) => c.type === 'block')).toBe(false)
    expect(engine.legalCommands(state).some((c) => c.type === 'block')).toBe(true)
  })

  it('shows both Strength totals, with assists, then asks Shove or Tackle', () => {
    // An Orc next to the Elf assists; an Elf next to the Black Orc assists the defence.
    const state = basic([], { [ORC_HELP]: { col: 7, row: 5 }, [ELF2]: { col: 4, row: 5 } })
    const { state: asked, events: evs } = run(engine, state, block())
    expect(evs).toContainEqual({ type: 'blockDeclared', attackerId: ORC, defenderId: ELF, attack: 5, defence: 4 })
    expect(asked.pending).toMatchObject({
      kind: 'blocking.shoveOrTackle',
      team: 'home',
      prompt: 'Block: ST 5 against 4',
      choices: [
        { id: 'shove', label: 'Shove (100%)' },
        { id: 'tackle', label: 'Tackle (60%)' },
      ],
    })
  })

  it("doesn't count an assister marked by another enemy", () => {
    // The Orc helper at (7,5) is also next to an Elf catcher at (8,5).
    const state = basic([], { [ORC_HELP]: { col: 7, row: 5 }, [CATCHER]: { col: 8, row: 5 } })
    const { events: evs } = run(engine, state, block())
    expect(evs).toContainEqual(expect.objectContaining({ type: 'blockDeclared', attack: 4, defence: 3 }))
  })

  it('previews the Tackle odds from the table in RULES.md §5', () => {
    const table: [number, number][] = [
      [-2, 0.3],
      [-1, 0.4],
      [0, 0.5],
      [1, 0.6],
      [2, 0.7],
      [3, 0.8],
    ]
    for (const [diff, chance] of table) {
      const state = basic()
      state.players[ORC]!.st = 3 + diff
      // Declaring the block rolls nothing; the odds come with the Tackle choice.
      expect(engine.previewRolls(state, block())).toEqual([])
      const asked = engine.apply(state, block()).state
      expect(engine.previewRoll(asked, decide('tackle'))).toMatchObject({ test: 'Tackle', target: 6 })
      expect(engine.previewRoll(asked, decide('tackle'))?.chance).toBeCloseTo(chance)
    }
  })
})

describe('Shove', () => {
  it('pushes the defender 1 hex, the attacker choosing where, then offers a follow-up', () => {
    const asked = run(engine, basic(), block(), decide('shove')).state
    expect(asked.pending?.kind).toBe('blocking.push')
    expect(asked.pending?.choices.map((c) => c.hex)).toEqual([h(7, 5), h(6, 6), h(6, 4)])

    const pushed = run(engine, asked, pushTo(6, 4))
    expect(pushed.events).toContainEqual({ type: 'pushed', playerId: ELF, from: h(6, 5), to: h(6, 4) })
    expect(pushed.state.players[ELF]).toMatchObject({ hex: h(6, 4), status: 'standing' })
    expect(events(pushed.events, 'rolled')).toEqual([])
    expect(pushed.state.pending).toMatchObject({ kind: 'blocking.followUp' })

    const followed = run(engine, pushed.state, decide('follow'))
    expect(followed.events).toContainEqual({ type: 'followedUp', playerId: ORC, to: h(6, 5) })
    expect(followed.state.players[ORC]!.hex).toEqual(h(6, 5))
    expect(followed.events).toContainEqual({ type: 'activationEnded', playerId: ORC, failed: false })
  })

  it('lets the attacker stay put instead of following up', () => {
    const after = run(engine, basic(), block(), decide('shove'), pushTo(7, 5), decide('stay')).state
    expect(after.players[ORC]!.hex).toEqual(h(5, 5))
    expect(after.activation).toBeNull()
  })

  it('does nothing when the attacker’s total is lower', () => {
    // On away's go, an Elf Catcher (ST 2) shoves an Orc Lineman (ST 3).
    const state = scene({ [CATCHER]: { col: 6, row: 5 }, [ORC_HELP]: { col: 5, row: 5 } })
    state.turnOwner = 'away'
    const active = run(engine, state, { type: 'activate', playerId: CATCHER, action: 'block' }).state
    const asked = run(engine, active, block(ORC_HELP)).state
    expect(asked.pending?.choices[0]).toEqual({ id: 'shove', label: 'Shove (too weak: nothing happens)' })
    const after = run(engine, asked, decide('shove'))
    expect(after.state.players[ORC_HELP]!.hex).toEqual(h(5, 5))
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: CATCHER, failed: false })
  })

  describe('at the touchline', () => {
    // The Elf at (18,5) has all three push hexes off the pitch.
    const edge = (extra: Placements = {}, faces: number[] = []) =>
      blockScene({ [ORC]: { col: 17, row: 5 }, [ELF]: { col: 18, row: 5 }, ...extra }, faces)

    it('cannot push into the crowd without a margin of 2: nobody moves', () => {
      const after = run(engine, edge(), block(), decide('shove'))
      expect(events(after.events, 'pushed')).toEqual([])
      expect(after.state.players[ELF]!.hex).toEqual(h(18, 5))
      expect(after.events).toContainEqual({ type: 'activationEnded', playerId: ORC, failed: false })
    })

    it('says so on the Shove choice when the push has nowhere to go', () => {
      const asked = run(engine, edge(), block()).state
      expect(asked.pending?.choices[0]).toEqual({ id: 'shove', label: 'Shove (no push)' })
      const margin = run(engine, edge({ [ORC_HELP]: { col: 17, row: 6 } }), block()).state
      expect(margin.pending?.choices[0]).toEqual({ id: 'shove', label: 'Shove (100%)' })
    })

    it('ends a Blitz when the Shove moves nobody', () => {
      const state = blockScene({ [BLITZER]: { col: 17, row: 5 }, [ELF]: { col: 18, row: 5 } }, [], 'blitz', BLITZER)
      const asked = run(engine, state, block()).state
      expect(asked.pending?.choices[0]?.label).toBe('Shove (no push)')
      const after = run(engine, state, block(), decide('shove'))
      expect(events(after.events, 'pushed')).toEqual([])
      expect(after.events).toContainEqual({ type: 'activationEnded', playerId: BLITZER, failed: false })
      expect(after.state.activation).toBeNull()
      expect(after.state.doubleActivation).toBeNull()
    })

    it('pushes into the crowd with a margin of 2: white die only', () => {
      // An Orc at (17,6) assists: 5 against 3. White 8: Out.
      const after = run(engine, edge({ [ORC_HELP]: { col: 17, row: 6 } }, [8]), block(), decide('shove'))
      expect(after.events).toContainEqual({ type: 'pushed', playerId: ELF, from: h(18, 5), to: null })
      expect(after.events).toContainEqual({ type: 'injuryRolled', playerId: ELF, white: 8 })
      expect(events(after.events, 'armourRolled')).toEqual([])
      expect(after.state.players[ELF]).toMatchObject({ hex: null, status: 'out' })
      // The defender's hex is empty, so the attacker may follow up.
      expect(after.state.pending?.kind).toBe('blocking.followUp')
    })
  })
})

describe('Tackle', () => {
  it('on a success pushes the defender and knocks them down', () => {
    // 5 + 1 = 6 succeeds. Push to (7,5). Red 7 ≥ TO 7 breaks, white 3: Stunned.
    const after = run(engine, basic([5, 7, 3]), block(), decide('tackle'), pushTo(7, 5))
    expect(after.events).toContainEqual(expect.objectContaining({ type: 'rolled', test: 'Tackle', natural: 5, success: true }))
    expect(after.events).toContainEqual({ type: 'knockedDown', playerId: ELF })
    expect(after.events).toContainEqual({ type: 'injured', playerId: ELF, result: 'stunned' })
    expect(after.state.players[ELF]).toMatchObject({ hex: h(7, 5), status: 'stunned' })
    expect(after.state.pending?.kind).toBe('blocking.followUp')
  })

  it('on a failure does nothing and ends the activation', () => {
    // 4 + 1 = 5 fails.
    const after = run(engine, basic([4]), block(), decide('tackle'))
    expect(after.state.players[ELF]).toMatchObject({ hex: h(6, 5), status: 'standing' })
    expect(after.state.players[ORC]!.status).toBe('standing')
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: ORC, failed: true })
    expect(after.state.doubleActivation).toEqual({ team: 'away', left: 2 })
  })

  it('on a natural 1 knocks the attacker down instead', () => {
    // Red 2 doesn't break the Black Orc's TO 9.
    const after = run(engine, basic([1, 2, 5]), block(), decide('tackle'))
    expect(after.events).toContainEqual({ type: 'knockedDown', playerId: ORC })
    expect(after.state.players[ORC]!.status).toBe('prone')
    expect(after.state.players[ELF]!.status).toBe('standing')
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: ORC, failed: true })
  })

  it('can be re-rolled with Momentum', () => {
    const state = basic([2, 8, 2, 2])
    state.teams.home.momentum = 1
    const failed = run(engine, state, block(), decide('tackle')).state
    expect(failed.pending).toMatchObject({ kind: 'blocking.tackle', team: 'home' })
    const after = run(engine, failed, decide('reroll'), pushTo(6, 6))
    expect(after.state.players[ELF]).toMatchObject({ hex: h(6, 6), status: 'prone' })
  })

  it('pushes into the crowd at the touchline whatever the margin, with no armour roll', () => {
    const state = blockScene({ [ORC]: { col: 17, row: 5 }, [ELF]: { col: 18, row: 5 } }, [6, 9])
    const after = run(engine, state, block(), decide('tackle'))
    expect(after.events).toContainEqual({ type: 'pushed', playerId: ELF, from: h(18, 5), to: null })
    expect(after.events).toContainEqual({ type: 'injuryRolled', playerId: ELF, white: 9 })
    expect(events(after.events, 'knockedDown')).toEqual([])
  })

  it('makes a carrier drop the ball where they go down', () => {
    // Tackle 6, push to (7,5), red 2 holds, white 1; the ball bounces E to (8,5).
    const state = basic([6, 2, 1, 1])
    state.ball = { hex: h(6, 5), carrier: ELF }
    const after = run(engine, state, block(), decide('tackle'), pushTo(7, 5))
    expect(after.state.ball).toEqual({ hex: h(8, 5), carrier: null })
    expect(after.state.pending?.kind).toBe('blocking.followUp')
  })
})

describe('push-backs', () => {
  it('chain-push when all three push hexes are full', () => {
    // Elves fill (7,5), (6,6) and (6,4). Pushing into (7,5) pushes that Elf on to (8,5).
    const state = basic([], { [ELF2]: { col: 7, row: 5 }, [CATCHER]: { col: 6, row: 6 }, [CATCHER2]: { col: 6, row: 4 } })
    const asked = run(engine, state, block(), decide('shove')).state
    expect(asked.pending?.choices.map((c) => c.label)).toEqual(['Chain-push', 'Chain-push', 'Chain-push'])
    const next = run(engine, asked, pushTo(7, 5)).state
    expect(next.pending?.choices.map((c) => c.hex)).toEqual([h(8, 5), h(7, 6), h(7, 4)])
    const done = run(engine, next, pushTo(8, 5))
    expect(done.events.filter((e) => e.type === 'pushed')).toEqual([
      { type: 'pushed', playerId: ELF2, from: h(7, 5), to: h(8, 5) },
      { type: 'pushed', playerId: ELF, from: h(6, 5), to: h(7, 5) },
    ])
    expect(done.state.players[ELF2]!.hex).toEqual(h(8, 5))
    expect(done.state.players[ELF]!.hex).toEqual(h(7, 5))
  })

  it('prefer an empty hex over a chain push', () => {
    const state = basic([], { [ELF2]: { col: 7, row: 5 }, [CATCHER]: { col: 6, row: 6 } })
    const asked = run(engine, state, block(), decide('shove'))
    // Only (6,4) is empty, so there's no choice to make.
    expect(asked.events).toContainEqual({ type: 'pushed', playerId: ELF, from: h(6, 5), to: h(6, 4) })
  })

  it('make a loose ball bounce when someone is pushed onto it', () => {
    // The ball lies at (6,4), the only empty push hex; it bounces E to (7,4).
    const state = basic([1], { [ELF2]: { col: 7, row: 5 }, [CATCHER]: { col: 6, row: 6 } })
    state.ball = { hex: h(6, 4), carrier: null }
    const after = run(engine, state, block(), decide('shove')).state
    expect(after.ball).toEqual({ hex: h(7, 4), carrier: null })
  })
})

describe('a Tackle onto a loose ball', () => {
  // v16: the Elf is tackled onto the ball at (6,4), the only empty push hex.
  // He falls on it (red 2, white 1 hold) and it bounces E (1) onto a standing
  // Catcher at (7,4), whose coach is asked to catch it or let it bounce.
  function tackledOntoBall(): GameState {
    const state = scene(
      { [ORC]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, [ELF2]: { col: 7, row: 5 }, [CATCHER]: { col: 6, row: 6 }, [CATCHER2]: { col: 7, row: 4 }, [FAR_ELF]: { col: 16, row: 8 } },
      [9, 2, 1, 1, 9],
    )
    state.config = rulesV16
    for (const p of Object.values(state.players)) p.skills = [...(rulesV16.rosters[p.team === 'home' ? 'orcs' : 'elves']!.positions[p.position]?.skills ?? [])]
    state.teams.home.momentum = 0
    state.teams.away.momentum = 0
    state.ball = { hex: h(6, 4), carrier: null }
    return run(engine, state, { type: 'activate', playerId: ORC, action: 'block' }, block(), decide('no'), decide('tackle'), decide('stay')).state
  }

  it('waits for the catch before the activation ends', () => {
    const state = tackledOntoBall()
    expect(state.pending?.kind).toBe('ball.catchOrLeave')
    expect(state.activation).toMatchObject({ playerId: ORC })
    const after = run(engine, state, decide('catch'))
    expect(after.state.ball).toEqual({ hex: h(7, 4), carrier: CATCHER2 })
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: ORC, failed: false })
  })

  it('doesn’t end the match with the catch still to answer, on the last activation', () => {
    // Replayed as the last activation of the match: nobody else left to activate.
    const state = scene(
      { [ORC]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, [ELF2]: { col: 7, row: 5 }, [CATCHER]: { col: 6, row: 6 }, [CATCHER2]: { col: 7, row: 4 }, [FAR_ELF]: { col: 16, row: 8 } },
      [9, 2, 1, 1, 9],
    )
    Object.assign(state, { config: rulesV16, half: 2, round: rulesV16.match.roundsPerHalf })
    for (const p of Object.values(state.players)) {
      p.skills = [...(rulesV16.rosters[p.team === 'home' ? 'orcs' : 'elves']!.positions[p.position]?.skills ?? [])]
      if (p.id !== ORC) p.activatedThisRound = true
    }
    state.teams.home.momentum = 0
    state.teams.away.momentum = 0
    state.ball = { hex: h(6, 4), carrier: null }
    // The Elves have nobody left to activate, so Brace isn't offered.
    const asked = run(engine, state, { type: 'activate', playerId: ORC, action: 'block' }, block(), decide('tackle'), decide('stay')).state
    expect(asked.phase).toBe('Activation')
    expect(asked.pending?.kind).toBe('ball.catchOrLeave')
    expect(run(engine, asked, decide('catch')).state.phase).toBe('FullTime')
  })
})

describe('Blitz', () => {
  // The Orc Blitzer (MA 6) starts at (3,5), two hexes from the Elf's neighbour.
  const blitz = (faces: number[] = []) =>
    blockScene({ [BLITZER]: { col: 3, row: 5 }, [ELF]: { col: 6, row: 5 } }, faces, 'blitz', BLITZER)
  const step = (col: number, row: number): Command => ({ type: 'move', to: h(col, row) })

  it('moves, then blocks for 1 hex of MA', () => {
    const state = run(engine, blitz(), step(4, 5), step(5, 5)).state
    expect(state.activation).toMatchObject({ maUsed: 2, stopped: true })
    expect(engine.legalCommands(state)).toContainEqual(block())
    const asked = run(engine, state, block()).state
    expect(asked.activation).toMatchObject({ maUsed: 3, blocked: true })
  })

  it('keeps moving after a successful block, even from a tackle zone', () => {
    const after = run(engine, blitz(), step(4, 5), step(5, 5), block(), decide('shove'), pushTo(7, 5), decide('follow')).state
    expect(after.activation).toMatchObject({ playerId: BLITZER, stopped: false, blocked: true })
    expect(after.players[BLITZER]!.hex).toEqual(h(6, 5))
    expect(engine.legalCommands(after).some((c) => c.type === 'move')).toBe(true)
    expect(engine.legalCommands(after).some((c) => c.type === 'block')).toBe(false)
  })

  it('keeps moving after a Shove without following up', () => {
    const after = run(engine, blitz(), step(4, 5), step(5, 5), block(), decide('shove'), pushTo(7, 5), decide('stay')).state
    expect(after.activation).toMatchObject({ playerId: BLITZER, stopped: false, blocked: true, maUsed: 3 })
    expect(after.players[BLITZER]!.hex).toEqual(h(5, 5))
    // Back the way it came: 2 hexes, nobody marking it any more.
    const moved = run(engine, after, step(4, 5), step(3, 5)).state
    expect(moved.players[BLITZER]!.hex).toEqual(h(3, 5))
    expect(moved.activation).toMatchObject({ maUsed: 5 })
  })

  it('keeps moving after a successful Tackle, Disengaging from the fallen Elf for free', () => {
    // Tackle 6 succeeds; red 2 against TO 7 holds, so the Elf is just prone.
    const after = run(engine, blitz([6, 2, 1]), step(4, 5), step(5, 5), block(), decide('tackle'), pushTo(7, 5), decide('follow')).state
    expect(after.players[ELF]!.status).toBe('prone')
    expect(after.activation).toMatchObject({ playerId: BLITZER, stopped: false, maUsed: 3 })
    const moved = run(engine, after, step(6, 4)).state
    expect(moved.players[BLITZER]!.hex).toEqual(h(6, 4))
    expect(moved.activation).toMatchObject({ maUsed: 4 })
  })

  it("can't block without the MA for it", () => {
    const state = run(engine, blitz(), step(4, 5), step(5, 5)).state
    state.activation!.maUsed = 8
    expect(engine.legalCommands(state).some((c) => c.type === 'block')).toBe(false)
  })

  it('ends as failed if a teammate drops the ball it knocked loose', () => {
    // Tackle 6 knocks the Elf carrier to (7,5); red 2 holds. The ball bounces E onto
    // an Orc at (8,5), who drops it (2), and it bounces on E to (9,5).
    const state = blockScene(
      { [BLITZER]: { col: 3, row: 5 }, [ELF]: { col: 6, row: 5 }, [ORC_HELP]: { col: 8, row: 5 } },
      [6, 2, 1, 1, 2, 1],
      'blitz',
      BLITZER,
    )
    state.ball = { hex: h(6, 5), carrier: ELF }
    const after = run(engine, state, step(4, 5), step(5, 5), block(), decide('tackle'), pushTo(7, 5))
    expect(after.state.ball).toEqual({ hex: h(9, 5), carrier: null })
    expect(after.state.pending).toBeNull()
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: BLITZER, failed: true })
  })

  it('ends on a failed Tackle', () => {
    const after = run(engine, blitz([3]), step(4, 5), step(5, 5), block(), decide('tackle')).state
    expect(after.activation).toBeNull()
    expect(after.doubleActivation).toEqual({ team: 'away', left: 2 })
  })
})

describe('Strip Ball (#198): a Shove that moves the carrier knocks the ball loose', () => {
  // The v11 order (follow-up before the ball), as in every version a roster could have it in.
  function stripScene(extra: Placements = {}, faces: number[] = [], defenderSkills: string[] = [], action: 'block' | 'blitz' = 'block'): GameState {
    const state = scene({ [FAR_ELF]: { col: 16, row: 8 }, [ORC]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, ...extra }, faces)
    state.config = rulesV26
    for (const p of Object.values(state.players)) p.skills = p.id === ORC ? ['Strip Ball'] : p.id === ELF ? (defenderSkills as typeof p.skills) : []
    state.teams.home.momentum = 0
    state.teams.away.momentum = 0
    state.ball = { hex: h(6, 5), carrier: ELF }
    return run(engine, state, { type: 'activate', playerId: ORC, action }).state
  }

  it('asks the follow-up first, then the ball bounces from the hex he was pushed to', () => {
    const pushed = run(engine, stripScene({}, [1]), block(), decide('shove'), pushTo(7, 5))
    // Pushed, still holding it: the follow-up comes before the ball.
    expect(pushed.state.pending?.kind).toBe('blocking.followUp')
    expect(pushed.state.ball).toEqual({ hex: h(7, 5), carrier: ELF })
    const after = run(engine, pushed.state, decide('stay'))
    expect(after.events).toContainEqual({ type: 'ballStripped', playerId: ELF, attackerId: ORC })
    const moved = events(after.events, 'ballMoved')
    expect(moved[0]).toMatchObject({ from: h(7, 5), how: 'bounce' })
    expect(after.state.ball.carrier).toBeNull()
    expect(after.state.players[ELF]).toMatchObject({ hex: h(7, 5), status: 'standing' })
    // Not a failure for either side.
    expect(after.events).toContainEqual({ type: 'activationEnded', playerId: ORC, failed: false })
    expect(after.state.doubleActivation).toBeNull()
  })

  it('a carrier with Sure Hands keeps the ball', () => {
    const after = run(engine, stripScene({}, [1], ['Sure Hands']), block(), decide('shove'), pushTo(7, 5), decide('stay'))
    expect(events(after.events, 'ballStripped')).toEqual([])
    expect(after.state.ball).toEqual({ hex: h(7, 5), carrier: ELF })
  })

  it('a player without the skill strips nothing', () => {
    const state = stripScene({}, [1])
    state.players[ORC]!.skills = []
    const after = run(engine, state, block(), decide('shove'), pushTo(7, 5), decide('stay'))
    expect(after.state.ball).toEqual({ hex: h(7, 5), carrier: ELF })
  })

  it('a successful Tackle drops the ball as always, with no Strip Ball', () => {
    // Tackle 6+: a 9 knocks him down; the armour holds; the ball bounces.
    const after = run(engine, stripScene({}, [9, 2, 1, 1]), block(), decide('tackle'), pushTo(7, 5), decide('stay'))
    expect(events(after.events, 'ballStripped')).toEqual([])
    expect(events(after.events, 'knockedDown')).toHaveLength(1)
    expect(after.state.ball.carrier).toBeNull()
  })

  it('a Shove that moves nobody strips nothing', () => {
    // At the touchline without a margin of 2: all three push hexes are off the pitch.
    const state = stripScene({ [ORC]: { col: 17, row: 5 }, [ELF]: { col: 18, row: 5 } })
    state.ball = { hex: h(18, 5), carrier: ELF }
    const after = run(engine, state, block(), decide('shove'))
    expect(events(after.events, 'pushed')).toEqual([])
    expect(after.state.ball).toEqual({ hex: h(18, 5), carrier: ELF })
  })

  it('a carrier chain-pushed by the Shove keeps the ball', () => {
    // The carrier is the Elf at (7,5), pushed on to (8,5) by the Elf the Orc blocks.
    const state = stripScene({ [ELF2]: { col: 7, row: 5 }, [CATCHER]: { col: 6, row: 6 }, [CATCHER2]: { col: 6, row: 4 } })
    state.ball = { hex: h(7, 5), carrier: ELF2 }
    const after = run(engine, state, block(), decide('shove'), pushTo(7, 5), pushTo(8, 5), decide('stay'))
    expect(events(after.events, 'ballStripped')).toEqual([])
    expect(after.state.ball).toEqual({ hex: h(8, 5), carrier: ELF2 })
  })

  it('a Blitz carries on after a strip', () => {
    const after = run(engine, stripScene({}, [1], [], 'blitz'), block(), decide('shove'), pushTo(7, 5), decide('stay'))
    expect(events(after.events, 'ballStripped')).toHaveLength(1)
    expect(after.state.activation).toMatchObject({ playerId: ORC, action: 'blitz' })
  })
})

describe('Dump-Off (#225): a quick pass before the block', () => {
  //   row 5   (5,5) Orc   (6,5) carrier   (7,5)   (8,5) team-mate
  const CARRIER = CATCHER // the Elf Catcher with the ball, given Dump-Off
  const MATE = ELF2
  const DUMP = 'blocking.dumpOff'

  /** The Orc about to block the carrier; the Elves' team-mate at (8,5), 2 hexes off. */
  function dumpScene(extra: Placements = {}, faces: number[] = [], { skills = ['Dump-Off'], awayMomentum = 0 } = {}): GameState {
    const state = scene({ [FAR_ELF]: { col: 16, row: 8 }, [ORC]: { col: 5, row: 5 }, [CARRIER]: { col: 6, row: 5 }, [MATE]: { col: 8, row: 5 }, ...extra }, faces)
    state.config = rulesV26
    for (const p of Object.values(state.players)) p.skills = p.id === CARRIER ? (skills as typeof p.skills) : []
    state.teams.home.momentum = 0
    state.teams.away.momentum = awayMomentum
    state.ball = { hex: h(6, 5), carrier: CARRIER }
    return run(engine, state, { type: 'activate', playerId: ORC, action: 'block' }).state
  }
  const blocked = (state: GameState) => run(engine, state, block(CARRIER))

  it('is offered to a carrier with the skill and a team-mate in the Quick band, before anything else', () => {
    const { state } = blocked(dumpScene())
    expect(state.pending).toMatchObject({ kind: DUMP, team: 'away' })
    expect(state.pending!.choices.map((c) => c.id)).toEqual([MATE, 'keep'])
  })

  it('is not offered without the skill, without the ball, or with nobody within 3 hexes', () => {
    expect(blocked(dumpScene({}, [], { skills: [] })).state.pending?.kind).toBe('blocking.shoveOrTackle')
    const noBall = dumpScene()
    noBall.ball = { hex: h(10, 10), carrier: null }
    expect(blocked(noBall).state.pending?.kind).toBe('blocking.shoveOrTackle')
    expect(blocked(dumpScene({ [MATE]: { col: 10, row: 5 } })).state.pending?.kind).toBe('blocking.shoveOrTackle')
  })

  it('comes before Brace: keeping the ball, he is then asked to Brace', () => {
    const asked = blocked(dumpScene({}, [], { skills: ['Dump-Off', 'Brace'] })).state
    expect(asked.pending?.kind).toBe(DUMP)
    expect(run(engine, asked, decide('keep')).state.pending?.kind).toBe('blocking.brace')
  })

  it('a pass caught: the team-mate has the ball and the block goes on, with nothing failed', () => {
    // Pass 9 against AG, −1 for the Orc's zone: a success; the unmarked catch is automatic.
    const asked = blocked(dumpScene({}, [9])).state
    const after = run(engine, asked, decide(MATE))
    expect(after.events).toContainEqual({ type: 'dumpedOff', playerId: CARRIER, toId: MATE })
    expect(after.events).toContainEqual(expect.objectContaining({ type: 'rolled', test: 'Pass', natural: 9, success: true }))
    expect(after.state.ball).toEqual({ hex: h(8, 5), carrier: MATE })
    expect(after.state.pending).toMatchObject({ kind: 'blocking.shoveOrTackle', team: 'home' })
    expect(events(after.events, 'activationEnded')).toEqual([])
    // Not his activation, and not his team's Pass for the round.
    expect(after.state.players[CARRIER]!.activatedThisRound).toBe(false)
    expect(after.state.teams.away.usedThisRound.pass).toBe(0)
    expect(after.state.doubleActivation).toBeNull()
    // The Shove then goes ahead against him, empty-handed.
    const shoved = run(engine, after.state, decide('shove'), pushTo(7, 5), decide('stay'))
    expect(shoved.state.players[CARRIER]!.hex).toEqual(h(7, 5))
    expect(shoved.state.ball.carrier).toBe(MATE)
  })

  it('a pass intercepted: the other team has the ball, and the block goes on with no failure', () => {
    // An Orc on (7,5), on the line: the interception, AG at −3, needs a natural 10.
    const asked = blocked(dumpScene({ [ORC_HELP]: { col: 7, row: 5 } }, [10])).state
    const after = run(engine, asked, decide(MATE))
    expect(events(after.events, 'intercepted')).toEqual([{ type: 'intercepted', playerId: ORC_HELP }])
    expect(after.state.ball.carrier).toBe(ORC_HELP)
    expect(after.state.pending?.kind).toBe('blocking.shoveOrTackle')
    expect(after.state.doubleActivation).toBeNull()
  })

  it('a fumble: the ball bounces from him, and no one gets a double activation', () => {
    const asked = blocked(dumpScene({}, [1, 1, 1, 1])).state
    const after = run(engine, asked, decide(MATE))
    expect(events(after.events, 'fumbled')).toEqual([{ type: 'fumbled', playerId: CARRIER }])
    expect(after.state.ball.carrier).not.toBe(CARRIER)
    expect(['blocking.shoveOrTackle', 'ball.catchOrLeave']).toContain(after.state.pending?.kind)
    expect(events(after.events, 'activationEnded')).toEqual([])
    expect(after.state.doubleActivation).toBeNull()
  })

  it('a missed pass can be re-rolled with Momentum, in the other team\'s activation', () => {
    const asked = blocked(dumpScene({}, [3, 9], { awayMomentum: 1 })).state
    const offered = run(engine, asked, decide(MATE)).state
    expect(offered.pending).toMatchObject({ kind: 'passing.throw', team: 'away' })
    const after = run(engine, offered, decide('reroll'))
    expect(after.events).toContainEqual({ type: 'momentumSpent', team: 'away', use: 'reroll' })
    expect(after.state.ball).toEqual({ hex: h(8, 5), carrier: MATE })
    expect(after.state.pending?.kind).toBe('blocking.shoveOrTackle')
  })

  it('before a Frenzy\'s second block too, which then keeps the first block\'s choice', () => {
    const state = dumpScene()
    state.players[ORC]!.skills = ['Frenzy']
    const first = run(engine, state, block(CARRIER), decide('keep'), decide('shove'), pushTo(7, 5))
    // Followed up by himself, and the carrier still stands next to him with the ball: asked again.
    expect(first.events.map((e) => e.type)).toContain('frenzy')
    expect(first.state.pending?.kind).toBe(DUMP)
    // Keeping it, the second block is a Shove again: no Shove or Tackle question.
    expect(run(engine, first.state, decide('keep')).state.pending?.kind).toBe('blocking.push')
  })

  it('previews the quick pass on its choice', () => {
    const asked = blocked(dumpScene()).state
    expect(engine.previewRolls(asked, decide(MATE))[0]).toMatchObject({ test: 'Pass', modifiers: [{ name: '1 tackle zone', value: -1 }] })
  })
})

describe('Juggernaut (#235): in a Blitz, no crowd margin, and a missed Tackle pushes', () => {
  // An Orc Blitzer (ST 3) with Juggernaut against an Elf Lineman (ST 3).
  function juggScene(extra: Placements = {}, faces: number[] = [], action: 'block' | 'blitz' = 'blitz', { skill = true, elfSkills = [] as string[] } = {}): GameState {
    const state = scene({ [FAR_ELF]: { col: 16, row: 8 }, [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, ...extra }, faces)
    state.config = rulesV26
    for (const p of Object.values(state.players)) p.skills = p.id === BLITZER && skill ? ['Juggernaut'] : p.id === ELF ? (elfSkills as typeof p.skills) : []
    state.teams.home.momentum = 0
    state.teams.away.momentum = 0
    return run(engine, state, { type: 'activate', playerId: BLITZER, action }).state
  }
  // At the touchline all three push hexes are off the pitch.
  const touchline = { [BLITZER]: { col: 17, row: 5 }, [ELF]: { col: 18, row: 5 } }

  it('a Blitz Shove at equal strength pushes into the crowd', () => {
    const { state, events: list } = run(engine, juggScene(touchline, [5]), block(), decide('shove'), decide('stay'))
    expect(events(list, 'pushed')).toEqual([{ type: 'pushed', playerId: ELF, from: h(18, 5), to: null }])
    expect(events(list, 'injuryRolled')).toHaveLength(1)
    expect(state.players[ELF]!.hex).toBeNull()
  })

  it('the prompt says so: the Shove is 100%, not "no push"', () => {
    expect(previewBlock(juggScene(touchline), ELF)!.shove).toBe('100%')
    expect(previewBlock(juggScene(touchline, [], 'block'), ELF)!.shove).toBe('no push')
  })

  it('a Shove in a Block action needs the margin as always: nobody moves', () => {
    const { events: list } = run(engine, juggScene(touchline, [], 'block'), block(), decide('shove'))
    expect(events(list, 'pushed')).toEqual([])
  })

  it('without the skill, a Blitz Shove needs the margin too', () => {
    const { events: list } = run(engine, juggScene(touchline, [], 'blitz', { skill: false }), block(), decide('shove'))
    expect(events(list, 'pushed')).toEqual([])
  })

  it('his missed Tackle in a Blitz: no choice asked, the Elf is pushed, follow-up offered, no failure, the Blitz goes on', () => {
    // Tackle 6+ at 3 against 3: a 3 misses.
    const missed = run(engine, juggScene({}, [3]), block(), decide('tackle'))
    expect(missed.events).toContainEqual({ type: 'juggernaut', playerId: BLITZER, defenderId: ELF })
    expect(missed.state.pending?.kind).toBe('blocking.push')
    const pushed = run(engine, missed.state, pushTo(7, 5))
    expect(pushed.state.pending?.kind).toBe('blocking.followUp')
    const after = run(engine, pushed.state, decide('follow'))
    expect(after.state.players[ELF]).toMatchObject({ hex: h(7, 5), status: 'standing' })
    expect(after.state.players[BLITZER]!.hex).toEqual(h(6, 5))
    expect(events([...missed.events, ...pushed.events, ...after.events], 'activationEnded')).toEqual([])
    expect(after.state.activation).toMatchObject({ playerId: BLITZER, action: 'blitz', stopped: false })
    expect(after.state.doubleActivation).toBeNull()
  })

  it('pushes even when he is weaker: an Elf assists the defender, 3 against 4', () => {
    // The Elf at (5,4) marks the Blitzer and assists; free of other zones.
    const missed = run(engine, juggScene({ [ELF2]: { col: 5, row: 4 } }, [3]), block(), decide('tackle'))
    expect(events(missed.events, 'blockDeclared')).toMatchObject([{ attack: 3, defence: 4 }])
    expect(missed.events).toContainEqual({ type: 'juggernaut', playerId: BLITZER, defenderId: ELF })
    expect(missed.state.pending?.kind).toBe('blocking.push')
  })

  it('his missed Tackle in a Blitz can push into the crowd', () => {
    const { state, events: list } = run(engine, juggScene(touchline, [3, 5]), block(), decide('tackle'), decide('stay'))
    expect(events(list, 'pushed')).toEqual([{ type: 'pushed', playerId: ELF, from: h(18, 5), to: null }])
    expect(events(list, 'injuryRolled')).toHaveLength(1)
    expect(state.players[ELF]!.hex).toBeNull()
    expect(state.activation).toMatchObject({ playerId: BLITZER, action: 'blitz' })
  })

  it('his missed Tackle in a Block action: the defending coach chooses, as always', () => {
    const { state, events: list } = run(engine, juggScene({}, [3], 'block'), block(), decide('tackle'))
    expect(state.pending?.kind).toBe('blocking.missChoice')
    expect(events(list, 'juggernaut')).toEqual([])
  })

  it('a natural 1 still knocks him down, a failure', () => {
    const { state, events: list } = run(engine, juggScene({}, [1, 2, 1]), block(), decide('tackle'))
    expect(events(list, 'juggernaut')).toEqual([])
    expect(list).toContainEqual({ type: 'knockedDown', playerId: BLITZER })
    expect(state.doubleActivation).toEqual({ team: 'away', left: 2 })
  })

  it('a defender can still Brace against his Blitz', () => {
    const state = juggScene({}, [], 'blitz', { elfSkills: ['Brace'] })
    const braced = run(engine, state, block())
    expect(braced.state.pending?.kind).toBe('blocking.brace')
    const after = run(engine, braced.state, decide('brace'))
    expect(after.state.pending).toMatchObject({ kind: 'blocking.shoveOrTackle', data: { attack: 3, defence: 4 } })
  })
})
