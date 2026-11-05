import { describe, expect, it } from 'vitest'
import { rulesV12, rulesV13 } from '../config'
import { createEngine } from '../engine'
import type { Command, GameState } from '../state'
import { RULE_MODULES } from '.'
import { type Placement, run, scene } from './test-helpers'

// Rules v13: v12 with the Block skill counting on a Tackle whatever the
// assists, not only when its side has none.
//
//   row 4      (5,4) (6,4) (7,4)
//   row 5   (5,5) (6,5) (7,5) (8,5)
//   row 6      (5,6) (6,6) (7,6)

const engine = createEngine(RULE_MODULES)

const BLITZER = 'home-blitzer-1' // ST 3, Block
const ORC = 'home-lineman-1' // ST 3, Brace
const ORC2 = 'home-lineman-2'
const ELF = 'away-lineman-1' // ST 3, Brace
const ELF2 = 'away-lineman-2'
const WARDANCER = 'away-wardancer-1' // ST 3, Block

/** A scene under the given rules: the players get their skills, Momentum is off so misses aren't re-rolled. */
function under(config: typeof rulesV12, placements: Record<string, Placement>): GameState {
  const state = scene(placements)
  state.config = config
  const rosters = { home: config.rosters.orcs!, away: config.rosters.elves! }
  for (const p of Object.values(state.players)) p.skills = [...rosters[p.team].positions[p.position]!.skills]
  state.teams.home.momentum = 0
  state.teams.away.momentum = 0
  return state
}

const decide = (choice: string): Command => ({ type: 'decide', choice })
const blocks = (attacker: string, defender: string): Command[] => [
  { type: 'activate', playerId: attacker, action: 'block' },
  { type: 'block', targetId: defender },
]

describe('rules v13 config', () => {
  it('is v12 with the Block skill counting whatever the assists', () => {
    const { id: _a, blocking: b13, ...rest13 } = rulesV13
    const { id: _b, blocking: b12, ...rest12 } = rulesV12
    expect(rulesV13.id).toBe('rules-v13')
    expect(rest13).toEqual(rest12)
    expect(b13).toEqual({ ...b12, blockSkillWithAssists: true })
  })
})

describe('Block (v13)', () => {
  // An Orc Lineman at (6,4) assists the Blitzer: 4 against 3.
  const assisted = { [BLITZER]: { col: 5, row: 5 }, [ELF]: { col: 6, row: 5 }, [ORC2]: { col: 6, row: 4 } }

  it('is +1 on the Tackle even when its side has assists: 70%', () => {
    const asked = run(engine, under(rulesV13, assisted), ...blocks(BLITZER, ELF), decide('no')).state
    expect(engine.previewRoll(asked, decide('tackle'))).toMatchObject({
      modifiers: [
        { name: 'Strength difference', value: 1 },
        { name: 'Block', value: 1 },
      ],
      chance: 0.7,
    })
  })

  it('counts against an attacker even when the defender has assists: −1', () => {
    // An Elf Lineman at (4,5) assists the Wardancer against the Orc Lineman: 3 against 4, 40% − 10%.
    const state = under(rulesV13, { [ORC]: { col: 5, row: 5 }, [WARDANCER]: { col: 6, row: 5 }, [ELF2]: { col: 4, row: 5 } })
    const asked = run(engine, state, ...blocks(ORC, WARDANCER)).state
    expect(engine.previewRoll(asked, decide('tackle'))).toMatchObject({
      modifiers: [
        { name: 'Strength difference', value: -1 },
        { name: "Defender's Block", value: -1 },
      ],
      chance: 0.3,
    })
  })

  it('leaves v12 as it was: no Block with assists', () => {
    const asked = run(engine, under(rulesV12, assisted), ...blocks(BLITZER, ELF), decide('no')).state
    expect(engine.previewRoll(asked, decide('tackle'))).toMatchObject({
      modifiers: [{ name: 'Strength difference', value: 1 }],
      chance: 0.6,
    })
  })
})
