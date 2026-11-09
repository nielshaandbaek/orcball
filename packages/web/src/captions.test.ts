import { apply, type Command, createMatch, forcedRng, fromColRow, type GameState, type MatchFile, rulesV16, seededRng } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { type Caption, type CaptionTarget, captionText, flashesOf, nextCaption, noticeOf } from './captions'

const BLITZER = 'home-blitzer-1'
const THROWER = 'home-thrower-1'
const ELF = 'away-thrower-1'
const CATCHER = 'away-catcher-1'
const file = { rosters: [rulesV16.rosters.orcs!, rulesV16.rosters.elves!] } as unknown as MatchFile

/** Round 1 of a v16 match, Orcs to go, no Momentum, these players only, the dice forced. */
function scene(placements: Record<string, [number, number]>, faces: number[], carrier?: string): GameState {
  const state = createMatch(rulesV16, [rulesV16.rosters.orcs!, rulesV16.rosters.elves!], 1)
  for (const [id, [col, row]] of Object.entries(placements)) {
    state.players[id]!.hex = fromColRow({ col, row })
    state.players[id]!.status = 'standing'
  }
  Object.assign(state, { pending: null, phase: 'Round', round: 1, kickingTeam: 'away', openingKicker: 'away', firstGo: 'home', turnOwner: 'home' })
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  if (carrier) state.ball = { hex: state.players[carrier]!.hex, carrier }
  state.rng = forcedRng(faces, seededRng(7))
  return state
}

/** Send the commands one by one; the caption and its text after each, and every flash. */
function play(state: GameState, commands: Command[], computerTarget: CaptionTarget | null = null) {
  let caption: Caption | null = null
  const texts: (string | null)[] = []
  const flashes: string[] = []
  for (const command of commands) {
    const { state: after, events } = apply(state, command)
    caption = nextCaption(caption, state, command, events, after, command.type === 'activate' ? computerTarget : null)
    texts.push(caption && captionText(caption, after, file))
    flashes.push(...flashesOf(state, events, after).map((f) => `${f.playerId}: ${f.text}`))
    state = after
  }
  return { texts, flashes, state }
}

describe('captions', () => {
  const blitz: Command[] = [
    { type: 'activate', playerId: BLITZER, action: 'blitz' },
    { type: 'move', to: fromColRow({ col: 8, row: 5 }) },
    { type: 'block', targetId: ELF },
    { type: 'decide', choice: 'tackle' },
  ]

  it('name the action, then the target once chosen, then the Tackle with its odds', () => {
    const { texts } = play(scene({ [BLITZER]: [7, 5], [ELF]: [9, 5] }, [9, 1, 1]), blitz)
    expect(texts.slice(0, 4)).toEqual(['Blitz', 'Blitz', 'Blitz → Thrower 1', 'Tackle (60%)'])
  })

  it("name the computer's target from the start, from its plan", () => {
    const { texts } = play(scene({ [BLITZER]: [7, 5], [ELF]: [9, 5] }, [9, 1, 1]), blitz.slice(0, 2), { playerId: ELF })
    expect(texts).toEqual(['Blitz → Thrower 1', 'Blitz → Thrower 1'])
  })

  it('go when the activation ends or is cancelled', () => {
    const { texts } = play(scene({ [BLITZER]: [7, 5] }, []), [
      { type: 'activate', playerId: BLITZER, action: 'move' },
      { type: 'cancelActivation' },
    ])
    expect(texts).toEqual(['Move', null])
  })

  it('name a pass by the player at the target, or by the hex', () => {
    const state = scene({ [THROWER]: [5, 5], [BLITZER]: [9, 5] }, [9, 9, 9, 9], THROWER)
    const { texts } = play(state, [{ type: 'activate', playerId: THROWER, action: 'pass' }], { hex: fromColRow({ col: 9, row: 5 }) })
    expect(texts).toEqual(['Pass → Blitzer 1'])
    const empty = play(scene({ [THROWER]: [5, 5] }, [], THROWER), [{ type: 'activate', playerId: THROWER, action: 'pass' }], { hex: fromColRow({ col: 9, row: 3 }) })
    expect(empty.texts).toEqual(['Pass → (9, 3)'])
  })
})

describe('flashes', () => {
  it('show a Dodge and a knock-down by the player they happened to', () => {
    const state = scene({ [BLITZER]: [8, 5], [CATCHER]: [9, 5] }, [1, 1, 1, 1])
    state.turnOwner = 'away'
    const { flashes } = play(state, [
      { type: 'activate', playerId: CATCHER, action: 'move' },
      { type: 'move', to: fromColRow({ col: 10, row: 5 }), dodge: true },
    ])
    expect(flashes).toEqual([`${CATCHER}: Down!`])
    const ok = scene({ [BLITZER]: [8, 5], [CATCHER]: [9, 5] }, [9])
    ok.turnOwner = 'away'
    expect(play(ok, [{ type: 'activate', playerId: CATCHER, action: 'move' }, { type: 'move', to: fromColRow({ col: 10, row: 5 }), dodge: true }]).flashes).toEqual([`${CATCHER}: Dodge ✓`])
  })
})

describe('centre banners', () => {
  it("show the computer's Wait, not the human's", () => {
    const state = scene({ [BLITZER]: [7, 5], [ELF]: [12, 5] }, [])
    const { state: after, events } = apply(state, { type: 'wait' })
    expect(noticeOf(events, after, file, 'home')).toMatchObject({ title: 'Orcs wait', team: 'home' })
    expect(noticeOf(events, after, file, 'away')).toBeNull()
    expect(noticeOf(events, after, file, null)).toBeNull()
  })

  it('show a double activation gained after a failure, and a touchdown first of all', () => {
    expect(noticeOf([{ type: 'doubleActivationGained', team: 'away', source: 'failure' }], scene({}, []), file, null)).toMatchObject({ title: 'Double activation', team: 'away' })
    expect(noticeOf([{ type: 'doubleActivationGained', team: 'away', source: 'momentum' }], scene({}, []), file, null)).toBeNull()
    const both = noticeOf(
      [
        { type: 'doubleActivationGained', team: 'away', source: 'failure' },
        { type: 'touchdown', playerId: BLITZER, team: 'home' },
      ],
      scene({ [BLITZER]: [7, 5] }, []),
      file,
      null,
    )
    expect(both).toEqual({ title: 'Touchdown!', sub: 'Orcs Blitzer 1 scores', team: 'home' })
  })
})
