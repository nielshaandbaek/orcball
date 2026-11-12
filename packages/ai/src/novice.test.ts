import { apply, createMatch, currentPositionId, type GameEvent, type GameState, hexEquals, rulesV12, rulesV18, type TeamId } from '@orcball/engine'
import { describe, expect, it } from 'vitest'
import { actingTeam, chooseCommand, viewOf } from '.'
import { formations } from './novice'
import { elves, orcs, scene } from './test-helpers'

const BLITZER = 'home-blitzer-1' // Block
const ELF = 'away-lineman-1' // Brace
const ELF2 = 'away-lineman-2'
const options = { level: 'novice' as const, budgetMs: 10_000, seed: 1 }

/** Let the computer play `team` until someone else has to act; returns every event. */
function computerPlays(state: GameState, team: TeamId, limit = 50): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = []
  for (let i = 0; i < limit && actingTeam(viewOf(state)) === team && state.phase !== 'FullTime'; i++) {
    const { command } = chooseCommand(viewOf(state), team, options)
    const result = apply(state, command)
    state = result.state
    events.push(...result.events)
  }
  return { state, events }
}

describe('Novice', () => {
  it('scores when its carrier is next to the end zone', () => {
    const state = scene({ [BLITZER]: { col: 17, row: 5 }, [ELF]: { col: 3, row: 3 } }, { carrier: BLITZER })
    const { events } = computerPlays(state, 'home')
    expect(events).toContainEqual({ type: 'touchdown', playerId: BLITZER, team: 'home' })
  })

  it('goes for a loose ball it can reach', () => {
    const state = scene({ [BLITZER]: { col: 8, row: 5 }, [ELF]: { col: 15, row: 3 } }, { ball: { col: 11, row: 5 } })
    const { state: after } = computerPlays(state, 'home')
    expect(after.ball.carrier).toBe(BLITZER)
  })

  it('answers the v12 defender’s decisions when the human blocks it', () => {
    // The human (home) blocks the computer's Elf, who has Brace. Tackle face 2 misses; then armour 2 and 2 hold.
    const state = scene({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, [ELF2]: { col: 14, row: 5 } }, { faces: [2, 2, 1, 2, 1] })
    state.teams.home.momentum = 0
    state.teams.away.momentum = 0
    let current = apply(state, { type: 'activate', playerId: BLITZER, action: 'block' }).state
    current = apply(current, { type: 'block', targetId: ELF }).state
    expect(current.pending).toMatchObject({ kind: 'blocking.brace', team: 'away' })
    const brace = chooseCommand(viewOf(current), 'away', options)
    expect(brace.command).toMatchObject({ type: 'decide' })
    expect(['brace', 'no']).toContain((brace.command as { choice: string }).choice)
    current = apply(current, brace.command).state

    expect(current.pending).toMatchObject({ kind: 'blocking.shoveOrTackle', team: 'home' })
    current = apply(current, { type: 'decide', choice: 'tackle' }).state
    expect(current.pending).toMatchObject({ kind: 'blocking.missChoice', team: 'away' })
    const miss = chooseCommand(viewOf(current), 'away', options)
    expect(['bothDown', 'nothing']).toContain((miss.command as { choice: string }).choice)
    apply(current, miss.command)
  })

  it('leaves those decisions to the human when the computer blocks', () => {
    // Now the computer is home and blocks the human's Elf: Brace is the human's call.
    const state = scene({ [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, [ELF2]: { col: 14, row: 5 } })
    let current = apply(state, { type: 'activate', playerId: BLITZER, action: 'block' }).state
    current = apply(current, { type: 'block', targetId: ELF }).state
    expect(actingTeam(viewOf(current))).toBe('away')
    expect(() => chooseCommand(viewOf(current), 'home', options)).toThrow(/not home's/)
  })
})

describe('Novice setup', () => {
  it.each(['kick', 'receive'])('sets up a full team in a formation when the toss winner chooses to %s', (choice) => {
    let state = createMatch(rulesV12, [orcs, elves], 3)
    state = apply(state, { type: 'decide', choice }).state
    expect(state.phase).toBe('Setup')
    for (const team of [state.turnOwner, state.turnOwner === 'home' ? 'away' : 'home'] as TeamId[]) {
      const { state: after, events } = computerPlays(state, team, 40)
      state = after
      expect(events).toContainEqual({ type: 'setupEnded', team })
      const placed = Object.values(state.players).filter((p) => p.team === team && p.hex !== null)
      expect(placed).toHaveLength(7)
    }
    expect(state.phase).not.toBe('Setup')
  })

  it('has formations that fit the setup rules for both rosters and both sides', () => {
    expect(Object.keys(formations).sort()).toEqual(['elves', 'orcs'])
    for (const [id, set] of Object.entries(formations)) {
      const positions = Object.keys(rulesV18.rosters[id]!.positions)
      for (const formation of [...set.kick, ...set.receive]) {
        expect(formation.slots).toHaveLength(7)
        for (const slot of formation.slots) expect(positions, formation.name).toContain(slot.position)
        const hexes = formation.slots.map((s) => `${s.col},${s.row}`)
        expect(new Set(hexes).size).toBe(7)
      }
    }
  })

  // v18 renamed the Black Orc and Wardancer ids (#141); the formations use the new ones.
  it.each([rulesV12, rulesV18])('places each player on his formation hex ($id)', (config) => {
    let state = createMatch(config, [config.rosters.orcs!, config.rosters.elves!], 3)
    state = apply(state, { type: 'decide', choice: 'kick' }).state
    const team = state.turnOwner
    state = computerPlays(state, team, 40).state
    const set = formations[team === 'home' ? 'orcs' : 'elves']!
    const kicking = state.kickingTeam === team
    const templates = kicking ? set.kick : set.receive
    const onPitch = Object.values(state.players).filter((p) => p.team === team && p.hex)
    // The hexes match one of the templates, mirrored for away.
    const matches = templates.some((f) =>
      f.slots.every((slot) => onPitch.some((p) => currentPositionId(p.position) === slot.position && hexEquals(p.hex!, mirrorFor(team, slot.col, slot.row)))),
    )
    expect(matches).toBe(true)
  })
})

function mirrorFor(team: TeamId, col: number, row: number) {
  const length = row % 2 === 1 ? 18 : 17
  const c = team === 'home' ? col : length + 1 - col
  const row0 = row - 1
  return { q: c - 1 - (row0 - (row0 & 1)) / 2, r: row0 }
}
